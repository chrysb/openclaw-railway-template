# OpenClaw Railway Template

Deploy OpenClaw to Railway in one click. Get a 24/7 AI agent connected to Telegram or Discord, with your entire config and workspace backed up to GitHub.

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/2VgcTk?referralCode=jcFhp_)

## What you get

- **OpenClaw Gateway** running 24/7
- **Everything version controlled** — config, cron jobs, workspace, and memory backed up to GitHub automatically
- **Telegram or Discord** configured out of the box
- **Secrets never committed** — raw API keys are replaced with `${ENV_VAR}` references before pushing to GitHub

## ⚠️ Important: Get these ready before you deploy

Railway will ask for these during deploy. Have them copied and ready to paste:

1. ✅ **Anthropic API key** or **setup token** — for the AI model
2. ✅ **GitHub personal access token** — for backing up your agent's config and workspace
3. ✅ **Empty private GitHub repo** — where your agent's state will be pushed
4. ✅ **Telegram bot token** or **Discord bot token** — so you can talk to your agent

---

### How to get each one

<details>
<summary><strong>Anthropic API key (recommended)</strong></summary>

1. Go to [console.anthropic.com](https://console.anthropic.com/)
2. Navigate to **API Keys** → **Create Key**
3. Copy the key — paste it as `ANTHROPIC_API_KEY` during deploy

</details>

<details>
<summary><strong>Anthropic setup token (alternative)</strong></summary>

Uses your Claude Pro/Max subscription instead of API billing.

1. Install Claude Code: `npm install -g @anthropic-ai/claude-code`
2. Run `claude` and complete the OAuth login
3. Run `claude setup-token`
4. Copy the token — paste it as `ANTHROPIC_TOKEN` during deploy

*Note: Anthropic has stated that using setup tokens outside of Claude Code may violate their terms of service.*

</details>

<details>
<summary><strong>GitHub personal access token + repo</strong></summary>

1. Create a **new private repo** on GitHub — leave it completely empty (no README, no .gitignore)
2. Go to [github.com/settings/tokens](https://github.com/settings/tokens) → **Generate new token (classic)**
3. Give it `repo` scope
4. Copy the token — paste it as `GITHUB_TOKEN` during deploy
5. Paste the repo in any format as `GITHUB_WORKSPACE_REPO`:
   - `username/my-agent`
   - `git@github.com:username/my-agent.git`
   - `https://github.com/username/my-agent.git`

</details>

<details>
<summary><strong>Telegram bot token</strong></summary>

1. Open Telegram and search for **@BotFather**
2. Send `/newbot`
3. Pick a name (e.g. "My AI Assistant")
4. Pick a username (must end in `bot`, e.g. `my_ai_assistant_bot`)
5. Copy the token BotFather gives you (looks like `123456789:AAHdq...`)
6. Paste it as `TELEGRAM_BOT_TOKEN` during deploy

</details>

<details>
<summary><strong>Discord bot token</strong></summary>

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. **New Application** → name it
3. Go to **Bot** tab → **Reset Token** → copy it
4. Enable **Message Content Intent** under Privileged Gateway Intents
5. Go to **OAuth2** → URL Generator → select `bot` scope + `Send Messages` permission
6. Open the generated URL to invite the bot to your server
7. Paste the token as `DISCORD_BOT_TOKEN` during deploy

</details>

<details>
<summary><strong>Brave API key (optional, enables web search)</strong></summary>

1. Go to [brave.com/search/api](https://brave.com/search/api/)
2. Sign up for the **Free** plan (2,000 queries/month)
3. Go to your dashboard → copy the API key
4. Paste it as `BRAVE_API_KEY` during deploy

</details>

---

## Deploy

Once you have everything ready, click the button:

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/2VgcTk?referralCode=jcFhp_)

### All variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | 🔀 Pick one | From Anthropic console (recommended) |
| `ANTHROPIC_TOKEN` | 🔀 Pick one | From `claude setup-token` |
| `GITHUB_TOKEN` | ✅ Required | GitHub PAT with `repo` scope |
| `GITHUB_WORKSPACE_REPO` | ✅ Required | Your repo (any format) |
| `TELEGRAM_BOT_TOKEN` | 🔀 Pick one | From BotFather |
| `DISCORD_BOT_TOKEN` | 🔀 Pick one | From Discord Developer Portal |
| `OPENCLAW_GATEWAY_TOKEN` | 🔒 Auto | Auto-generated, secures your gateway |
| `PORT` | 🔒 Auto | Set by Railway |
| `WEBHOOK_TOKEN` | 🔒 Auto | Auto-generated, secures webhook endpoints |
| `GIT_EMAIL` | Optional | For commits (default: agent@openclaw.ai) |
| `GIT_NAME` | Optional | For commits (default: OpenClaw Agent) |
| `OPENAI_API_KEY` | Optional | For OpenAI models + memory embeddings |
| `GEMINI_API_KEY` | Optional | For Gemini models + memory embeddings |
| `BRAVE_API_KEY` | Optional | For web search |
| `NOTION_API_KEY` | Optional | For Notion integration |

## After deploy

> Make sure you've added `TELEGRAM_BOT_TOKEN` or `DISCORD_BOT_TOKEN` in your Railway variables before this step.

1. **DM your bot** on Telegram (or Discord)
2. The bot will reply with a pairing code:
   ```
   OpenClaw: access not configured.
   Your Telegram user id: 123456789
   Pairing code: ABC123
   Ask the bot owner to approve with:
   openclaw pairing approve telegram ABC123
   ```
3. **Approve the pairing** — you need to run a command inside your Railway container:

   You need to run a command inside your Railway container using the Railway CLI:

   ```bash
   # Install the Railway CLI if you haven't
   npm install -g @railway/cli

   # Login to Railway
   railway login

   # Link to your project (follow the prompts)
   railway link

   # SSH into your running container
   railway ssh

   # Once inside, approve the pairing
   npx openclaw pairing approve telegram ABC123
   ```

   Replace `ABC123` with the actual code from step 2, and `telegram` with `discord` if using Discord.

4. DM the bot again — you're live!

Check your GitHub repo — you should see the initial commit with your agent's full config and workspace.

> **Memory search:** For your agent to semantically search its own memory, you need either `OPENAI_API_KEY` or `GEMINI_API_KEY` set. OpenClaw uses these to generate embeddings. Without one, memory recall won't work.

## How it works

```
/data/.openclaw/           ← Railway volume + git repo
├── openclaw.json          ← Config (secrets → ${ENV_VAR} references)
├── cron/jobs.json         ← Scheduled tasks
├── .gitignore             ← Excludes keys, logs, caches
├── agents/                ← Session state
└── workspace/             ← Agent workspace
    ├── AGENTS.md          ← Agent instructions
    ├── TOOLS.md           ← Tool notes + git discipline
    ├── HEARTBEAT.md       ← Periodic check instructions
    ├── skills/            ← Agent skills
    └── memory/            ← Agent memory
```

### First boot

1. Git repo initialized at `/data/.openclaw/`
2. `openclaw onboard` scaffolds config and workspace
3. Telegram/Discord configured automatically
4. Secrets sanitized — raw values replaced with `${ENV_VAR}` references
5. Everything committed and pushed to your GitHub repo
6. Gateway starts

### Subsequent boots

Config exists, gateway starts immediately. Your agent commits and pushes changes during normal operation.

## Troubleshooting

### Pairing

First time you DM the bot, it replies with a pairing code. You need to approve it by running the command shown in the bot's reply. Use Railway's CLI (`railway shell`) or the deploy logs to run it.

### Bot doesn't respond

- Check deploy logs for errors
- Verify your channel token is correct
- Redeploy to pick up variable changes

### Gateway crash loop

- Ensure the Railway volume is mounted at `/data`
- Check Anthropic credentials are valid
- Check deploy logs for the specific error

## Links

- [OpenClaw docs](https://docs.openclaw.ai)
- [OpenClaw GitHub](https://github.com/openclaw/openclaw)
- [Community Discord](https://discord.com/invite/clawd)
