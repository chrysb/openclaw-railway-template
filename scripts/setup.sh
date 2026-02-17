#!/bin/bash
# OpenClaw Railway setup — runs on every container start
set -e

OPENCLAW_DIR="/root/.openclaw"
WORKSPACE_DIR="$OPENCLAW_DIR/workspace"

# ============================================================
# 1. Workspace initialization
# ============================================================

# Clone workspace repo on first boot (if GITHUB_TOKEN + WORKSPACE_REPO set)
if [ ! -d "$WORKSPACE_DIR" ] && [ -n "$GITHUB_TOKEN" ] && [ -n "$WORKSPACE_REPO" ]; then
  echo "First boot: cloning workspace..."
  git clone "https://${GITHUB_TOKEN}@github.com/${WORKSPACE_REPO}.git" "$WORKSPACE_DIR"
  cd "$WORKSPACE_DIR"
  git config user.email "${GIT_EMAIL:-agent@openclaw.ai}"
  git config user.name "${GIT_NAME:-OpenClaw Agent}"
  echo "✓ Workspace cloned from $WORKSPACE_REPO"

elif [ -d "$WORKSPACE_DIR/.git" ] && [ -n "$GITHUB_TOKEN" ]; then
  # Pull latest on restart
  cd "$WORKSPACE_DIR"
  git remote set-url origin "https://${GITHUB_TOKEN}@github.com/${WORKSPACE_REPO}.git" 2>/dev/null || true
  git pull origin main 2>/dev/null || echo "⚠ Could not pull workspace updates"
  echo "✓ Workspace updated"

else
  # No repo configured — ensure directory exists
  mkdir -p "$WORKSPACE_DIR"
  echo "✓ Workspace ready (no git repo configured)"
fi

# ============================================================
# 2. Anthropic API key
# ============================================================

if [ -n "$ANTHROPIC_API_KEY" ]; then
  AUTH_DIR="$OPENCLAW_DIR/agents/main/agent"
  mkdir -p "$AUTH_DIR"
  cat > "$AUTH_DIR/auth-profiles.json" << EOF
{
  "version": 1,
  "profiles": {
    "anthropic:default": {
      "type": "token",
      "provider": "anthropic",
      "token": "$ANTHROPIC_API_KEY"
    }
  },
  "lastGood": { "anthropic": "anthropic:default" },
  "usageStats": {
    "anthropic:default": {
      "lastUsed": $(date +%s)000,
      "errorCount": 0
    }
  }
}
EOF
  echo "✓ Anthropic auth configured"
fi

# ============================================================
# 3. Google Workspace (gog CLI)
# ============================================================

if [ -n "$GOG_CLIENT_CREDENTIALS_JSON" ] && [ -n "$GOG_REFRESH_TOKEN" ]; then
  mkdir -p /root/.config/gogcli

  TEMP_CREDS=$(mktemp)
  printf '%s' "$GOG_CLIENT_CREDENTIALS_JSON" > "$TEMP_CREDS"
  /usr/local/bin/gog auth credentials set "$TEMP_CREDS" 2>/dev/null
  rm -f "$TEMP_CREDS"

  # Import primary account
  TEMP_TOKEN=$(mktemp)
  echo "{\"email\": \"${GOG_ACCOUNT}\", \"refresh_token\": \"$GOG_REFRESH_TOKEN\"}" > "$TEMP_TOKEN"
  /usr/local/bin/gog auth tokens import "$TEMP_TOKEN" 2>/dev/null
  rm -f "$TEMP_TOKEN"
  echo "✓ gog CLI configured for ${GOG_ACCOUNT}"

  # Optional: second account (e.g. agent email)
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
# 4. Default config (first boot only)
# ============================================================

CONFIG_FILE="$OPENCLAW_DIR/openclaw.json"
if [ ! -f "$CONFIG_FILE" ]; then
  echo "Creating default openclaw.json..."
  mkdir -p "$OPENCLAW_DIR"
  cat > "$CONFIG_FILE" << 'CONFIGEOF'
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic/claude-sonnet-4-5"
      },
      "workspace": "/root/.openclaw/workspace"
    }
  },
  "channels": {},
  "gateway": {
    "port": 18789,
    "mode": "local",
    "bind": "lan"
  },
  "commands": {
    "native": "auto",
    "restart": true
  }
}
CONFIGEOF

  # Inject channel config from env vars
  if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
    # Use node to patch the JSON (jq not available)
    node -e "
      const fs = require('fs');
      const cfg = JSON.parse(fs.readFileSync('$CONFIG_FILE', 'utf8'));
      cfg.channels = cfg.channels || {};
      cfg.channels.telegram = {
        enabled: true,
        botToken: '$TELEGRAM_BOT_TOKEN',
        dmPolicy: 'pairing'
      };
      fs.writeFileSync('$CONFIG_FILE', JSON.stringify(cfg, null, 2));
    "
    echo "✓ Telegram channel configured"
  fi

  if [ -n "$DISCORD_BOT_TOKEN" ]; then
    node -e "
      const fs = require('fs');
      const cfg = JSON.parse(fs.readFileSync('$CONFIG_FILE', 'utf8'));
      cfg.channels = cfg.channels || {};
      cfg.channels.discord = {
        enabled: true,
        botToken: '$DISCORD_BOT_TOKEN'
      };
      fs.writeFileSync('$CONFIG_FILE', JSON.stringify(cfg, null, 2));
    "
    echo "✓ Discord channel configured"
  fi

  echo "✓ Default config created"
fi

echo "✓ Setup complete — starting gateway"
