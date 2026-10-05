import express from 'express';
import dotenv from 'dotenv';
import TelegramBotAPI from './TelegramBotAPI.js';
import { htmlContent } from './constants.js';
import { splitEmojis, getChatIds } from './helper.js';
import { createFileStore } from './store-file.js';
import { runBroadcastLocal } from './broadcast.js';
import { onUpdate } from './bot-handler.js';
import { logger } from './logger.js';

dotenv.config();

const app = express();
app.use(express.json());

const botToken = process.env.BOT_TOKEN;
const botUsername = process.env.BOT_USERNAME;
const Reactions = splitEmojis(process.env.EMOJI_LIST);
const RestrictedChats = getChatIds(process.env.RESTRICTED_CHATS);
const RandomLevel = parseInt(process.env.RANDOM_LEVEL || '0', 10);

const botApi = new TelegramBotAPI(botToken);

// Users / groups / channels storage (for /stats and /broadcast)
const store = createFileStore(process.env.DATA_DIR || './data');
const options = {
    store,
    adminIds: getChatIds(process.env.ADMIN_IDS),
    updatesUrl: process.env.UPDATES_URL || undefined,
    supportUrl: process.env.SUPPORT_URL || undefined,
    startAnimation: process.env.START_ANIMATION || undefined,
    donateAnimation: process.env.DONATE_ANIMATION || undefined,
    enqueueBroadcast: async (job) => {
        if (broadcastRunning) throw new Error('A broadcast is already running');
        broadcastRunning = true;
        runBroadcastLocal(botApi, store, job).finally(() => { broadcastRunning = false; });
    }
};
let broadcastRunning = false;

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => { store.flush(); process.exit(0); });
}

app.post('/', async (req, res) => {
    const data = req.body;
    try {
        await onUpdate(data, botApi, Reactions, RestrictedChats, botUsername, RandomLevel, options);
        res.status(200).send('Ok');
    } catch (error) {
        logger.error('Error in onUpdate:', error.message);
        res.status(200).send('Ok');
    }
});

app.get('/', (req, res) => {
    res.send(htmlContent);
});

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
        botConfigured: !!botToken && !!botUsername
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    logger.info(`Server is running on port ${PORT}`);
});
