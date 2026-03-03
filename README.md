**⚠️ This project is still under development, use at your own risk ⚠️**

# AlphaClaw Deployment Template

Deploy OpenClaw to Render or Railway in one click. Get a 24/7 AI agent connected to Telegram or Discord, with your entire config and workspace backed up to GitHub. No CLI required.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/pixel-heart/openclaw-template)
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/openclaw-fast-start?referralCode=jcFhp_&utm_medium=integration&utm_source=template&utm_campaign=generic)

## The AlphaClaw Advantage

- **OpenClaw Gateway** running 24/7
- **Everything version controlled** — config, cron jobs, workspace, and memory backed up to GitHub automatically
- **Telegram or Discord** configured out of the box (add/remove channels anytime via the UI)
- **Google Workspace integration** — connect Gmail, Calendar, Drive, Contacts, and Sheets with a few clicks via built-in OAuth flow
- **Secrets never committed** — raw API keys are replaced with `${ENV_VAR}` references before pushing to GitHub
- **Prompt hardening** — improve change visibility and reduce silent/partial edits so your OpenClaw project stays stable over time
- **Setup UI** — web-based onboarding, env var management, channel pairing, and gateway control
- **Webhook proxy** — single exposed port handles both the setup UI and gateway webhooks

## Convenient Setup UI

<img width="5594" height="3646" alt="image" src="https://github.com/user-attachments/assets/6aa18214-5870-4e01-9ff4-b23e0353179e" />

## Deploy

Only one variable is required at deploy time. The rest are generated or set by the platform:

| Variable                 | Required    | Description                                    |
| ------------------------ | ----------- | ---------------------------------------------- |
| `SETUP_PASSWORD`         | ✅ Required | Password for the setup UI                      |
| `OPENCLAW_GATEWAY_TOKEN` | 🔒 Auto     | Render auto-generates; set manually on Railway |
| `PORT`                   | ✅ Required | `8080` on Render and Railway                   |
| `WEBHOOK_TOKEN`          | 🔒 Auto     | Auto-generated, secures webhook endpoints      |

Click a button to deploy:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/pixel-heart/openclaw-template)
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/openclaw-fast-start?referralCode=jcFhp_&utm_medium=integration&utm_source=template&utm_campaign=generic)

Everything else — AI keys, GitHub credentials, channel tokens — is configured through the setup UI after your first login.

### Render

The Render Blueprint (`render.yaml`) configures the service, disk, and required env vars automatically. You will be prompted to set `SETUP_PASSWORD` during deploy.

### Railway

After deploying on Railway, make sure these settings are in place:

- Enable HTTP Proxy for the service on port `8080`
- Attach a volume mounted at `/data`
- Set variables: `SETUP_PASSWORD`, `PORT=8080`, and `OPENCLAW_GATEWAY_TOKEN`

## First-time setup

After deploying, visit your app URL (e.g. `https://your-app.onrender.com` or `https://your-app.up.railway.app`).

### 1. Log in with your setup password

### 2. Complete the welcome screen

The welcome screen walks you through selecting your default model and entering the minimum required variables:

- **Model** (required): Pulled dynamically from your installed OpenClaw model catalog
- **AI Provider auth** (required for selected model): Anthropic API Key/Setup Token, OpenAI API Key, Gemini API Key, or OpenAI Codex OAuth
- **GitHub**: Personal access token + a repo (`owner/repo`) for backing up your agent's state
- **Channel** (at least one): Telegram Bot Token or Discord Bot Token

Each field includes instructions and links for how to get the value. Optional fields (like Brave Search API Key) can be filled in later from the Envars tab.

> **Model catalog note:** Models are discovered at runtime via `openclaw models list --all --json`. This keeps the setup UI aligned with the OpenClaw version installed in your deployment.
>
> **Versioning note:** Template builds intentionally install `openclaw@latest` during Docker build, so new deploys pick up the newest OpenClaw release automatically.
>
> **Codex OAuth note:** OpenClaw onboarding runs in non-interactive mode here. For OAuth-only Codex setups, the wrapper uses `--auth-choice skip` and then applies your selected `openai-codex/*` model after onboarding.

Click **Complete Setup** — the server runs onboarding, configures channels, and pushes an initial commit to your GitHub repo. This takes 10–15 seconds.

### 3. Approve channel pairing

DM your bot on Telegram (or Discord). The setup UI shows "Send a message to your bot on Telegram or Discord" with pending pairings polling every second. Click **Approve** to connect.

### 4. Connect Google Workspace (optional)

Once at least one channel is paired, the Google Workspace section appears:

1. Click **Set up Google** and enter your OAuth client credentials (from [Google Cloud Console](https://console.cloud.google.com/apis/credentials))
2. Select which permissions to grant
3. Click **Sign in with Google** to complete the OAuth flow
4. The UI shows API status for each service — click **Enable API** links for any that need enabling

### 5. Start chatting

DM your bot again — you're live!

Check your GitHub repo — you should see the initial commit with your agent's full config and workspace.

> **Memory search:** For your agent to semantically search its own memory, you need either `OPENAI_API_KEY` or `GEMINI_API_KEY` set. OpenClaw uses these to generate embeddings. Without one, memory recall won't work.

## Managing environment variables

The **Envars** tab lets you:

- View and edit all configured environment variables
- See which vars are set (values masked by default, click Show to reveal)
- Add custom variables — supports pasting multiple `KEY=VALUE` lines at once
- Delete custom variables with the ✕ button
- Save changes to the persistent `/data/.env` file
- Apply saved changes to bot runtime by clicking **Restart Gateway** after saving changes

The **Models** tab lets you:

- Set your primary model after onboarding
- Manage AI provider keys and Codex OAuth connection

Adding or removing a channel token (e.g. `DISCORD_BOT_TOKEN`) automatically enables/disables that channel in the OpenClaw config using `openclaw channels add/remove`.

The server watches `/data/.env` for changes — including ones written by the OpenClaw agent itself. When the agent needs an API key for a tool, it adds a placeholder to `/data/.env` and tells you to visit the Envars tab to fill it in.

### All configurable variables

| Variable                   | Group       | Description                                                                                                                    |
| -------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `ANTHROPIC_API_KEY`        | AI Provider | From [console.anthropic.com](https://console.anthropic.com/) (recommended)                                                     |
| `ANTHROPIC_TOKEN`          | AI Provider | From `claude setup-token`                                                                                                      |
| `OPENAI_API_KEY`           | AI Provider | From [platform.openai.com](https://platform.openai.com/)                                                                       |
| `(no env var) Codex OAuth` | AI Provider | Connected via setup UI OAuth flow (ChatGPT subscription/Codex); stored in OpenClaw auth profiles                               |
| `GEMINI_API_KEY`           | AI Provider | From [aistudio.google.com](https://aistudio.google.com/)                                                                       |
| `GITHUB_TOKEN`             | GitHub      | Personal access token with `repo` scope from [github.com/settings/tokens](https://github.com/settings/tokens)                  |
| `GITHUB_WORKSPACE_REPO`    | GitHub      | `owner/repo` (or `https://github.com/owner/repo`)                                                                              |
| `TELEGRAM_BOT_TOKEN`       | Channels    | From [@BotFather](https://t.me/BotFather) · [full guide](https://docs.openclaw.ai/channels/telegram)                           |
| `DISCORD_BOT_TOKEN`        | Channels    | From [Developer Portal](https://discord.com/developers/applications) · [full guide](https://docs.openclaw.ai/channels/discord) |
| `BRAVE_API_KEY`            | Tools       | From [brave.com/search/api](https://brave.com/search/api/) — free tier available                                               |

## Architecture

```
Internet → Render/Railway :$PORT (Express)
├── /                          → Setup UI (auth required)
├── /setup                     → Setup UI (auth required)
├── /api/status, /api/env ...  → Express handles (setup endpoints)
├── /api/* (everything else)   → proxy → gateway :18789
├── /webhook/*                 → proxy → gateway :18789 (token → Bearer header)
├── /openclaw                  → proxy → gateway :18789 (gateway control UI)
├── /assets/*                  → proxy → gateway :18789 (gateway UI assets)
└── WebSocket upgrade          → proxy → gateway :18789
```

### File layout

```
/data/.openclaw/           ← Render disk or Railway volume + git repo
├── openclaw.json          ← Config (secrets → ${ENV_VAR} references)
├── skills/                ← Agent skills (control-ui installed on onboard)
├── cron/jobs.json         ← Scheduled tasks
├── .gitignore             ← Excludes keys, logs, caches
├── agents/                ← Session state
└── workspace/             ← Agent workspace
    ├── hooks/bootstrap/   ← Deploy-synced prompt templates
    │   ├── AGENTS.md      ← Injected by bootstrap-extra-files
    │   └── TOOLS.md       ← Injected by bootstrap-extra-files
    ├── HEARTBEAT.md       ← Periodic check instructions
    └── memory/            ← Agent memory

/data/.env                 ← Persistent env vars (managed via Setup UI)
```

### First boot

1. Container starts, installs dependencies
2. Server starts and serves the setup UI at `/`
3. User completes the welcome screen with required variables
4. Server runs `openclaw onboard`, configures channels, sanitizes secrets, and enables `bootstrap-extra-files` with `hooks/bootstrap/*`
5. Everything committed and pushed to your GitHub repo
6. Gateway starts

### Subsequent boots

1. `/data/.env` is loaded, bootstrap prompt templates are synced into `workspace/hooks/bootstrap`, and channel config is synced to match available tokens
2. Gateway starts
3. Setup UI available at `/` for managing env vars, channels, and pairings

### Gateway management

- **Status**: The setup UI checks if the gateway is listening on its port in real-time
- **Restart**: Click "Restart" in the General tab — runs `openclaw gateway install --force` then `openclaw gateway restart`
- **Channel sync**: Adding/removing channel tokens in the Envars tab automatically runs `openclaw channels add/remove`

## Local development

```bash
cp .env.example .env     # or create .env with SETUP_PASSWORD=...
docker compose up --build
open http://localhost:3000
```

To mirror production, set `PORT=8080` in `.env` before running `docker compose up`.

## Troubleshooting

### Pairing

First time you DM the bot, it sends a pairing request. Approve it in the setup UI. Pairings poll every second when pending — if nothing appears, check that the channel token is correct in the Envars tab.

### Bot doesn't respond

- Check deploy logs for errors
- Verify your channel token is correct (Envars tab)
- Try clicking Restart in the General tab
- Check gateway status — should show green "running"

### Gateway won't start

- Ensure a persistent disk/volume is mounted at `/data` (Render disk or Railway volume)
- Check that AI provider credentials are valid
- Check deploy logs for the specific error — common cause is a missing env var referenced in `openclaw.json`

### Channel shows "Add token"

The channel's env var is empty or missing. Go to the Envars tab, add the token, and save. The channel will be automatically enabled in the config.

## Links

- [OpenClaw docs](https://docs.openclaw.ai)
- [OpenClaw GitHub](https://github.com/openclaw/openclaw)
- [Community Discord](https://discord.com/invite/clawd)
