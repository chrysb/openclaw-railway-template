# OpenClaw on Railway

One-click deploy for [OpenClaw](https://openclaw.ai) — the open-source AI agent framework.

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/template/TEMPLATE_ID)

## What You Get

- OpenClaw gateway running 24/7
- Persistent workspace (survives redeploys)
- Google Calendar + Gmail integration (via gog CLI)
- Auto-configures Telegram or Discord from env vars

## Required Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |

## Channel (pick one)

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | From [@BotFather](https://t.me/BotFather) |
| `DISCORD_BOT_TOKEN` | From [Discord Developer Portal](https://discord.com/developers/applications) |

## Optional: Workspace Git Backup

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | GitHub personal access token (repo scope) |
| `WORKSPACE_REPO` | Repo path, e.g. `yourname/my-agent-workspace` |
| `GIT_EMAIL` | Git commit email (default: agent@openclaw.ai) |
| `GIT_NAME` | Git commit name (default: OpenClaw Agent) |

## Optional: Google Workspace

| Variable | Description |
|----------|-------------|
| `GOG_CLIENT_CREDENTIALS_JSON` | OAuth credentials JSON (single line) |
| `GOG_REFRESH_TOKEN` | OAuth refresh token |
| `GOG_ACCOUNT` | Google account email |
| `GOG_REFRESH_TOKEN_AGENT` | Second account refresh token (optional) |
| `GOG_ACCOUNT_AGENT` | Second account email (optional) |

## How It Works

1. On first boot, creates a default `openclaw.json` with your channel config
2. If `WORKSPACE_REPO` is set, clones your workspace from GitHub
3. On subsequent restarts, pulls latest workspace changes
4. Restores Google credentials from env vars (they're ephemeral)
5. Starts the OpenClaw gateway

## After Deploy

1. Message your bot on Telegram/Discord
2. OpenClaw will ask you to approve the device (pairing)
3. Start talking — your agent is live

## Customizing

Edit your workspace files to customize your agent:

- `AGENTS.md` — Operating rules and behavior
- `SOUL.md` — Personality and communication style  
- `USER.md` — Context about you
- `skills/` — Add capabilities

See the [OpenClaw docs](https://docs.openclaw.ai) for more.

## Cost

- **Railway:** ~$5/month (Hobby plan)
- **Anthropic API:** Varies by usage (~$20-50/month typical)

## Support

- [OpenClaw Docs](https://docs.openclaw.ai)
- [Discord Community](https://discord.com/invite/clawd)
- [GitHub Issues](https://github.com/openclaw/openclaw/issues)
