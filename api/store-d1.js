import { chatKind } from './helper.js';

const SEEN_TTL = 10 * 60 * 1000; // skip DB writes for chats seen in the last 10 minutes

/**
 * Cloudflare D1 storage for users / groups / channels (free plan friendly).
 * The table is created automatically on first use.
 */
export function createD1Store(db) {
    const seen = new Map(); // per-isolate cache so most updates never touch the DB
    let ready = null;

    function init() {
        if (!ready) {
            ready = db
                .prepare('CREATE TABLE IF NOT EXISTS chats (id INTEGER PRIMARY KEY, kind TEXT NOT NULL)')
                .run()
                .catch((error) => { ready = null; throw error; });
        }
        return ready;
    }

    return {
        async add(id, type, { force = false } = {}) {
            const kind = chatKind(type);
            if (!kind) return;
            const last = seen.get(id);
            if (!force && last && Date.now() - last < SEEN_TTL) return;
            await init();
            await db.prepare('INSERT OR IGNORE INTO chats (id, kind) VALUES (?1, ?2)').bind(id, kind).run();
            seen.set(id, Date.now());
        },
        async remove(id) {
            await init();
            seen.delete(id);
            await db.prepare('DELETE FROM chats WHERE id = ?1').bind(id).run();
        },
        async counts() {
            await init();
            const { results } = await db.prepare('SELECT kind, COUNT(*) AS n FROM chats GROUP BY kind').all();
            const counts = { users: 0, groups: 0, channels: 0 };
            for (const row of results) if (row.kind in counts) counts[row.kind] = row.n;
            return counts;
        },
        // Keyset pagination: chats of the given kinds with id > afterId, ascending
        async ids(kinds, afterId = Number.MIN_SAFE_INTEGER, limit = 1000000) {
            await init();
            const marks = kinds.map((_, i) => `?${i + 3}`).join(',');
            const { results } = await db
                .prepare(`SELECT id FROM chats WHERE id > ?1 AND kind IN (${marks}) ORDER BY id LIMIT ?2`)
                .bind(afterId, limit, ...kinds)
                .all();
            return results.map((row) => row.id);
        }
    };
}
