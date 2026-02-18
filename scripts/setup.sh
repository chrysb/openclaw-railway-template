#!/bin/bash
# OpenClaw Railway setup — runs on every container start
set -e

if [ -z "$OPENCLAW_HOME" ]; then
  echo "❌ OPENCLAW_HOME not set — add it to your Railway variables"
  exit 1
fi

OPENCLAW_DIR="$OPENCLAW_HOME"
WORKSPACE_DIR="$OPENCLAW_DIR/workspace"

# ============================================================
# 1. Workspace initialization
# ============================================================

if [ ! -d "$WORKSPACE_DIR" ] && [ -n "$GITHUB_TOKEN" ] && [ -n "$WORKSPACE_REPO" ]; then
  echo "First boot: cloning workspace..."
  git clone "https://${GITHUB_TOKEN}@github.com/${WORKSPACE_REPO}.git" "$WORKSPACE_DIR"
  cd "$WORKSPACE_DIR"
  git config user.email "${GIT_EMAIL:-agent@openclaw.ai}"
  git config user.name "${GIT_NAME:-OpenClaw Agent}"
  echo "✓ Workspace cloned from $WORKSPACE_REPO"

elif [ -d "$WORKSPACE_DIR/.git" ] && [ -n "$GITHUB_TOKEN" ]; then
  cd "$WORKSPACE_DIR"
  git remote set-url origin "https://${GITHUB_TOKEN}@github.com/${WORKSPACE_REPO}.git" 2>/dev/null || true
  git pull origin main 2>/dev/null || echo "⚠ Could not pull workspace updates"
  echo "✓ Workspace updated"

else
  mkdir -p "$WORKSPACE_DIR"
  echo "✓ Workspace ready (no git repo configured)"
fi

# ============================================================
# 2. Google Workspace (gog CLI)
# ============================================================

if [ -n "$GOG_CLIENT_CREDENTIALS_JSON" ] && [ -n "$GOG_REFRESH_TOKEN" ]; then
  mkdir -p /root/.config/gogcli

  TEMP_CREDS=$(mktemp)
  printf '%s' "$GOG_CLIENT_CREDENTIALS_JSON" > "$TEMP_CREDS"
  /usr/local/bin/gog auth credentials set "$TEMP_CREDS" 2>/dev/null
  rm -f "$TEMP_CREDS"

  TEMP_TOKEN=$(mktemp)
  echo "{\"email\": \"${GOG_ACCOUNT}\", \"refresh_token\": \"$GOG_REFRESH_TOKEN\"}" > "$TEMP_TOKEN"
  /usr/local/bin/gog auth tokens import "$TEMP_TOKEN" 2>/dev/null
  rm -f "$TEMP_TOKEN"
  echo "✓ gog CLI configured for ${GOG_ACCOUNT}"

  if [ -n "$GOG_REFRESH_TOKEN_AGENT" ] && [ -n "$GOG_ACCOUNT_AGENT" ]; then
    TEMP_TOKEN=$(mktemp)
    echo "{\"email\": \"${GOG_ACCOUNT_AGENT}\", \"refresh_token\": \"$GOG_REFRESH_TOKEN_AGENT\"}" > "$TEMP_TOKEN"
    /usr/local/bin/gog auth tokens import "$TEMP_TOKEN" 2>/dev/null
    rm -f "$TEMP_TOKEN"
    echo "✓ gog CLI configured for ${GOG_ACCOUNT_AGENT}"
  fi
else
  echo "⚠ Google credentials not set — skipping gog setup"
fi

# ============================================================
# 3. OpenClaw onboard + config
# ============================================================

CONFIG_FILE="$OPENCLAW_DIR/openclaw.json"

if [ ! -f "$CONFIG_FILE" ]; then
  echo "First boot: running openclaw onboard..."
  npx openclaw onboard --non-interactive \
    --flow quickstart \
    --gateway-bind lan \
    --gateway-port 18789 \
    --gateway-token "${GATEWAY_AUTH_TOKEN}" \
    --auth-choice anthropic
  echo "✓ Onboard complete"
fi

# Post-onboard config patches (idempotent, run every boot)
echo "Applying config..."

npx openclaw config set gateway.mode local
npx openclaw config set gateway.bind lan
npx openclaw config set gateway.port 18789

if [ -n "$GATEWAY_AUTH_TOKEN" ]; then
  npx openclaw config set gateway.auth.mode token
  npx openclaw config set gateway.auth.token "$GATEWAY_AUTH_TOKEN"
fi

# Channels
if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
  npx openclaw config set --json channels.telegram "{\"enabled\":true,\"botToken\":\"$TELEGRAM_BOT_TOKEN\",\"dmPolicy\":\"pairing\"}"
  echo "✓ Telegram configured"
fi

if [ -n "$DISCORD_BOT_TOKEN" ]; then
  npx openclaw config set --json channels.discord "{\"enabled\":true,\"botToken\":\"$DISCORD_BOT_TOKEN\"}"
  echo "✓ Discord configured"
fi

echo "✓ Setup complete — starting gateway"
