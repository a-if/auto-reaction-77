import fs from 'node:fs';
import path from 'node:path';
import { chatKind } from './helper.js';
import { logger } from './logger.js';

/**
 * JSON-file storage for users / groups / channels (Node, VPS, Docker, Render).
 * Needs a disk that survives restarts. Not for Vercel / Heroku free dynos.
 */
export function createFileStore(dir = './data') {
    const file = path.join(dir, 'chats.json');
    const chats = new Map(); // id -> 'users' | 'groups' | 'channels'

    try {
        if (fs.existsSync(file)) {
            for (const [id, kind] of Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')))) {
                chats.set(Number(id), kind);
            }
        }
    } catch (error) {
        logger.warn(`Could not read ${file}: ${error.message}`);
        try { fs.copyFileSync(file, file + '.bad'); } catch { /* ignore */ }
    }

    let timer = null;

    function flush() {
        try {
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(file + '.tmp', JSON.stringify(Object.fromEntries(chats)));
            fs.renameSync(file + '.tmp', file);
        } catch (error) {
            logger.warn(`Could not save ${file}: ${error.message}`);
        }
    }

    function scheduleSave() {
        if (timer) return;
        timer = setTimeout(() => { timer = null; flush(); }, 1000);
    }

    return {
        flush,
        async add(id, type, options) {
            const kind = chatKind(type);
            if (!kind || chats.get(id) === kind) return;
            chats.set(id, kind);
            scheduleSave();
        },
        async remove(id) {
            if (chats.delete(id)) scheduleSave();
        },
        async counts() {
            const counts = { users: 0, groups: 0, channels: 0 };
            for (const kind of chats.values()) if (kind in counts) counts[kind]++;
            return counts;
        },
        async ids(kinds, afterId = Number.MIN_SAFE_INTEGER, limit = Infinity) {
            return [...chats]
                .filter(([id, kind]) => id > afterId && kinds.includes(kind))
                .map(([id]) => id)
                .sort((a, b) => a - b)
                .slice(0, limit);
        }
    };
}
