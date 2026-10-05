# Auto Reaction Bot

Telegram bot that reacts to every message in channels, groups and private chats with a random emoji. Runs free on Cloudflare Workers.

## Commands

| Command | Who | What it does |
| --- | --- | --- |
| `/start` | everyone | Welcome message with buttons |
| `/reactions` | everyone | Shows the enabled emojis |
| `/donate` | everyone | Telegram Stars donation invoice |
| `/stats` or `/users` | admins | Number of users, groups and channels |
| `/broadcast` | admins | Reply to any message with `/broadcast [users\|groups\|channels\|all]` (default: users). A confirm button is shown first. |

Broadcast copies the message exactly (text, photo, video, buttons) with no "forwarded" tag. Chats that blocked the bot or removed it are cleaned up automatically.

## Deploy on Cloudflare (one click)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/a-if/Reactions/tree/main)

Use the button above. Cloudflare will clone the repository, provision the D1 database and Queue, and show the required bot configuration during deployment. Deploy-to-Cloudflare supports automatic provisioning of D1 and Queues, and supports environment variables and secrets in the deployment setup.

### Required values

- `BOT_TOKEN` — required secret from `@BotFather`.
- `BOT_USERNAME` — your bot username without `@`.
- `EMOJI_LIST` — default reactions are already provided.
- `ADMIN_IDS` — optional; comma-separated Telegram user IDs for `/stats` and `/broadcast`.

The D1 database and `broadcast-queue` are declared with default resource values so the Deploy button can provision them automatically. You no longer need to manually run `wrangler d1 create` or `wrangler queues create` for a fresh deployment.

After deployment, open the Worker URL once. The Worker automatically calls Telegram's `setWebhook` using its current origin, so a separate webhook command is normally not required.

> **Security:** never put your real `BOT_TOKEN` in `wrangler.toml`, source code, or a public Git repository. Cloudflare recommends storing sensitive values as Worker secrets.

### Manual CLI deployment

If you prefer Wrangler: `npx wrangler deploy`. The required `BOT_TOKEN` is validated from the Worker secrets configuration.

## Other hosts

`npm start` runs the same bot as a normal Node server (VPS, Docker, Render). Users are then saved in `data/chats.json` (`DATA_DIR` to change), so the disk must survive restarts. See `.env.example` for all settings.
