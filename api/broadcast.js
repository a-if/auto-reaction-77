import { logger } from './logger.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A broadcast "job" is a plain object that is passed along between steps
 * (a queue message on Cloudflare, a loop on a normal server):
 * { kinds, fromChatId, messageId, statusChatId, statusMessageId,
 *   afterId, total, sent, failed, removed, startedAt, lastEdit }
 */

export function progressText(job) {
    const done = job.sent + job.failed + job.removed;
    return `📢 <b>Broadcasting...</b>\n\n${done} / ${job.total}`;
}

export function finishText(job) {
    const seconds = Math.round((Date.now() - job.startedAt) / 1000);
    return (
        `✅ <b>Broadcast finished</b>\n\n` +
        `📬 Total: <b>${job.total}</b>\n` +
        `✔️ Sent: <b>${job.sent}</b>\n` +
        `🚫 Removed (blocked / left): <b>${job.removed}</b>\n` +
        `⚠️ Failed: <b>${job.failed}</b>\n` +
        `⏱ Time: <b>${seconds}s</b>`
    );
}

export function errorText(job, error) {
    return `❌ <b>Broadcast stopped</b>\n\nSent ${job.sent}, failed ${job.failed}.\nError: ${error.message}`;
}

export const editStatus = (botApi, job, text) =>
    botApi.editMessageText(job.statusChatId, job.statusMessageId, text).catch(() => {});

/**
 * Send the message to the next `limit` chats after job.afterId.
 * Dead chats (blocked / kicked / deleted) are removed from the store.
 * Returns { job, done } with updated counters.
 */
export async function broadcastStep(botApi, store, job, limit) {
    const ids = await store.ids(job.kinds, job.afterId, limit);
    const next = { ...job };

    async function sendOne(id) {
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                await botApi.copyMessage(id, job.fromChatId, job.messageId);
                next.sent++;
                return;
            } catch (error) {
                if (error.code === 429 && attempt === 0) {
                    await sleep(((error.retryAfter || 1) + 0.5) * 1000);
                    continue;
                }
                if (error.code === 403 || (error.code === 400 && /chat not found/i.test(error.message))) {
                    await store.remove(id);
                    next.removed++;
                } else {
                    next.failed++;
                }
                return;
            }
        }
    }

    await Promise.all(ids.map(sendOne));
    if (ids.length) next.afterId = ids[ids.length - 1];
    return { job: next, done: ids.length < limit };
}

/**
 * Normal server (Node / Docker / VPS): run the whole broadcast in a loop,
 * about 25 messages per second, with live progress.
 */
export async function runBroadcastLocal(botApi, store, startJob) {
    let job = startJob;
    let lastEdit = 0;
    try {
        for (;;) {
            const startedAt = Date.now();
            const step = await broadcastStep(botApi, store, job, 25);
            job = step.job;
            if (step.done) break;

            if (Date.now() - lastEdit > 4000) {
                lastEdit = Date.now();
                await editStatus(botApi, job, progressText(job));
            }
            const spent = Date.now() - startedAt;
            if (spent < 1000) await sleep(1000 - spent);
        }
        await editStatus(botApi, job, finishText(job));
    } catch (error) {
        logger.error('Broadcast error:', error.message);
        await editStatus(botApi, job, errorText(job, error));
    }
}
