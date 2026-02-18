#!/bin/bash
# OpenClaw Railway setup — runs on every container start
set -e

export OPENCLAW_HOME="/data"
OPENCLAW_DIR="/data/.openclaw"
WORKSPACE_DIR="$OPENCLAW_DIR/workspace"
export OPENCLAW_CONFIG_PATH="$OPENCLAW_DIR/openclaw.json"

# ============================================================
# 1. Validate required env vars
# ============================================================

if [ -z "$GITHUB_TOKEN" ] || [ -z "$GITHUB_WORKSPACE_REPO" ]; then
  echo "❌ GITHUB_TOKEN and GITHUB_WORKSPACE_REPO are required"
  echo "   Create a private repo on GitHub and add a personal access token"
  exit 1
fi

# ============================================================
# 2. Git repo initialization (at .openclaw level)
# ============================================================

mkdir -p "$OPENCLAW_DIR"

# Symlink so ~/.openclaw resolves to /data/.openclaw (for SSH/CLI access)
if [ ! -L "/root/.openclaw" ] && [ ! -d "/root/.openclaw" ]; then
  ln -s "$OPENCLAW_DIR" /root/.openclaw
fi

# Normalize repo input: accept SSH URLs, HTTPS URLs, or owner/repo shorthand
REPO_URL="$GITHUB_WORKSPACE_REPO"
# git@github.com:owner/repo.git → owner/repo
REPO_URL=$(echo "$REPO_URL" | sed 's|^git@github.com:||; s|^https://github.com/||; s|\.git$||')
REMOTE_URL="https://${GITHUB_TOKEN}@github.com/${REPO_URL}.git"

if [ ! -d "$OPENCLAW_DIR/.git" ]; then
  cd "$OPENCLAW_DIR"
  git init -b main
  git remote add origin "$REMOTE_URL"
  git config user.email "${GIT_EMAIL:-agent@openclaw.ai}"
  git config user.name "${GIT_NAME:-OpenClaw Agent}"
  echo "✓ Git initialized"

else
  cd "$OPENCLAW_DIR"
  git remote set-url origin "$REMOTE_URL" 2>/dev/null || true
  echo "✓ Repo ready"
fi

# Remove legacy .git in workspace if it exists
if [ -d "$WORKSPACE_DIR/.git" ]; then
  rm -rf "$WORKSPACE_DIR/.git"
  echo "✓ Removed legacy .git from workspace"
fi

# Ensure .gitignore
if [ ! -f "$OPENCLAW_DIR/.gitignore" ]; then
  cp /app/setup/gitignore "$OPENCLAW_DIR/.gitignore"
  echo "✓ Created .gitignore"
fi

mkdir -p "$WORKSPACE_DIR"

# ============================================================
# 3. Google Workspace (gog CLI)
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
# 4. OpenClaw onboard + config
# ============================================================

if [ ! -f "$OPENCLAW_CONFIG_PATH" ]; then
  echo "First boot: running openclaw onboard..."
  ONBOARD_ARGS=(
    --non-interactive --accept-risk
    --flow quickstart
    --gateway-bind lan
    --gateway-port 18789
    --gateway-auth token
    --gateway-token "${OPENCLAW_GATEWAY_TOKEN}"
    --no-install-daemon
    --skip-health
    --workspace "$WORKSPACE_DIR"
  )

  if [ -n "$ANTHROPIC_TOKEN" ]; then
    ONBOARD_ARGS+=(--auth-choice token --token-provider anthropic --token "$ANTHROPIC_TOKEN")
    echo "Using Anthropic setup token"
  elif [ -n "$ANTHROPIC_API_KEY" ]; then
    ONBOARD_ARGS+=(--auth-choice apiKey --anthropic-api-key "$ANTHROPIC_API_KEY")
    echo "Using Anthropic API key"
  else
    echo "❌ Set ANTHROPIC_TOKEN or ANTHROPIC_API_KEY"
    exit 1
  fi

  npx openclaw onboard "${ONBOARD_ARGS[@]}"
  echo "✓ Onboard complete"

  # Remove nested .git that onboard creates in workspace
  rm -rf "$WORKSPACE_DIR/.git" 2>/dev/null || true

  # Run doctor --fix (may modify config)
  npx openclaw doctor --fix --non-interactive 2>&1 || true

  # ============================================================
  # 5. Inject channel config + sanitize secrets
  # ============================================================
  echo "Configuring channels and sanitizing secrets..."
  node -e "
    const fs = require('fs');
    const configPath = process.env.OPENCLAW_CONFIG_PATH;
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    // Inject channels
    if (!cfg.channels) cfg.channels = {};

    if (process.env.TELEGRAM_BOT_TOKEN) {
      cfg.channels.telegram = {
        enabled: true,
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        dmPolicy: 'pairing',
        groupPolicy: 'allowlist',
      };
      if (!cfg.plugins) cfg.plugins = {};
      if (!cfg.plugins.entries) cfg.plugins.entries = {};
      cfg.plugins.entries.telegram = { enabled: true };
      console.log('✓ Telegram configured');
    }

    if (process.env.DISCORD_BOT_TOKEN) {
      cfg.channels.discord = {
        enabled: true,
        token: process.env.DISCORD_BOT_TOKEN,
        groupPolicy: 'allowlist',
        dm: { policy: 'pairing' },
      };
      if (!cfg.plugins) cfg.plugins = {};
      if (!cfg.plugins.entries) cfg.plugins.entries = {};
      cfg.plugins.entries.discord = { enabled: true };
      console.log('✓ Discord configured');
    }

    // Write config with channels
    let content = JSON.stringify(cfg, null, 2);

    // Sanitize secrets (replace raw values with env var references)
    const replacements = [
      [process.env.OPENCLAW_GATEWAY_TOKEN, '\${OPENCLAW_GATEWAY_TOKEN}'],
      [process.env.ANTHROPIC_API_KEY, '\${ANTHROPIC_API_KEY}'],
      [process.env.ANTHROPIC_TOKEN, '\${ANTHROPIC_TOKEN}'],
      [process.env.TELEGRAM_BOT_TOKEN, '\${TELEGRAM_BOT_TOKEN}'],
      [process.env.DISCORD_BOT_TOKEN, '\${DISCORD_BOT_TOKEN}'],
      [process.env.OPENAI_API_KEY, '\${OPENAI_API_KEY}'],
      [process.env.GEMINI_API_KEY, '\${GEMINI_API_KEY}'],
      [process.env.NOTION_API_KEY, '\${NOTION_API_KEY}'],
    ];

    for (const [secret, envRef] of replacements) {
      if (secret && secret.length > 8) {
        content = content.split(secret).join(envRef);
      }
    }

    fs.writeFileSync(configPath, content);
    console.log('✓ Config sanitized');
  "

  # ============================================================
  # 6. Append git discipline to workspace files
  # ============================================================
  if ! grep -q "Git Discipline" "$WORKSPACE_DIR/TOOLS.md" 2>/dev/null; then
    cat /app/setup/TOOLS.md.append >> "$WORKSPACE_DIR/TOOLS.md"
    echo "✓ Added git discipline to TOOLS.md"
  fi

  if ! grep -q "Git hygiene" "$WORKSPACE_DIR/HEARTBEAT.md" 2>/dev/null; then
    cat /app/setup/HEARTBEAT.md.append >> "$WORKSPACE_DIR/HEARTBEAT.md"
    echo "✓ Added git hygiene to HEARTBEAT.md"
  fi

  # Initial commit + push
  cd "$OPENCLAW_DIR"
  echo "Git status before commit:"
  git status --short
  git add -A || echo "⚠ git add failed"
  echo "Git status after add:"
  git status --short
  git commit -m "initial setup" || echo "⚠ git commit failed"
  git push -u origin main --force || echo "⚠ git push failed"
  echo "✓ Initial state committed and pushed"

else
  echo "Config exists, skipping onboard"
fi

echo "✓ Setup complete — starting gateway"
exec npx openclaw gateway run
