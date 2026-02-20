const express = require("express");
const http = require("http");
const httpProxy = require("http-proxy");
const crypto = require("crypto");
const { spawn, exec, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const net = require("net");

const PORT = parseInt(process.env.PORT || "3000", 10);
const GATEWAY_PORT = 18789;
const GATEWAY_HOST = "127.0.0.1";
const GATEWAY_URL = `http://${GATEWAY_HOST}:${GATEWAY_PORT}`;
const OPENCLAW_DIR = "/data/.openclaw";
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || "";
const ENV_FILE_PATH = "/data/.env";
const WORKSPACE_DIR = `${OPENCLAW_DIR}/workspace`;
const AUTH_PROFILES_PATH = `${OPENCLAW_DIR}/agents/main/agent/auth-profiles.json`;
const CODEX_PROFILE_ID = "openai-codex:codex-cli";
const CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_OAUTH_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const CODEX_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
const CODEX_OAUTH_REDIRECT_URI = "http://localhost:1455/auth/callback";
const CODEX_OAUTH_SCOPE = "openid profile email offline_access";
const CODEX_JWT_CLAIM_PATH = "https://api.openai.com/auth";
const kCodexOauthStateTtlMs = 10 * 60 * 1000;
const kCodexOauthStates = new Map();
const kOnboardingModelProviders = new Set([
  "anthropic",
  "openai",
  "openai-codex",
  "google",
]);
const kFallbackOnboardingModels = [
  {
    key: "anthropic/claude-opus-4-6",
    provider: "anthropic",
    label: "Claude Opus 4.6",
  },
  {
    key: "anthropic/claude-sonnet-4-6",
    provider: "anthropic",
    label: "Claude Sonnet 4.6",
  },
  {
    key: "anthropic/claude-haiku-4-6",
    provider: "anthropic",
    label: "Claude Haiku 4.6",
  },
  {
    key: "openai-codex/gpt-5.3-codex",
    provider: "openai-codex",
    label: "Codex GPT-5.3",
  },
  {
    key: "openai/gpt-5.1-codex",
    provider: "openai",
    label: "OpenAI GPT-5.1 Codex",
  },
  {
    key: "google/gemini-3-pro-preview",
    provider: "google",
    label: "Gemini 3 Pro Preview",
  },
  {
    key: "google/gemini-3-flash-preview",
    provider: "google",
    label: "Gemini 3 Flash Preview",
  },
];

// ============================================================
// Env var management
// ============================================================

const kSystemVars = new Set([
  "WEBHOOK_TOKEN",
  "OPENCLAW_GATEWAY_TOKEN",
  "SETUP_PASSWORD",
  "PORT",
]);

const kKnownVars = [
  {
    key: "ANTHROPIC_API_KEY",
    label: "Anthropic API Key",
    group: "models",
    hint: "From console.anthropic.com",
  },
  {
    key: "ANTHROPIC_TOKEN",
    label: "Anthropic Setup Token",
    group: "models",
    hint: "From claude setup-token",
  },
  {
    key: "OPENAI_API_KEY",
    label: "OpenAI API Key",
    group: "models",
    hint: "From platform.openai.com",
  },
  {
    key: "GEMINI_API_KEY",
    label: "Gemini API Key",
    group: "models",
    hint: "From aistudio.google.com",
  },
  {
    key: "GITHUB_TOKEN",
    label: "GitHub Access Token",
    group: "github",
    hint: "Create one with repo scope at github.com/settings/tokens",
  },
  {
    key: "GITHUB_WORKSPACE_REPO",
    label: "Workspace Repo",
    group: "github",
    hint: "username/repo or https://github.com/username/repo",
  },
  {
    key: "TELEGRAM_BOT_TOKEN",
    label: "Telegram Bot Token",
    group: "channels",
    hint: "From @BotFather",
  },
  {
    key: "DISCORD_BOT_TOKEN",
    label: "Discord Bot Token",
    group: "channels",
    hint: "From Discord Developer Portal",
  },
  {
    key: "BRAVE_API_KEY",
    label: "Brave Search API Key",
    group: "tools",
    hint: "From brave.com/search/api",
  },
];

const kKnownKeys = new Set(kKnownVars.map((v) => v.key));

const parseJsonFromNoisyOutput = (raw) => {
  const text = String(raw || "");
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }
  try {
    return JSON.parse(text.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
};

const parseJwtPayload = (token) => {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
};

const getCodexAccountId = (accessToken) => {
  const payload = parseJwtPayload(accessToken);
  const auth = payload?.[CODEX_JWT_CLAIM_PATH];
  const accountId = auth?.chatgpt_account_id;
  return typeof accountId === "string" && accountId ? accountId : null;
};

const ensureAuthProfilesStore = () => {
  let store = { version: 1, profiles: {} };
  try {
    if (fs.existsSync(AUTH_PROFILES_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(AUTH_PROFILES_PATH, "utf8"));
      if (
        parsed &&
        typeof parsed === "object" &&
        parsed.profiles &&
        typeof parsed.profiles === "object"
      ) {
        store = {
          version: Number(parsed.version || 1),
          profiles: parsed.profiles,
          order: parsed.order,
          lastGood: parsed.lastGood,
          usageStats: parsed.usageStats,
        };
      }
    }
  } catch {}
  return store;
};

const saveAuthProfilesStore = (store) => {
  fs.mkdirSync(path.dirname(AUTH_PROFILES_PATH), { recursive: true });
  fs.writeFileSync(
    AUTH_PROFILES_PATH,
    JSON.stringify(
      {
        version: Number(store.version || 1),
        profiles: store.profiles || {},
        order: store.order,
        lastGood: store.lastGood,
        usageStats: store.usageStats,
      },
      null,
      2,
    ),
  );
};

const listCodexProfiles = () => {
  const store = ensureAuthProfilesStore();
  return Object.entries(store.profiles || {})
    .filter(([, cred]) => cred?.provider === "openai-codex")
    .map(([id, cred]) => ({ id, cred }));
};

const getCodexProfile = () => {
  const profiles = listCodexProfiles();
  if (profiles.length === 0) return null;
  const preferred =
    profiles.find((p) => p.id === CODEX_PROFILE_ID) || profiles[0];
  return { profileId: preferred.id, ...preferred.cred };
};

const hasCodexOauthProfile = () => {
  const profile = getCodexProfile();
  return !!(profile?.access && profile?.refresh);
};

const upsertCodexProfile = ({ access, refresh, expires, accountId }) => {
  const store = ensureAuthProfilesStore();
  store.profiles[CODEX_PROFILE_ID] = {
    type: "oauth",
    provider: "openai-codex",
    access,
    refresh,
    expires,
    ...(accountId ? { accountId } : {}),
  };
  saveAuthProfilesStore(store);
};

const removeCodexProfiles = () => {
  const store = ensureAuthProfilesStore();
  let changed = false;
  for (const [id, cred] of Object.entries(store.profiles || {})) {
    if (cred?.provider === "openai-codex") {
      delete store.profiles[id];
      changed = true;
    }
  }
  if (changed) saveAuthProfilesStore(store);
  return changed;
};

const cleanupCodexOauthStates = () => {
  const now = Date.now();
  for (const [state, value] of kCodexOauthStates.entries()) {
    if (!value || now - value.createdAt > kCodexOauthStateTtlMs) {
      kCodexOauthStates.delete(state);
    }
  }
};

const resolveGithubRepoUrl = (repoInput) => {
  const cleaned = String(repoInput || "")
    .trim()
    .replace(/^git@github\.com:/, "")
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/\.git$/, "");
  if (!cleaned) return "";
  if (!cleaned.includes("/")) {
    throw new Error('GITHUB_WORKSPACE_REPO must be in "owner/repo" format.');
  }
  return cleaned;
};

const createPkcePair = () => {
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
};

const resolveModelProvider = (modelKey) =>
  String(modelKey || "").split("/")[0] || "";

const parseCodexAuthorizationInput = (input) => {
  const value = String(input || "").trim();
  if (!value) return {};
  try {
    const url = new URL(value);
    return {
      code: url.searchParams.get("code") || "",
      state: url.searchParams.get("state") || "",
    };
  } catch {}
  if (value.includes("#")) {
    const [code, state] = value.split("#", 2);
    return { code: code || "", state: state || "" };
  }
  if (value.includes("code=")) {
    const params = new URLSearchParams(value);
    return {
      code: params.get("code") || "",
      state: params.get("state") || "",
    };
  }
  return { code: value, state: "" };
};

const normalizeOnboardingModels = (models) => {
  const deduped = new Map();
  for (const model of models || []) {
    if (!model?.key || typeof model.key !== "string") continue;
    const provider = resolveModelProvider(model.key);
    if (!kOnboardingModelProviders.has(provider)) continue;
    if (!deduped.has(model.key)) {
      deduped.set(model.key, {
        key: model.key,
        provider,
        label: model.name || model.key,
      });
    }
  }
  return Array.from(deduped.values()).sort((a, b) =>
    a.key.localeCompare(b.key),
  );
};

const readEnvFile = () => {
  try {
    const content = fs.readFileSync(ENV_FILE_PATH, "utf8");
    const vars = [];
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      vars.push({
        key: trimmed.slice(0, eqIdx),
        value: trimmed.slice(eqIdx + 1),
      });
    }
    return vars;
  } catch {
    return [];
  }
};

const writeEnvFile = (vars) => {
  const groups = {
    models: [],
    github: [],
    channels: [],
    tools: [],
    custom: [],
  };
  for (const { key, value } of vars) {
    const known = kKnownVars.find((v) => v.key === key);
    const group = known ? known.group : "custom";
    groups[group].push({ key, value });
  }
  const lines = [
    "# OpenClaw Environment Variables",
    "# Edit via the Setup UI or directly in this file",
    "",
  ];
  const labels = {
    models: "AI Provider",
    github: "GitHub",
    channels: "Channels",
    tools: "Tools",
    custom: "Custom",
  };
  for (const [group, entries] of Object.entries(groups)) {
    if (entries.length === 0) continue;
    lines.push(`# --- ${labels[group]} ---`);
    for (const { key, value } of entries) lines.push(`${key}=${value}`);
    lines.push("");
  }
  fs.writeFileSync(ENV_FILE_PATH, lines.join("\n"));
};

const reloadEnv = () => {
  const vars = readEnvFile();
  const fileKeys = new Set(vars.map((v) => v.key));
  let changed = false;

  // Set/update/clear vars from file
  for (const { key, value } of vars) {
    if (value && value !== process.env[key]) {
      console.log(
        `[wrapper] Env updated: ${key}=${key.toLowerCase().includes("token") || key.toLowerCase().includes("key") || key.toLowerCase().includes("password") ? "***" : value}`,
      );
      process.env[key] = value;
      changed = true;
    } else if (!value && process.env[key]) {
      console.log(`[wrapper] Env cleared: ${key}`);
      delete process.env[key];
      changed = true;
    }
  }

  // Remove vars that were deleted from the file entirely
  const allKnownKeys = kKnownVars.map((v) => v.key);
  for (const key of allKnownKeys) {
    if (!fileKeys.has(key) && process.env[key]) {
      console.log(`[wrapper] Env removed: ${key}`);
      delete process.env[key];
      changed = true;
    }
  }

  return changed;
};

// Watch /data/.env for external changes (e.g. agent writing placeholders)
try {
  fs.watchFile(ENV_FILE_PATH, { interval: 2000 }, () => {
    console.log("[wrapper] /data/.env changed externally, reloading...");
    reloadEnv();
  });
} catch {}

// ============================================================
// 1. Start gateway as child process
// ============================================================

const gatewayEnv = () => ({
  ...process.env,
  OPENCLAW_HOME: "/data",
  OPENCLAW_CONFIG_PATH: `${OPENCLAW_DIR}/openclaw.json`,
  XDG_CONFIG_HOME: OPENCLAW_DIR,
});

const isOnboarded = () => fs.existsSync(`${OPENCLAW_DIR}/openclaw.json`);

const isGatewayRunning = () =>
  new Promise((resolve) => {
    const sock = net.createConnection(GATEWAY_PORT, GATEWAY_HOST);
    sock.setTimeout(1000);
    sock.on("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.on("error", () => resolve(false));
    sock.on("timeout", () => {
      sock.destroy();
      resolve(false);
    });
  });

const runGatewayCmd = (cmd) => {
  console.log(`[wrapper] Running: openclaw gateway ${cmd}`);
  try {
    const out = execSync(`openclaw gateway ${cmd}`, {
      env: gatewayEnv(),
      timeout: 15000,
      encoding: "utf8",
    });
    if (out.trim()) console.log(`[wrapper] ${out.trim()}`);
  } catch (e) {
    if (e.stdout?.trim())
      console.log(`[wrapper] gateway ${cmd} stdout: ${e.stdout.trim()}`);
    if (e.stderr?.trim())
      console.log(`[wrapper] gateway ${cmd} stderr: ${e.stderr.trim()}`);
    if (!e.stdout?.trim() && !e.stderr?.trim())
      console.log(`[wrapper] gateway ${cmd} error: ${e.message}`);
    console.log(`[wrapper] gateway ${cmd} exit code: ${e.status}`);
  }
};

async function startGateway() {
  if (!isOnboarded()) {
    console.log("[wrapper] Not onboarded yet — skipping gateway start");
    return;
  }
  if (await isGatewayRunning()) {
    console.log("[wrapper] Gateway already running — skipping start");
    return;
  }
  console.log("[wrapper] Starting openclaw gateway...");
  const child = spawn("openclaw", ["gateway", "run"], {
    env: gatewayEnv(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => process.stdout.write(`[gateway] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[gateway] ${d}`));
  child.on("exit", (code) => {
    console.log(`[wrapper] Gateway launcher exited with code ${code}`);
  });
}

function restartGateway() {
  reloadEnv();
  runGatewayCmd("install --force");
  runGatewayCmd("restart");
}

process.on("SIGTERM", () => {
  runGatewayCmd("stop");
  process.exit(0);
});
process.on("SIGINT", () => {
  runGatewayCmd("stop");
  process.exit(0);
});

// ============================================================
// 2. Reverse proxy to gateway
// ============================================================

const proxy = httpProxy.createProxyServer({
  target: GATEWAY_URL,
  ws: true,
  changeOrigin: true,
});

proxy.on("error", (err, req, res) => {
  if (res && res.writeHead) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Gateway unavailable" }));
  }
});

// ============================================================
// 3. Express app — setup UI + proxy
// ============================================================

const app = express();
app.use(express.json());

const SETUP_PASSWORD = process.env.SETUP_PASSWORD || "";
const kAuthTokens = new Set();
const cookieParser = (req) => {
  const cookies = {};
  (req.headers.cookie || "").split(";").forEach((c) => {
    const [k, ...v] = c.trim().split("=");
    if (k) cookies[k] = v.join("=");
  });
  return cookies;
};

// Health check (always public)
app.get("/health", async (req, res) => {
  const running = await isGatewayRunning();
  res.json({
    status: running ? "healthy" : "starting",
    gateway: running ? "running" : "starting",
  });
});

// Auth: login endpoint
app.post("/api/auth/login", (req, res) => {
  if (!SETUP_PASSWORD) return res.json({ ok: true });
  if (req.body.password !== SETUP_PASSWORD)
    return res.status(401).json({ ok: false, error: "Wrong password" });
  const token = crypto.randomBytes(32).toString("hex");
  kAuthTokens.add(token);
  res.cookie("setup_token", token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  res.json({ ok: true });
});

// Auth middleware: protect setup UI + API when SETUP_PASSWORD is set
const requireAuth = (req, res, next) => {
  if (!SETUP_PASSWORD) return next();
  if (req.path.startsWith("/auth/google/callback")) return next();
  if (req.path.startsWith("/auth/codex/callback")) return next();
  const cookies = cookieParser(req);
  const token = cookies.setup_token || req.query.token;
  if (token && kAuthTokens.has(token)) return next();
  // For page requests, serve login page; for API, return 401
  if (req.path.startsWith("/api/"))
    return res.status(401).json({ error: "Unauthorized" });
  return res.sendFile(path.join(__dirname, "public", "login.html"));
};

app.use("/setup", requireAuth);
app.use("/api", requireAuth);
app.use("/auth", requireAuth);
app.use(express.static(path.join(__dirname, "public")));

// Setup page
app.get("/", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "setup.html"));
});
app.get("/setup", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "setup.html"));
});

// API: onboard status
app.get("/api/onboard/status", (req, res) => {
  res.json({ onboarded: isOnboarded() });
});

app.get("/api/models", async (req, res) => {
  try {
    const output = await shellCmd("openclaw models list --all --json", {
      env: gatewayEnv(),
      timeout: 20000,
    });
    const parsed = parseJsonFromNoisyOutput(output);
    const models = normalizeOnboardingModels(parsed?.models || []);
    if (models.length > 0) {
      return res.json({ ok: true, source: "openclaw", models });
    }
    return res.json({
      ok: true,
      source: "fallback",
      models: kFallbackOnboardingModels,
    });
  } catch (err) {
    console.error("[models] Failed to load dynamic models:", err.message);
    return res.json({
      ok: true,
      source: "fallback",
      models: kFallbackOnboardingModels,
    });
  }
});

app.get("/api/codex/status", (req, res) => {
  const profile = getCodexProfile();
  if (!profile) {
    return res.json({ connected: false });
  }
  res.json({
    connected: true,
    profileId: profile.profileId,
    accountId: profile.accountId || null,
    expires: typeof profile.expires === "number" ? profile.expires : null,
  });
});

app.get("/api/models/status", async (req, res) => {
  try {
    const output = await shellCmd("openclaw models status --json", {
      env: gatewayEnv(),
      timeout: 20000,
    });
    const parsed = parseJsonFromNoisyOutput(output) || {};
    res.json({
      ok: true,
      modelKey: parsed.resolvedDefault || parsed.defaultModel || null,
      fallbacks: parsed.fallbacks || [],
      imageModel: parsed.imageModel || null,
    });
  } catch (err) {
    res.json({
      ok: false,
      error: err.message || "Failed to read model status",
    });
  }
});

app.post("/api/models/set", async (req, res) => {
  const { modelKey } = req.body || {};
  if (!modelKey || typeof modelKey !== "string" || !modelKey.includes("/")) {
    return res.status(400).json({ ok: false, error: "Missing modelKey" });
  }
  try {
    await shellCmd(`openclaw models set "${modelKey}"`, {
      env: gatewayEnv(),
      timeout: 30000,
    });
    res.json({ ok: true });
  } catch (err) {
    res
      .status(400)
      .json({ ok: false, error: err.message || "Failed to set model" });
  }
});

// API: run onboarding (ports setup.sh first-boot logic to Node)
app.post("/api/onboard", async (req, res) => {
  if (isOnboarded()) return res.json({ ok: false, error: "Already onboarded" });

  const { vars, modelKey } = req.body;
  if (!Array.isArray(vars))
    return res.status(400).json({ ok: false, error: "Missing vars array" });
  if (!modelKey || typeof modelKey !== "string" || !modelKey.includes("/")) {
    return res
      .status(400)
      .json({ ok: false, error: "A model selection is required" });
  }

  const varMap = Object.fromEntries(vars.map((v) => [v.key, v.value]));
  const githubToken = String(varMap.GITHUB_TOKEN || "");
  const githubRepoInput = String(varMap.GITHUB_WORKSPACE_REPO || "").trim();
  const selectedProvider = resolveModelProvider(modelKey);
  const hasCodexOauth = hasCodexOauthProfile();

  // Validate minimum requirements
  const hasAiByProvider = {
    anthropic: !!(varMap.ANTHROPIC_API_KEY || varMap.ANTHROPIC_TOKEN),
    openai: !!varMap.OPENAI_API_KEY,
    "openai-codex": !!(hasCodexOauth || varMap.OPENAI_API_KEY),
    google: !!varMap.GEMINI_API_KEY,
  };
  const hasAnyAi = !!(
    varMap.ANTHROPIC_API_KEY ||
    varMap.ANTHROPIC_TOKEN ||
    varMap.OPENAI_API_KEY ||
    varMap.GEMINI_API_KEY ||
    hasCodexOauth
  );
  const hasAi =
    selectedProvider in hasAiByProvider
      ? hasAiByProvider[selectedProvider]
      : hasAnyAi;
  const hasGithub = !!(githubToken && githubRepoInput);
  const hasChannel = !!(varMap.TELEGRAM_BOT_TOKEN || varMap.DISCORD_BOT_TOKEN);
  if (!hasAi) {
    if (selectedProvider === "openai-codex") {
      return res
        .status(400)
        .json({
          ok: false,
          error:
            "Connect OpenAI Codex OAuth or provide OPENAI_API_KEY before continuing",
        });
    }
    return res
      .status(400)
      .json({
        ok: false,
        error: `Missing credentials for selected provider "${selectedProvider}"`,
      });
  }
  if (!hasGithub)
    return res
      .status(400)
      .json({
        ok: false,
        error: "GitHub token and workspace repo are required",
      });
  if (!hasChannel)
    return res
      .status(400)
      .json({ ok: false, error: "At least one channel token is required" });

  try {
    // 1. Save vars to /data/.env and reload into process.env
    const repoUrl = resolveGithubRepoUrl(githubRepoInput);
    const varsToSave = [
      ...vars.filter((v) => v.value && v.key !== "GITHUB_WORKSPACE_REPO"),
    ];
    varsToSave.push({ key: "GITHUB_WORKSPACE_REPO", value: repoUrl });
    writeEnvFile(varsToSave);
    reloadEnv();

    // 2. Git init
    const remoteUrl = `https://${githubToken}@github.com/${repoUrl}.git`;

    // Create repo if it doesn't exist, or verify it's empty
    const [repoOwner, repoName] = repoUrl.split("/");
    const ghHeaders = {
      Authorization: `token ${githubToken}`,
      "User-Agent": "openclaw-railway",
      Accept: "application/vnd.github+json",
    };
    try {
      const checkRes = await fetch(`https://api.github.com/repos/${repoUrl}`, {
        headers: ghHeaders,
      });
      if (checkRes.status === 404) {
        // Repo doesn't exist — create it
        console.log(`[onboard] Creating repo ${repoUrl}...`);
        const createRes = await fetch("https://api.github.com/user/repos", {
          method: "POST",
          headers: { ...ghHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({
            name: repoName,
            private: true,
            auto_init: false,
          }),
        });
        if (!createRes.ok) {
          const err = await createRes.json().catch(() => ({}));
          return res
            .status(400)
            .json({
              ok: false,
              error: `Failed to create repo: ${err.message || createRes.statusText}`,
            });
        }
        console.log(`[onboard] Repo ${repoUrl} created`);
      } else if (checkRes.ok) {
        // Repo exists — verify it's empty
        const { stdout } = await new Promise((resolve, reject) => {
          exec(
            `git ls-remote "${remoteUrl}"`,
            { timeout: 15000 },
            (err, stdout) => {
              if (err) return reject(err);
              resolve({ stdout: stdout?.trim() || "" });
            },
          );
        });
        if (stdout.length > 0) {
          return res
            .status(400)
            .json({
              ok: false,
              error: `Repo "${repoUrl}" already has content. Please use an empty repo or a new name — we'll create it for you.`,
            });
        }
      } else {
        return res
          .status(400)
          .json({
            ok: false,
            error: `Cannot access repo "${repoUrl}" — check your token has the "repo" scope`,
          });
      }
    } catch (e) {
      return res
        .status(400)
        .json({ ok: false, error: `GitHub error: ${e.message}` });
    }

    fs.mkdirSync(OPENCLAW_DIR, { recursive: true });
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

    if (!fs.existsSync(`${OPENCLAW_DIR}/.git`)) {
      await shellCmd(
        `cd ${OPENCLAW_DIR} && git init -b main && git remote add origin "${remoteUrl}" && git config user.email "agent@openclaw.ai" && git config user.name "OpenClaw Agent"`,
      );
      console.log("[onboard] Git initialized");
    }

    // Ensure .gitignore
    if (!fs.existsSync(`${OPENCLAW_DIR}/.gitignore`)) {
      fs.copyFileSync("/app/setup/gitignore", `${OPENCLAW_DIR}/.gitignore`);
    }

    // 3. Run openclaw onboard
    const onboardArgs = [
      "--non-interactive",
      "--accept-risk",
      "--flow",
      "quickstart",
      "--gateway-bind",
      "loopback",
      "--gateway-port",
      "18789",
      "--gateway-auth",
      "token",
      "--gateway-token",
      varMap.OPENCLAW_GATEWAY_TOKEN || process.env.OPENCLAW_GATEWAY_TOKEN || "",
      "--no-install-daemon",
      "--skip-health",
      "--workspace",
      WORKSPACE_DIR,
    ];

    if (
      selectedProvider === "openai-codex" &&
      (varMap.OPENAI_API_KEY || process.env.OPENAI_API_KEY)
    ) {
      onboardArgs.push(
        "--auth-choice",
        "apiKey",
        "--openai-api-key",
        varMap.OPENAI_API_KEY || process.env.OPENAI_API_KEY,
      );
    } else if (selectedProvider === "openai-codex" && hasCodexOauth) {
      // OpenAI Codex OAuth is interactive-only in onboard; use skip in non-interactive mode.
      onboardArgs.push("--auth-choice", "skip");
    } else if (
      (selectedProvider === "anthropic" || !selectedProvider) &&
      (varMap.ANTHROPIC_TOKEN || process.env.ANTHROPIC_TOKEN)
    ) {
      onboardArgs.push(
        "--auth-choice",
        "token",
        "--token-provider",
        "anthropic",
        "--token",
        varMap.ANTHROPIC_TOKEN || process.env.ANTHROPIC_TOKEN,
      );
    } else if (
      (selectedProvider === "anthropic" || !selectedProvider) &&
      (varMap.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY)
    ) {
      onboardArgs.push(
        "--auth-choice",
        "apiKey",
        "--anthropic-api-key",
        varMap.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
      );
    } else if (
      (selectedProvider === "openai" || !selectedProvider) &&
      (varMap.OPENAI_API_KEY || process.env.OPENAI_API_KEY)
    ) {
      onboardArgs.push(
        "--auth-choice",
        "apiKey",
        "--openai-api-key",
        varMap.OPENAI_API_KEY || process.env.OPENAI_API_KEY,
      );
    } else if (
      (selectedProvider === "google" || !selectedProvider) &&
      (varMap.GEMINI_API_KEY || process.env.GEMINI_API_KEY)
    ) {
      onboardArgs.push(
        "--auth-choice",
        "apiKey",
        "--gemini-api-key",
        varMap.GEMINI_API_KEY || process.env.GEMINI_API_KEY,
      );
    } else if (varMap.ANTHROPIC_TOKEN || process.env.ANTHROPIC_TOKEN) {
      onboardArgs.push(
        "--auth-choice",
        "token",
        "--token-provider",
        "anthropic",
        "--token",
        varMap.ANTHROPIC_TOKEN || process.env.ANTHROPIC_TOKEN,
      );
    } else if (varMap.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY) {
      onboardArgs.push(
        "--auth-choice",
        "apiKey",
        "--anthropic-api-key",
        varMap.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
      );
    } else if (varMap.OPENAI_API_KEY || process.env.OPENAI_API_KEY) {
      onboardArgs.push(
        "--auth-choice",
        "apiKey",
        "--openai-api-key",
        varMap.OPENAI_API_KEY || process.env.OPENAI_API_KEY,
      );
    } else if (varMap.GEMINI_API_KEY || process.env.GEMINI_API_KEY) {
      onboardArgs.push(
        "--auth-choice",
        "apiKey",
        "--gemini-api-key",
        varMap.GEMINI_API_KEY || process.env.GEMINI_API_KEY,
      );
    } else if (hasCodexOauth) {
      onboardArgs.push("--auth-choice", "skip");
    }

    console.log(
      `[onboard] Running: openclaw onboard ${onboardArgs.join(" ").replace(/sk-[^\s]+/g, "***")}`,
    );
    await shellCmd(
      `openclaw onboard ${onboardArgs.map((a) => `"${a}"`).join(" ")}`,
      {
        env: {
          ...process.env,
          OPENCLAW_HOME: "/data",
          OPENCLAW_CONFIG_PATH: `${OPENCLAW_DIR}/openclaw.json`,
        },
        timeout: 120000,
      },
    );
    console.log("[onboard] Onboard complete");

    await shellCmd(`openclaw models set "${modelKey}"`, {
      env: gatewayEnv(),
      timeout: 30000,
    }).catch((e) => {
      console.error("[onboard] Failed to set model:", e.message);
      throw new Error(
        `Onboarding completed but failed to set model "${modelKey}"`,
      );
    });

    // Remove nested .git that onboard creates in workspace
    try {
      fs.rmSync(`${WORKSPACE_DIR}/.git`, { recursive: true, force: true });
    } catch {}

    // 4. Inject channel config, enable commands, sanitize secrets
    const cfg = JSON.parse(
      fs.readFileSync(`${OPENCLAW_DIR}/openclaw.json`, "utf8"),
    );
    if (!cfg.channels) cfg.channels = {};
    if (!cfg.plugins) cfg.plugins = {};
    if (!cfg.plugins.entries) cfg.plugins.entries = {};
    if (!cfg.commands) cfg.commands = {};
    cfg.commands.restart = true;

    if (varMap.TELEGRAM_BOT_TOKEN) {
      cfg.channels.telegram = {
        enabled: true,
        botToken: varMap.TELEGRAM_BOT_TOKEN,
        dmPolicy: "pairing",
        groupPolicy: "allowlist",
      };
      cfg.plugins.entries.telegram = { enabled: true };
      console.log("[onboard] Telegram configured");
    }
    if (varMap.DISCORD_BOT_TOKEN) {
      cfg.channels.discord = {
        enabled: true,
        token: varMap.DISCORD_BOT_TOKEN,
        dmPolicy: "pairing",
        groupPolicy: "allowlist",
      };
      cfg.plugins.entries.discord = { enabled: true };
      console.log("[onboard] Discord configured");
    }

    let content = JSON.stringify(cfg, null, 2);

    const replacements = [
      [process.env.OPENCLAW_GATEWAY_TOKEN, "${OPENCLAW_GATEWAY_TOKEN}"],
      [varMap.ANTHROPIC_API_KEY, "${ANTHROPIC_API_KEY}"],
      [varMap.ANTHROPIC_TOKEN, "${ANTHROPIC_TOKEN}"],
      [varMap.TELEGRAM_BOT_TOKEN, "${TELEGRAM_BOT_TOKEN}"],
      [varMap.DISCORD_BOT_TOKEN, "${DISCORD_BOT_TOKEN}"],
      [varMap.OPENAI_API_KEY, "${OPENAI_API_KEY}"],
      [varMap.GEMINI_API_KEY, "${GEMINI_API_KEY}"],
      [varMap.BRAVE_API_KEY, "${BRAVE_API_KEY}"],
    ];

    for (const [secret, envRef] of replacements) {
      if (secret && secret.length > 8) {
        content = content.split(secret).join(envRef);
      }
    }

    fs.writeFileSync(`${OPENCLAW_DIR}/openclaw.json`, content);
    console.log("[onboard] Config sanitized");

    // 5. Append to TOOLS.md and HEARTBEAT.md
    const toolsMd = `${WORKSPACE_DIR}/TOOLS.md`;
    const heartbeatMd = `${WORKSPACE_DIR}/HEARTBEAT.md`;

    try {
      const toolsContent = fs.existsSync(toolsMd)
        ? fs.readFileSync(toolsMd, "utf8")
        : "";
      if (!toolsContent.includes("Git Discipline")) {
        fs.appendFileSync(
          toolsMd,
          fs.readFileSync("/app/setup/TOOLS.md.append", "utf8"),
        );
      }
    } catch (e) {
      console.error("[onboard] TOOLS.md append error:", e.message);
    }

    try {
      const heartbeatContent = fs.existsSync(heartbeatMd)
        ? fs.readFileSync(heartbeatMd, "utf8")
        : "";
      if (!heartbeatContent.includes("Git hygiene")) {
        fs.appendFileSync(
          heartbeatMd,
          fs.readFileSync("/app/setup/HEARTBEAT.md.append", "utf8"),
        );
      }
    } catch (e) {
      console.error("[onboard] HEARTBEAT.md append error:", e.message);
    }

    // 6. Install control-ui skill with real server URL
    try {
      const baseUrl = getBaseUrl(req);
      const skillDir = `${OPENCLAW_DIR}/skills/control-ui`;
      fs.mkdirSync(skillDir, { recursive: true });
      const skillTemplate = fs.readFileSync(
        "/app/setup/skills/control-ui/SKILL.md",
        "utf8",
      );
      const skillContent = skillTemplate.replace(/\{\{BASE_URL\}\}/g, baseUrl);
      fs.writeFileSync(`${skillDir}/SKILL.md`, skillContent);
      console.log(`[onboard] Control UI skill installed (${baseUrl})`);
    } catch (e) {
      console.error("[onboard] Skill install error:", e.message);
    }

    // 7. Git commit + push
    await shellCmd(
      `cd ${OPENCLAW_DIR} && git add -A && git commit -m "initial setup" && git push -u origin main`,
      { timeout: 30000 },
    ).catch((e) => console.error("[onboard] Git push error:", e.message));
    console.log("[onboard] Initial state committed and pushed");

    // 7. Start the gateway
    startGateway();

    res.json({ ok: true });
  } catch (err) {
    console.error("[onboard] Error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Shell command helper for onboarding
const shellCmd = (cmd, opts = {}) =>
  new Promise((resolve, reject) => {
    console.log(
      `[onboard] Running: ${cmd
        .replace(/ghp_[^\s"]+/g, "***")
        .replace(/sk-[^\s"]+/g, "***")
        .slice(0, 200)}`,
    );
    exec(cmd, { timeout: 60000, ...opts }, (err, stdout, stderr) => {
      if (err) {
        console.error(
          `[onboard] Error: ${(stderr || err.message).slice(0, 300)}`,
        );
        return reject(err);
      }
      if (stdout.trim())
        console.log(`[onboard] ${stdout.trim().slice(0, 300)}`);
      resolve(stdout.trim());
    });
  });

// API: env vars
app.get("/api/env", (req, res) => {
  const fileVars = readEnvFile();
  const merged = [];

  // Add known vars (in defined order)
  for (const def of kKnownVars) {
    const fileEntry = fileVars.find((v) => v.key === def.key);
    const value = fileEntry?.value || "";
    merged.push({
      key: def.key,
      value,
      label: def.label,
      group: def.group,
      hint: def.hint,
      source: fileEntry?.value ? "env_file" : "unset",
      editable: true,
    });
  }

  // Add custom vars from file that aren't known or system
  for (const v of fileVars) {
    if (kKnownKeys.has(v.key) || kSystemVars.has(v.key)) continue;
    merged.push({
      key: v.key,
      value: v.value,
      label: v.key,
      group: "custom",
      hint: "",
      source: "env_file",
      editable: true,
    });
  }

  res.json({ vars: merged });
});

app.put("/api/env", (req, res) => {
  const { vars } = req.body;
  if (!Array.isArray(vars))
    return res.status(400).json({ ok: false, error: "Missing vars array" });

  // Filter out system vars
  const filtered = vars.filter((v) => !kSystemVars.has(v.key));

  // 1. Remove channels while old tokens are still in env
  syncChannelConfig(filtered, "remove");

  // 2. Write .env and reload into process.env
  writeEnvFile(filtered);
  const changed = reloadEnv();
  console.log(
    `[wrapper] Env vars saved (${filtered.length} vars, changed=${changed})`,
  );

  // 3. Add channels now that new tokens are in env
  syncChannelConfig(filtered, "add");

  res.json({ ok: true, changed });
});

// API: gateway status
app.get("/api/status", async (req, res) => {
  const configExists = fs.existsSync(`${OPENCLAW_DIR}/openclaw.json`);
  const running = await isGatewayRunning();
  const repo = process.env.GITHUB_WORKSPACE_REPO || "";
  res.json({
    gateway: running ? "running" : configExists ? "starting" : "not_onboarded",
    configExists,
    channels: getChannelStatus(),
    repo,
  });
});

// Helper: run openclaw CLI command
function clawCmd(cmd, { quiet = false } = {}) {
  return new Promise((resolve) => {
    if (!quiet) console.log(`[wrapper] Running: openclaw ${cmd}`);
    exec(
      `openclaw ${cmd}`,
      {
        env: gatewayEnv(),
        timeout: 15000,
      },
      (err, stdout, stderr) => {
        const result = {
          ok: !err,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          code: err?.code,
        };
        if (!quiet && !result.ok)
          console.log(`[wrapper] Error: ${result.stderr.slice(0, 200)}`);
        resolve(result);
      },
    );
  });
}

// API: gateway status via CLI
app.get("/api/gateway-status", async (req, res) => {
  const result = await clawCmd("status");
  res.json(result);
});

// API: restart gateway
app.post("/api/gateway/restart", (req, res) => {
  if (!isOnboarded())
    return res.status(400).json({ ok: false, error: "Not onboarded" });
  restartGateway();
  res.json({ ok: true });
});

// Cache for pairing results (avoid spawning CLI every poll)
let pairingCache = { pending: [], ts: 0 };
const PAIRING_CACHE_TTL = 10000; // 10s

// API: list pending pairings via CLI
app.get("/api/pairings", async (req, res) => {
  if (Date.now() - pairingCache.ts < PAIRING_CACHE_TTL) {
    return res.json({ pending: pairingCache.pending });
  }

  const pending = [];
  const channels = ["telegram", "discord"];

  for (const ch of channels) {
    // Check if channel is configured
    try {
      const config = JSON.parse(
        fs.readFileSync(`${OPENCLAW_DIR}/openclaw.json`, "utf8"),
      );
      if (!config.channels?.[ch]?.enabled) continue;
    } catch {
      continue;
    }

    const result = await clawCmd(`pairing list ${ch}`, { quiet: true });
    if (result.ok && result.stdout) {
      const lines = result.stdout.split("\n").filter((l) => l.trim());
      for (const line of lines) {
        const codeMatch = line.match(/([A-Z0-9]{8})/);
        if (codeMatch) {
          pending.push({
            id: codeMatch[1],
            code: codeMatch[1],
            channel: ch,
          });
        }
      }
    }
  }

  pairingCache = { pending, ts: Date.now() };
  res.json({ pending });
});

// API: approve pairing
app.post("/api/pairings/:id/approve", async (req, res) => {
  const channel = req.body.channel || "telegram";
  const result = await clawCmd(`pairing approve ${channel} ${req.params.id}`);
  res.json(result);
});

// API: reject pairing
app.post("/api/pairings/:id/reject", async (req, res) => {
  const channel = req.body.channel || "telegram";
  const result = await clawCmd(`pairing reject ${channel} ${req.params.id}`);
  res.json(result);
});

// ============================================================
// OpenAI Codex OAuth flow
// ============================================================

app.get("/auth/codex/start", (req, res) => {
  try {
    cleanupCodexOauthStates();
    const redirectUri = CODEX_OAUTH_REDIRECT_URI;
    const { verifier, challenge } = createPkcePair();
    const state = crypto.randomBytes(16).toString("hex");
    kCodexOauthStates.set(state, {
      verifier,
      redirectUri,
      createdAt: Date.now(),
    });

    const authUrl = new URL(CODEX_OAUTH_AUTHORIZE_URL);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", CODEX_OAUTH_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", CODEX_OAUTH_SCOPE);
    authUrl.searchParams.set("code_challenge", challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("id_token_add_organizations", "true");
    authUrl.searchParams.set("codex_cli_simplified_flow", "true");
    // Keep this aligned with OpenClaw's own Codex OAuth flow.
    authUrl.searchParams.set("originator", "pi");
    res.redirect(authUrl.toString());
  } catch (err) {
    console.error("[codex] Failed to start OAuth flow:", err);
    res.redirect(
      "/setup?codex=error&message=" + encodeURIComponent(err.message),
    );
  }
});

app.get("/auth/codex/callback", async (req, res) => {
  const { code, error, state } = req.query;
  if (error) {
    return res.send(`<!DOCTYPE html><html><body><script>
      window.opener?.postMessage({ codex: 'error', message: '${String(error).replace(/'/g, "\\'")}' }, '*');
      window.close();
    </script><p>Codex auth failed. You can close this window.</p></body></html>`);
  }
  if (!code || !state) {
    return res.send(`<!DOCTYPE html><html><body><script>
      window.opener?.postMessage({ codex: 'error', message: 'Missing OAuth state/code' }, '*');
      window.close();
    </script><p>Missing OAuth state/code. You can close this window.</p></body></html>`);
  }

  cleanupCodexOauthStates();
  const oauthState = kCodexOauthStates.get(String(state));
  kCodexOauthStates.delete(String(state));
  if (!oauthState) {
    return res.send(`<!DOCTYPE html><html><body><script>
      window.opener?.postMessage({ codex: 'error', message: 'State mismatch or expired login attempt' }, '*');
      window.close();
    </script><p>State mismatch. You can close this window.</p></body></html>`);
  }

  try {
    const tokenRes = await fetch(CODEX_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: CODEX_OAUTH_CLIENT_ID,
        code: String(code),
        code_verifier: oauthState.verifier,
        redirect_uri: oauthState.redirectUri,
      }),
    });
    const json = await tokenRes.json().catch(() => ({}));
    if (
      !tokenRes.ok ||
      !json.access_token ||
      !json.refresh_token ||
      typeof json.expires_in !== "number"
    ) {
      throw new Error(`Token exchange failed (${tokenRes.status})`);
    }

    const access = String(json.access_token);
    const refresh = String(json.refresh_token);
    const expires = Date.now() + Number(json.expires_in) * 1000;
    const accountId = getCodexAccountId(access);

    upsertCodexProfile({ access, refresh, expires, accountId });

    return res.send(`<!DOCTYPE html><html><body><script>
      window.opener?.postMessage({ codex: 'success' }, '*');
      window.close();
    </script><p>Codex connected. You can close this window.</p></body></html>`);
  } catch (err) {
    console.error("[codex] OAuth callback error:", err);
    return res.send(`<!DOCTYPE html><html><body><script>
      window.opener?.postMessage({ codex: 'error', message: '${String(err.message || "OAuth error").replace(/'/g, "\\'")}' }, '*');
      window.close();
    </script><p>Error: ${String(err.message || "OAuth error")}. You can close this window.</p></body></html>`);
  }
});

app.post("/api/codex/exchange", async (req, res) => {
  try {
    cleanupCodexOauthStates();
    const { input } = req.body || {};
    const parsed = parseCodexAuthorizationInput(input);
    const code = String(parsed.code || "");
    const state = String(parsed.state || "");
    if (!code || !state) {
      return res
        .status(400)
        .json({
          ok: false,
          error:
            "Missing code/state. Paste the full redirect URL from your browser address bar.",
        });
    }
    const oauthState = kCodexOauthStates.get(state);
    if (!oauthState) {
      return res
        .status(400)
        .json({
          ok: false,
          error: "OAuth state expired or invalid. Start Codex OAuth again.",
        });
    }
    kCodexOauthStates.delete(state);
    const tokenRes = await fetch(CODEX_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: CODEX_OAUTH_CLIENT_ID,
        code,
        code_verifier: oauthState.verifier,
        redirect_uri: oauthState.redirectUri,
      }),
    });
    const json = await tokenRes.json().catch(() => ({}));
    if (
      !tokenRes.ok ||
      !json.access_token ||
      !json.refresh_token ||
      typeof json.expires_in !== "number"
    ) {
      return res
        .status(400)
        .json({
          ok: false,
          error: `Token exchange failed (${tokenRes.status})`,
        });
    }
    const access = String(json.access_token);
    const refresh = String(json.refresh_token);
    const expires = Date.now() + Number(json.expires_in) * 1000;
    const accountId = getCodexAccountId(access);
    upsertCodexProfile({ access, refresh, expires, accountId });
    return res.json({ ok: true });
  } catch (err) {
    console.error("[codex] Manual exchange error:", err);
    return res
      .status(500)
      .json({ ok: false, error: err.message || "Codex OAuth exchange failed" });
  }
});

app.post("/api/codex/disconnect", (req, res) => {
  const changed = removeCodexProfiles();
  res.json({ ok: true, changed });
});

// ============================================================
// Google OAuth flow
// ============================================================

const SCOPE_MAP = {
  "gmail:read": "https://www.googleapis.com/auth/gmail.readonly",
  "gmail:write": "https://www.googleapis.com/auth/gmail.modify",
  "calendar:read": "https://www.googleapis.com/auth/calendar.readonly",
  "calendar:write": "https://www.googleapis.com/auth/calendar",
  "tasks:read": "https://www.googleapis.com/auth/tasks.readonly",
  "tasks:write": "https://www.googleapis.com/auth/tasks",
  "docs:read": "https://www.googleapis.com/auth/documents.readonly",
  "docs:write": "https://www.googleapis.com/auth/documents",
  "meet:read": "https://www.googleapis.com/auth/meetings.space.readonly",
  "meet:write": "https://www.googleapis.com/auth/meetings.space.created",
  "drive:read": "https://www.googleapis.com/auth/drive.readonly",
  "drive:write": "https://www.googleapis.com/auth/drive",
  "contacts:read": "https://www.googleapis.com/auth/contacts.readonly",
  "contacts:write": "https://www.googleapis.com/auth/contacts",
  "sheets:read": "https://www.googleapis.com/auth/spreadsheets.readonly",
  "sheets:write": "https://www.googleapis.com/auth/spreadsheets",
};
const REVERSE_SCOPE_MAP = Object.fromEntries(
  Object.entries(SCOPE_MAP).map(([k, v]) => [v, k]),
);
const BASE_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
];

// gog uses XDG_CONFIG_HOME/gogcli/ — we point XDG_CONFIG_HOME to OPENCLAW_DIR
// so gog config lives at /data/.openclaw/gogcli/ (persistent + gitignored)
const GOG_CONFIG_DIR = `${OPENCLAW_DIR}/gogcli`;
const GOG_CREDENTIALS_PATH = `${GOG_CONFIG_DIR}/credentials.json`;
const GOG_STATE_PATH = `${GOG_CONFIG_DIR}/state.json`;

const GOG_KEYRING_PASSWORD =
  process.env.GOG_KEYRING_PASSWORD || "openclaw-railway";

// Helper: run gog CLI command (config stored on persistent volume)
function gogCmd(cmd, { quiet = false } = {}) {
  return new Promise((resolve) => {
    if (!quiet) console.log(`[wrapper] Running: gog ${cmd}`);
    exec(
      `gog ${cmd}`,
      {
        timeout: 15000,
        env: {
          ...process.env,
          XDG_CONFIG_HOME: OPENCLAW_DIR,
          GOG_KEYRING_PASSWORD,
        },
      },
      (err, stdout, stderr) => {
        const result = {
          ok: !err,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        };
        if (!quiet && !result.ok)
          console.log(`[wrapper] gog error: ${result.stderr.slice(0, 200)}`);
        resolve(result);
      },
    );
  });
}

// Read Google OAuth credentials from credentials.json (handles all formats)
function readGoogleCredentials() {
  try {
    const c = JSON.parse(fs.readFileSync(GOG_CREDENTIALS_PATH, "utf8"));
    return {
      clientId:
        c.web?.client_id || c.installed?.client_id || c.client_id || null,
      clientSecret:
        c.web?.client_secret ||
        c.installed?.client_secret ||
        c.client_secret ||
        null,
    };
  } catch {
    return { clientId: null, clientSecret: null };
  }
}

// API: Google auth status
app.get("/api/google/status", async (req, res) => {
  if (!(await isGatewayRunning())) {
    return res.json({
      hasCredentials: false,
      authenticated: false,
      email: "",
      services: "",
    });
  }
  const hasCredentials = fs.existsSync(GOG_CREDENTIALS_PATH);
  let authenticated = false;
  let email = "";

  if (hasCredentials) {
    const result = await gogCmd("auth list --plain", { quiet: true });
    if (result.ok && result.stdout && !result.stdout.includes("no accounts")) {
      authenticated = true;
      email = result.stdout.split("\n")[0]?.split("\t")[0] || "";
    }

    // Also read saved email from state
    if (!email) {
      try {
        const state = JSON.parse(fs.readFileSync(GOG_STATE_PATH, "utf8"));
        email = state.email || "";
      } catch {}
    }
  }

  let services = "";
  let activeScopes = [];
  let apiStatus = {};
  try {
    const stateData = JSON.parse(fs.readFileSync(GOG_STATE_PATH, "utf8"));
    activeScopes = stateData.services || [];
    services = activeScopes
      .map((s) => s.split(":")[0])
      .filter((v, i, a) => a.indexOf(v) === i)
      .join(", ");
  } catch {}

  const status = {
    hasCredentials,
    authenticated,
    email,
    services,
    activeScopes,
  };
  console.log(`[wrapper] Google status: ${JSON.stringify(status)}`);
  res.json(status);
});

// API: Save Google OAuth credentials
app.post("/api/google/credentials", async (req, res) => {
  const { clientId, clientSecret, email } = req.body;
  if (!clientId || !clientSecret || !email) {
    return res.json({ ok: false, error: "Missing fields" });
  }

  try {
    // Write credentials.json in Google's format
    fs.mkdirSync(GOG_CONFIG_DIR, { recursive: true });

    const credentials = {
      web: {
        client_id: clientId,
        client_secret: clientSecret,
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://oauth2.googleapis.com/token",
        redirect_uris: [`${getBaseUrl(req)}/auth/google/callback`],
      },
    };

    fs.writeFileSync(
      GOG_CREDENTIALS_PATH,
      JSON.stringify(credentials, null, 2),
    );

    // Store credentials via gog CLI (gog may rewrite the file to its own flat format — that's fine,
    // readGoogleCredentials() handles both formats for our OAuth flow)
    const result = await gogCmd(`auth credentials set ${GOG_CREDENTIALS_PATH}`);
    console.log(`[wrapper] gog credentials set: ${JSON.stringify(result)}`);

    // Save UI state (email, selected services — credentials stay in credentials.json)
    const services = req.body.services || [
      "gmail:read",
      "gmail:write",
      "calendar:read",
      "calendar:write",
      "drive:read",
      "sheets:read",
      "docs:read",
    ];
    fs.writeFileSync(GOG_STATE_PATH, JSON.stringify({ email, services }));

    res.json({ ok: true });
  } catch (err) {
    console.error("[wrapper] Failed to save Google credentials:", err);
    res.json({ ok: false, error: err.message });
  }
});

// API: Check which Google APIs are enabled (on-demand, not polled)
const API_TEST_COMMANDS = {
  gmail: "gmail labels list",
  calendar: "calendar calendars",
  tasks: "tasks lists",
  docs: "docs info __api_check__",
  meet: "meet spaces list",
  drive: "drive ls",
  contacts: "contacts list",
  sheets: "sheets metadata __api_check__",
};

app.get("/api/google/check", async (req, res) => {
  let email = "";
  let activeScopes = [];
  try {
    const stateData = JSON.parse(fs.readFileSync(GOG_STATE_PATH, "utf8"));
    email = stateData.email || "";
    activeScopes = stateData.services || [];
  } catch {}

  if (!email) return res.json({ error: "No Google account configured" });

  const enabledServices = activeScopes
    .map((s) => s.split(":")[0])
    .filter((v, i, a) => a.indexOf(v) === i);
  const results = {};

  for (const svc of enabledServices) {
    const cmd = API_TEST_COMMANDS[svc];
    if (!cmd) continue;

    const result = await gogCmd(`${cmd} --account ${email}`, { quiet: true });
    const stderr = result.stderr || "";
    if (
      stderr.includes("has not been used") ||
      stderr.includes("is not enabled")
    ) {
      const projectMatch = stderr.match(/project=(\d+)/);
      results[svc] = {
        status: "not_enabled",
        enableUrl: getApiEnableUrl(svc, projectMatch?.[1]),
      };
    } else if (
      result.ok ||
      stderr.includes("not found") ||
      stderr.includes("Not Found")
    ) {
      results[svc] = { status: "ok", enableUrl: getApiEnableUrl(svc) };
    } else {
      console.log(
        `[wrapper] API check ${svc} error: ${result.stderr?.slice(0, 300)}`,
      );
      results[svc] = {
        status: "error",
        message: result.stderr?.slice(0, 200),
        enableUrl: getApiEnableUrl(svc),
      };
    }
  }

  res.json({ email, results });
});

function getApiEnableUrl(svc, projectId) {
  const apiMap = {
    gmail: "gmail.googleapis.com",
    calendar: "calendar-json.googleapis.com",
    tasks: "tasks.googleapis.com",
    docs: "docs.googleapis.com",
    meet: "meet.googleapis.com",
    drive: "drive.googleapis.com",
    contacts: "people.googleapis.com",
    sheets: "sheets.googleapis.com",
  };
  const api = apiMap[svc] || "";
  const project = projectId ? `?project=${projectId}` : "";
  return `https://console.developers.google.com/apis/api/${api}/overview${project}`;
}

// API: Disconnect Google account
app.post("/api/google/disconnect", async (req, res) => {
  try {
    // Read state to get email
    let email = "";
    try {
      const stateData = JSON.parse(fs.readFileSync(GOG_STATE_PATH, "utf8"));
      email = stateData.email || "";
    } catch {}

    // Revoke token on Google's side
    if (email) {
      // Export token first so we can revoke it
      const exportResult = await gogCmd(
        `auth tokens export ${email} --out /tmp/gog-revoke.json --overwrite`,
        { quiet: true },
      );
      if (exportResult.ok) {
        try {
          const tokenData = JSON.parse(
            fs.readFileSync("/tmp/gog-revoke.json", "utf8"),
          );
          if (tokenData.refresh_token) {
            await fetch(
              `https://oauth2.googleapis.com/revoke?token=${tokenData.refresh_token}`,
              { method: "POST" },
            );
            console.log(`[wrapper] Revoked Google token for ${email}`);
          }
          fs.unlinkSync("/tmp/gog-revoke.json");
        } catch {}
      }

      // Remove from gog keyring
      await gogCmd(`auth remove ${email} --force`);
    }

    // Delete state and credentials
    for (const f of [GOG_STATE_PATH, GOG_CREDENTIALS_PATH]) {
      try {
        fs.unlinkSync(f);
        console.log(`[wrapper] Deleted ${f}`);
      } catch (e) {
        if (e.code !== "ENOENT")
          console.error(`[wrapper] Failed to delete ${f}: ${e.message}`);
      }
    }

    // Verify files are actually gone
    const stateStillExists = fs.existsSync(GOG_STATE_PATH);
    const credsStillExists = fs.existsSync(GOG_CREDENTIALS_PATH);
    if (stateStillExists || credsStillExists) {
      console.error(
        `[wrapper] Files survived deletion! state=${stateStillExists} creds=${credsStillExists}`,
      );
    }

    console.log(`[wrapper] Google disconnected: ${email}`);
    res.json({ ok: true });
  } catch (err) {
    console.error("[wrapper] Google disconnect error:", err);
    res.json({ ok: false, error: err.message });
  }
});

// OAuth: Start Google auth flow
app.get("/auth/google/start", (req, res) => {
  const email = req.query.email || "";
  const services = (
    req.query.services ||
    "gmail:read,gmail:write,calendar:read,calendar:write,drive:read,sheets:read,docs:read"
  )
    .split(",")
    .filter(Boolean);

  try {
    const { clientId } = readGoogleCredentials();
    if (!clientId) throw new Error("No client_id found");

    // Build scopes from selected services
    const scopes = [
      ...BASE_SCOPES,
      ...services.map((s) => SCOPE_MAP[s]).filter(Boolean),
    ].join(" ");
    console.log(
      `[wrapper] Google OAuth scopes: services=${services.join(",")} resolved=${scopes}`,
    );

    const redirectUri = `${getBaseUrl(req)}/auth/google/callback`;
    const state = Buffer.from(JSON.stringify({ email, services })).toString(
      "base64url",
    );

    const authUrl = new URL("https://accounts.google.com/o/oauth2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", scopes);
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("state", state);
    if (email) authUrl.searchParams.set("login_hint", email);

    res.redirect(authUrl.toString());
  } catch (err) {
    console.error("[wrapper] Failed to start Google auth:", err);
    res.redirect(
      "/setup?google=error&message=" + encodeURIComponent(err.message),
    );
  }
});

// OAuth: Google callback
app.get("/auth/google/callback", async (req, res) => {
  const { code, error, state } = req.query;

  if (error) {
    return res.redirect(
      "/setup?google=error&message=" + encodeURIComponent(error),
    );
  }
  if (!code) {
    return res.redirect("/setup?google=error&message=no_code");
  }

  try {
    // Decode state
    let email = "";
    try {
      const decoded = JSON.parse(Buffer.from(state, "base64url").toString());
      email = decoded.email || "";
    } catch {}

    // Read credentials from credentials.json
    const { clientId, clientSecret } = readGoogleCredentials();
    const redirectUri = `${getBaseUrl(req)}/auth/google/callback`;

    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokens = await tokenRes.json();
    if (!tokenRes.ok || tokens.error) {
      console.log(
        `[wrapper] Google token exchange failed: status=${tokenRes.status} error=${tokens.error} desc=${tokens.error_description}`,
      );
    }

    if (tokens.error) {
      throw new Error(
        `Google token error: ${tokens.error_description || tokens.error}`,
      );
    }

    if (!tokens.refresh_token) {
      // No refresh token = already authorized before. Check if we have one stored.
      let hasExisting = false;
      try {
        const stateData = JSON.parse(fs.readFileSync(GOG_STATE_PATH, "utf8"));
        hasExisting = stateData.authenticated;
      } catch {}

      if (hasExisting) {
        // Already have a token, scopes updated via consent screen
        console.log(
          "[wrapper] No new refresh token (already authorized), keeping existing",
        );
      } else {
        throw new Error(
          "No refresh token received. Revoke app access at myaccount.google.com/permissions and retry.",
        );
      }
    }

    // Get user email if not provided
    if (!email && tokens.access_token) {
      try {
        const infoRes = await fetch(
          "https://www.googleapis.com/oauth2/v2/userinfo",
          {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
          },
        );
        const info = await infoRes.json();
        email = info.email || email;
      } catch {}
    }

    // Import refresh token if we got a new one
    if (tokens.refresh_token) {
      const tokenFile = `/tmp/gog-token-${Date.now()}.json`;
      const tokenData = {
        email,
        client: "default",
        created_at: new Date().toISOString(),
        refresh_token: tokens.refresh_token,
      };
      fs.writeFileSync(tokenFile, JSON.stringify(tokenData, null, 2));
      const result = await gogCmd(`auth tokens import ${tokenFile}`);
      if (result.ok) {
        console.log(`[wrapper] Google token imported for ${email}`);
      } else {
        console.error(`[wrapper] Token import failed: ${result.stderr}`);
      }

      if (!result.ok) {
        console.error(
          `[wrapper] Token import failed, trying gog auth add --manual`,
        );
        // Fallback: use gog auth add with manual flow
        // Store token directly in keyring file as last resort
        const keyringDir = `${GOG_CONFIG_DIR}/keyring`;
        fs.mkdirSync(keyringDir, { recursive: true });
        fs.writeFileSync(
          `${keyringDir}/token-${email}.json`,
          JSON.stringify(tokenData, null, 2),
        );
        console.log(
          `[wrapper] Token written directly to keyring: ${keyringDir}/token-${email}.json`,
        );
      }

      try {
        fs.unlinkSync(tokenFile);
      } catch {}
    }

    // Decode requested services from state, then narrow to what was actually granted
    let services = [];
    try {
      const decoded = JSON.parse(Buffer.from(state, "base64url").toString());
      services = decoded.services || [];
    } catch {}

    const grantedServices = tokens.scope
      ? tokens.scope
          .split(" ")
          .map((s) => REVERSE_SCOPE_MAP[s])
          .filter(Boolean)
      : services;
    console.log(
      `[wrapper] Requested: ${services.join(",")} → Granted: ${grantedServices.join(",")}`,
    );

    // Update state
    fs.writeFileSync(
      GOG_STATE_PATH,
      JSON.stringify({
        email,
        clientId,
        clientSecret,
        services: grantedServices,
        authenticated: true,
      }),
    );

    // Close popup and notify parent
    res.send(`<!DOCTYPE html><html><body><script>
      window.opener?.postMessage({ google: 'success', email: '${email}' }, '*');
      window.close();
    </script><p>Google connected! You can close this window.</p></body></html>`);
  } catch (err) {
    console.error("[wrapper] Google OAuth callback error:", err);
    res.send(`<!DOCTYPE html><html><body><script>
      window.opener?.postMessage({ google: 'error', message: '${err.message.replace(/'/g, "\\'")}' }, '*');
      window.close();
    </script><p>Error: ${err.message}. You can close this window.</p></body></html>`);
  }
});

function getBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

const kChannelDefs = {
  telegram: { envKey: "TELEGRAM_BOT_TOKEN" },
  discord: { envKey: "DISCORD_BOT_TOKEN" },
};

// mode: 'remove' = only removals, 'add' = only additions, 'all' = both
function syncChannelConfig(savedVars, mode = "all") {
  try {
    const configPath = `${OPENCLAW_DIR}/openclaw.json`;
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const savedMap = Object.fromEntries(
      savedVars.filter((v) => v.value).map((v) => [v.key, v.value]),
    );
    const env = gatewayEnv();

    for (const [ch, def] of Object.entries(kChannelDefs)) {
      const token = savedMap[def.envKey];
      const isConfigured = cfg.channels?.[ch]?.enabled;

      if (token && !isConfigured && (mode === "add" || mode === "all")) {
        console.log(`[wrapper] Adding channel: ${ch}`);
        try {
          execSync(`openclaw channels add --channel ${ch} --token "${token}"`, {
            env,
            timeout: 15000,
            encoding: "utf8",
          });
          const raw = fs.readFileSync(configPath, "utf8");
          if (raw.includes(token)) {
            fs.writeFileSync(
              configPath,
              raw.split(token).join("${" + def.envKey + "}"),
            );
          }
          console.log(`[wrapper] Channel ${ch} added`);
        } catch (e) {
          console.error(
            `[wrapper] channels add ${ch}: ${(e.stderr || e.message || "").toString().trim().slice(0, 200)}`,
          );
        }
      } else if (
        !token &&
        isConfigured &&
        (mode === "remove" || mode === "all")
      ) {
        console.log(`[wrapper] Removing channel: ${ch}`);
        try {
          execSync(`openclaw channels remove --channel ${ch} --delete`, {
            env,
            timeout: 15000,
            encoding: "utf8",
          });
          console.log(`[wrapper] Channel ${ch} removed`);
        } catch (e) {
          console.error(
            `[wrapper] channels remove ${ch}: ${(e.stderr || e.message || "").toString().trim().slice(0, 200)}`,
          );
        }
      }
    }
  } catch (e) {
    console.error("[wrapper] syncChannelConfig error:", e.message);
  }
}

function getChannelStatus() {
  try {
    const config = JSON.parse(
      fs.readFileSync(`${OPENCLAW_DIR}/openclaw.json`, "utf8"),
    );
    const credDir = `${OPENCLAW_DIR}/credentials`;
    const channels = {};

    for (const ch of ["telegram", "discord"]) {
      if (!config.channels?.[ch]?.enabled) continue;
      if (!process.env[kChannelDefs[ch].envKey]) continue;

      // Check for paired users (credential files + inline allowFrom in config)
      let paired = 0;
      try {
        const files = fs
          .readdirSync(credDir)
          .filter(
            (f) => f.startsWith(`${ch}-`) && f.endsWith("-allowFrom.json"),
          );
        for (const file of files) {
          const data = JSON.parse(
            fs.readFileSync(`${credDir}/${file}`, "utf8"),
          );
          paired += (data.allowFrom || []).length;
        }
      } catch {}
      // Also check allowFrom in openclaw.json (gateway writes pairing approvals here)
      const inlineAllowFrom = config.channels[ch]?.allowFrom;
      if (Array.isArray(inlineAllowFrom)) paired += inlineAllowFrom.length;

      channels[ch] = { status: paired > 0 ? "paired" : "configured", paired };
    }

    return channels;
  } catch {
    return {};
  }
}

// Gateway control UI + assets → proxy to gateway
app.all("/openclaw", (req, res) => {
  req.url = "/";
  proxy.web(req, res);
});
app.all("/openclaw/*", (req, res) => {
  req.url = req.url.replace(/^\/openclaw/, "");
  proxy.web(req, res);
});
app.all("/assets/*", (req, res) => proxy.web(req, res));

// Webhooks → proxy to gateway, promoting query string token to Authorization header
app.all("/webhook/*", (req, res) => {
  if (!req.headers.authorization && req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`;
    delete req.query.token;
    const url = new URL(req.url, `http://${req.headers.host}`);
    url.searchParams.delete("token");
    req.url = url.pathname + url.search;
  }
  proxy.web(req, res);
});

// Proxy non-setup API routes to gateway
const SETUP_API_PREFIXES = [
  "/api/status",
  "/api/pairings",
  "/api/google",
  "/api/codex",
  "/api/models",
  "/api/gateway",
  "/api/onboard",
  "/api/env",
  "/api/auth",
];
app.all("/api/*", (req, res) => {
  if (SETUP_API_PREFIXES.some((p) => req.path.startsWith(p))) return;
  proxy.web(req, res);
});

// ============================================================
// 4. Start server
// ============================================================

const server = http.createServer(app);

// WebSocket upgrade → proxy to gateway
server.on("upgrade", (req, socket, head) => {
  proxy.ws(req, socket, head);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[wrapper] Express listening on :${PORT}`);
  if (isOnboarded()) {
    reloadEnv();
    syncChannelConfig(readEnvFile());
    startGateway();
  } else {
    console.log("[wrapper] Awaiting onboarding via Setup UI");
  }
});
