# OpenClaw Railway Template

Deploy OpenClaw to Railway in one click. Get a 24/7 AI agent with persistent memory, connected to Telegram (or Discord).

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/2VgcTk?referralCode=jcFhp_)

## What you get

- **OpenClaw Gateway** running 24/7 on Railway
- **Persistent storage** — memory, config, and workspace survive redeploys
- **Telegram or Discord** connected out of the box
- **Workspace git sync** — optionally back up your agent's workspace to GitHub

## Setup

### 1. Get your tokens ready

Before clicking Deploy, you'll need:

**Required (pick one):**
- **Anthropic setup token** (recommended) — see [Getting an Anthropic token](#getting-an-anthropic-token) below
- **Anthropic API key** — [console.anthropic.com](https://console.anthropic.com/) → API Keys → Create Key

**At least one channel:**
- **Telegram bot token** — see [Getting a Telegram bot token](#getting-a-telegram-bot-token) below
- **Discord bot token** — see [Getting a Discord bot token](#getting-a-discord-bot-token) below

### 2. Deploy

Click the Deploy button above. Railway will ask you to fill in environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_TOKEN` | Pick one | Anthropic setup token (recommended, includes usage tracking) |
| `ANTHROPIC_API_KEY` | Pick one | Anthropic API key (direct billing) |
| `TELEGRAM_BOT_TOKEN` | Pick one | Telegram bot token from BotFather |
| `DISCORD_BOT_TOKEN` | Pick one | Discord bot token |
| `GATEWAY_AUTH_TOKEN` | Auto | Auto-generated, protects your gateway |
| `GITHUB_TOKEN` | Optional | For workspace git backup |
| `WORKSPACE_REPO` | Optional | e.g. `username/my-workspace` |
| `NOTION_API_KEY` | Optional | For Notion integration |
| `OPENAI_API_KEY` | Optional | For OpenAI models |
| `GEMINI_API_KEY` | Optional | For Gemini models |

### 3. Connect

Once deployed:

1. **Telegram:** DM your bot on Telegram
2. **Discord:** Invite the bot to your server and DM it
3. The bot will ask you to approve pairing — follow the instructions in the Railway deploy logs

## Getting an Anthropic token

The setup token is the easiest way to authenticate. It uses your existing Claude Pro/Max subscription (no separate API billing).

1. Install Claude Code: `npm install -g @anthropic-ai/claude-code`
2. Run `claude` and complete the OAuth login in your browser
3. Run `claude setup-token`
4. Copy the token it outputs
5. Paste it into the `ANTHROPIC_TOKEN` field on the Railway deploy form

Alternatively, if you just want to use an API key:
1. Go to [console.anthropic.com](https://console.anthropic.com/)
2. Navigate to API Keys → Create Key
3. Paste it into the `ANTHROPIC_API_KEY` field on the Railway deploy form

If both are set, the setup token takes priority.

## Getting a Telegram bot token

1. Open Telegram and search for **@BotFather**
2. Send `/newbot`
3. Choose a name (e.g. "My AI Assistant")
4. Choose a username (must end in `bot`, e.g. `my_ai_assistant_bot`)
5. BotFather gives you a token like `123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw`
6. Copy it and paste it as `TELEGRAM_BOT_TOKEN` when deploying

## Getting a Discord bot token

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. **New Application** → name it
3. Go to **Bot** tab → click **Reset Token** → copy the token
4. **Important:** Under Privileged Gateway Intents, enable **Message Content Intent**
5. Go to **OAuth2** → URL Generator → select `bot` scope + `Send Messages` permission
6. Open the generated URL to invite the bot to your server
7. Paste the token as `DISCORD_BOT_TOKEN` when deploying

## Architecture

```
Railway Container
├── /data/.openclaw/          ← Persistent volume
│   ├── openclaw.json         ← Config (auto-generated on first boot)
│   ├── workspace/            ← Agent workspace (memory, skills, tools)
│   └── agents/               ← Session state
├── /app/scripts/setup.sh     ← Runs on every boot
└── openclaw gateway          ← The agent runtime
```

On first boot, `setup.sh` runs `openclaw onboard` to scaffold the config. On subsequent boots, it patches in any updated channel tokens and starts the gateway.

## Adding a workspace repo

To back up your agent's workspace to GitHub:

1. Create a private repo on GitHub (e.g. `my-agent-workspace`)
2. Create a [personal access token](https://github.com/settings/tokens) with `repo` scope
3. Add these variables in Railway:
   - `GITHUB_TOKEN` = your token
   - `WORKSPACE_REPO` = `username/my-agent-workspace`
4. Redeploy — the workspace will be cloned on first boot and pulled on restarts

Your agent will automatically commit and push changes to this repo.

## Troubleshooting

### "pairing required" when DMing the bot

This is normal on first connect. Check the Railway deploy logs for the pairing code, or visit the OpenClaw Control UI at `https://your-app.up.railway.app/openclaw` to approve.

### Bot doesn't respond

- Check Railway deploy logs for errors
- Make sure `TELEGRAM_BOT_TOKEN` or `DISCORD_BOT_TOKEN` is set correctly
- Redeploy to pick up any variable changes

### Gateway crash loop

- Ensure the volume is mounted at `/data`
- Check that `ANTHROPIC_API_KEY` is valid
- Look at deploy logs for the specific error

## Links

- [OpenClaw docs](https://docs.openclaw.ai)
- [OpenClaw GitHub](https://github.com/openclaw/openclaw)
- [Community Discord](https://discord.com/invite/clawd)
