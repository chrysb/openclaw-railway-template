#!/bin/bash
# OpenClaw Railway setup — runs on every container start
set -e

export OPENCLAW_HOME="/data"
OPENCLAW_DIR="/data/.openclaw"
WORKSPACE_DIR="$OPENCLAW_DIR/workspace"
export OPENCLAW_GATEWAY_TOKEN="${GATEWAY_AUTH_TOKEN}"

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
  # Determine auth method: token takes priority over API key
  AUTH_ARGS=""
  if [ -n "$ANTHROPIC_TOKEN" ]; then
    AUTH_ARGS="--auth-choice token --token-provider anthropic --token $ANTHROPIC_TOKEN"
    echo "Using Anthropic setup token"
  elif [ -n "$ANTHROPIC_API_KEY" ]; then
    AUTH_ARGS="--auth-choice apiKey --anthropic-api-key $ANTHROPIC_API_KEY"
    echo "Using Anthropic API key"
  else
    echo "❌ Set ANTHROPIC_TOKEN or ANTHROPIC_API_KEY"
    exit 1
  fi

  npx openclaw onboard --non-interactive --accept-risk \
    --flow quickstart \
    --gateway-bind lan \
    --gateway-port 18789 \
    --gateway-token "${GATEWAY_AUTH_TOKEN}" \
    $AUTH_ARGS
  echo "✓ Onboard complete"

else
  echo "Config exists, skipping onboard"
fi

# Channel config (idempotent, runs every boot)
if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
  npx openclaw config set --json channels.telegram "{\"enabled\":true,\"botToken\":\"$TELEGRAM_BOT_TOKEN\",\"dmPolicy\":\"pairing\"}"
  echo "✓ Telegram configured"
fi

if [ -n "$DISCORD_BOT_TOKEN" ]; then
  npx openclaw config set --json channels.discord "{\"enabled\":true,\"botToken\":\"$DISCORD_BOT_TOKEN\"}"
  echo "✓ Discord configured"
fi

echo "✓ Setup complete — starting gateway"
