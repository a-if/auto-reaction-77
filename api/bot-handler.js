import { startMessage, donateMessage, startAnimation, donateAnimation } from './constants.js';
import { getRandomPositiveReaction, escapeHtml } from './helper.js';
import { editStatus, progressText, errorText } from './broadcast.js';
import { logger } from './logger.js';

const TARGETS = {
    users: ['users'],
    groups: ['groups'],
    channels: ['channels'],
    all: ['users', 'groups', 'channels']
};

// Never let a storage problem break reactions
async function safe(task) {
    try {
        await task();
    } catch (error) {
        logger.warn('Storage error:', error.message);
    }
}

/**
 * Handle incoming Telegram Update
 * https://core.telegram.org/bots/api#update
 *
 * @param {Object} data - Telegram update object
 * @param {Object} botApi - TelegramBotAPI instance
 * @param {Array} Reactions - Array of emoji reactions
 * @param {Array} RestrictedChats - Array of restricted chat IDs
 * @param {string} botUsername - Bot username
 * @param {number} RandomLevel - Random level for group reactions (0-10)
 * @param {Object} options - { store, adminIds, enqueueBroadcast, updatesUrl, supportUrl, startAnimation, donateAnimation }
 */
export async function onUpdate(data, botApi, Reactions, RestrictedChats, botUsername, RandomLevel, options = {}) {
    const { store = null, adminIds = [] } = options;
    let chatId, message_id, text;

    if (data.message || data.channel_post) {
        const content = data.message || data.channel_post;
        chatId = content.chat.id;
        message_id = content.message_id;
        text = content.text;

        if (store) await safe(() => store.add(chatId, content.chat.type));

        const [rawCommand = '', arg = ''] = (text || '').trim().split(/\s+/);
        const command = rawCommand.split('@')[0].toLowerCase();
        const isAdmin = !!data.message && content.chat.type === 'private' && adminIds.includes(content.from?.id);

        if (data.message && (text === '/start' || text === '/start@' + botUsername)) {
            await sendStart(botApi, content, botUsername, options);
        } else if (data.message && text === '/reactions') {
            const reactions = Reactions.join(", ");
            await botApi.sendMessage(chatId, "✅ Enabled Reactions : \n\n" + reactions);
        } else if (data.message && (text === '/donate' || text === '/start donate')) {
            await sendDonate(botApi, chatId, options);
        } else if (isAdmin && (command === '/stats' || command === '/users')) {
            await sendStats(botApi, chatId, store);
        } else if (isAdmin && command === '/broadcast') {
            await askBroadcast(botApi, content, arg.toLowerCase(), options);
        } else {
            // Calculate the threshold: higher RandomLevel, lower threshold
            let threshold = 1 - (RandomLevel / 10);
            if (!RestrictedChats.includes(chatId)) {
                // Check if chat is a group or supergroup to determine if reactions should be random
                if (["group", "supergroup"].includes(content.chat.type)) {
                    // Run Function Randomly - According to the RANDOM_LEVEL
                    if (Math.random() <= threshold) {
                        await botApi.setMessageReaction(chatId, message_id, getRandomPositiveReaction(Reactions));
                    }
                } else {
                    // For non-group chats, set the reaction directly
                    await botApi.setMessageReaction(chatId, message_id, getRandomPositiveReaction(Reactions));
                }
            }
        }
    } else if (data.callback_query) {
        await onCallback(data.callback_query, botApi, options);
    } else if (data.my_chat_member) {
        // Bot added / removed, or a user blocked / unblocked the bot
        const { chat, new_chat_member } = data.my_chat_member;
        if (store) {
            if (['kicked', 'left'].includes(new_chat_member?.status)) {
                await safe(() => store.remove(chat.id));
            } else {
                await safe(() => store.add(chat.id, chat.type, { force: true }));
            }
        }
    } else if (data.pre_checkout_query) {
        await botApi.answerPreCheckoutQuery(data.pre_checkout_query.id, true);
        await botApi.sendMessage(data.pre_checkout_query.from.id, "Thank you for your donation! 💝");
    }
}

async function sendStart(botApi, content, botUsername, options) {
    const { updatesUrl = 'https://t.me/PythonBotz', supportUrl, startAnimation: animation = startAnimation } = options;
    const name = escapeHtml(content.chat.type === "private" ? content.from.first_name : content.chat.title);
    const text = startMessage.replace('UserName', name);

    const keyboard = [
        [{ text: "⇆ ADD ME TO YOUR CHANNELS ⇆", url: `https://t.me/${botUsername}?startchannel=botstart` }],
        [{ text: "⇆ ADD ME TO YOUR GROUPS ⇆", url: `https://t.me/${botUsername}?startgroup=botstart` }],
        [
            { text: "• UPDATES •", url: updatesUrl },
            ...(supportUrl ? [{ text: "• SUPPORT •", url: supportUrl }] : [])
        ]
    ];

    if (animation) {
        try {
            await botApi.sendAnimation(content.chat.id, animation, text, keyboard);
            return;
        } catch (error) {
            logger.warn('Start animation failed, sending text only:', error.message);
        }
    }
    await botApi.sendMessage(content.chat.id, text, keyboard);
}

async function sendDonate(botApi, chatId, options) {
    const { donateAnimation: animation = donateAnimation } = options;

    if (animation) {
        try {
            await botApi.sendAnimation(chatId, animation, "🙏 <b>Support Auto Reaction Bot</b> ✨");
        } catch (error) {
            logger.warn('Donate animation failed, sending invoice only:', error.message);
        }
    }
    await botApi.sendInvoice(
        chatId,
        "Donate to Auto Reactions Bot ✨",
        donateMessage,
        '{}',
        '',
        'donate',
        'XTR',
        [{ label: 'Pay ⭐️5', amount: 5 }],
    );
}

async function sendStats(botApi, chatId, store) {
    if (!store) return notConfigured(botApi, chatId);
    const { users, groups, channels } = await store.counts();
    await botApi.sendMessage(
        chatId,
        `📊 <b>Bot Stats</b>\n\n` +
        `👤 Users: <b>${users}</b>\n` +
        `👥 Groups: <b>${groups}</b>\n` +
        `📢 Channels: <b>${channels}</b>\n\n` +
        `🧮 Total: <b>${users + groups + channels}</b>`
    );
}

// Step 1: admin replies to a message with /broadcast [users|groups|channels|all]
async function askBroadcast(botApi, content, target, { store = null, enqueueBroadcast = null }) {
    const chatId = content.chat.id;
    if (!store || !enqueueBroadcast) return notConfigured(botApi, chatId);

    const reply = content.reply_to_message;
    if (!reply) {
        await botApi.sendMessage(
            chatId,
            `📢 <b>Broadcast</b>\n\n` +
            `Send the message you want to broadcast, then <b>reply</b> to it with:\n\n` +
            `<code>/broadcast</code> - all users (default)\n` +
            `<code>/broadcast groups</code>\n` +
            `<code>/broadcast channels</code>\n` +
            `<code>/broadcast all</code> - users + groups + channels\n\n` +
            `Text, photos, videos, buttons - everything is copied as it is.`
        );
        return;
    }

    const targetName = TARGETS[target] ? target : 'users';
    const counts = await store.counts();
    const total = TARGETS[targetName].reduce((sum, kind) => sum + counts[kind], 0);

    if (total === 0) {
        await botApi.sendMessage(chatId, `⚠️ No ${targetName === 'all' ? 'chats' : targetName} found yet.`);
        return;
    }

    await botApi.sendMessage(
        chatId,
        `📢 Send the replied message to <b>${total}</b> ${targetName === 'all' ? 'chats' : targetName}?`,
        [[
            { text: "✅ Send now", callback_data: `bc:${targetName}:${chatId}:${reply.message_id}` },
            { text: "❌ Cancel", callback_data: "bcx" }
        ]]
    );
}

// Step 2: admin taps Send now / Cancel
async function onCallback(query, botApi, options) {
    const { store = null, adminIds = [], enqueueBroadcast = null } = options;
    const data = query.data || '';
    if (!data.startsWith('bc')) return;

    if (!adminIds.includes(query.from.id)) {
        await botApi.answerCallbackQuery(query.id, 'Not allowed', true);
        return;
    }

    const statusChatId = query.message.chat.id;
    const statusMessageId = query.message.message_id;

    if (data === 'bcx') {
        await botApi.answerCallbackQuery(query.id);
        await botApi.editMessageText(statusChatId, statusMessageId, '❌ Broadcast cancelled.');
        return;
    }

    const [, target, fromChatId, messageId] = data.split(':');
    if (!store || !enqueueBroadcast || !TARGETS[target] || !fromChatId || !messageId) {
        await botApi.answerCallbackQuery(query.id, 'Invalid request', true);
        return;
    }

    const counts = await store.counts();
    const job = {
        kinds: TARGETS[target],
        fromChatId: Number(fromChatId),
        messageId: Number(messageId),
        statusChatId,
        statusMessageId,
        afterId: Number.MIN_SAFE_INTEGER,
        total: TARGETS[target].reduce((sum, kind) => sum + counts[kind], 0),
        sent: 0,
        failed: 0,
        removed: 0,
        startedAt: Date.now()
    };

    await botApi.answerCallbackQuery(query.id);
    await editStatus(botApi, job, progressText(job));
    try {
        // Returns right away: the broadcast itself runs in the background / queue
        await enqueueBroadcast(job);
    } catch (error) {
        logger.error('Could not start broadcast:', error.message);
        await editStatus(botApi, job, errorText(job, error));
    }
}

async function notConfigured(botApi, chatId) {
    await botApi.sendMessage(chatId, "⚠️ Database / queue is not configured. Check the setup steps in the README.");
}
