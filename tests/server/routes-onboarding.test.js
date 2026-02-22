const express = require("express");
const request = require("supertest");

const { registerOnboardingRoutes } = require("../../src/server/routes/onboarding");

const createBaseDeps = ({ onboarded = false, hasCodexOauth = false } = {}) => ({
  fs: {
    mkdirSync: vi.fn(),
    existsSync: vi.fn(() => false),
    copyFileSync: vi.fn(),
    rmSync: vi.fn(),
    readFileSync: vi.fn(() => "{}"),
    writeFileSync: vi.fn(),
    appendFileSync: vi.fn(),
  },
  constants: {
    OPENCLAW_DIR: "/tmp/openclaw",
    WORKSPACE_DIR: "/tmp/openclaw/workspace",
  },
  shellCmd: vi.fn(async () => ""),
  gatewayEnv: vi.fn(() => ({ OPENCLAW_GATEWAY_TOKEN: "tok" })),
  writeEnvFile: vi.fn(),
  reloadEnv: vi.fn(),
  isOnboarded: vi.fn(() => onboarded),
  resolveGithubRepoUrl: vi.fn((value) => value),
  resolveModelProvider: vi.fn((modelKey) => String(modelKey).split("/")[0]),
  hasCodexOauthProfile: vi.fn(() => hasCodexOauth),
  ensureGatewayProxyConfig: vi.fn(),
  getBaseUrl: vi.fn(() => "https://example.com"),
  startGateway: vi.fn(),
});

const createApp = (deps) => {
  const app = express();
  app.use(express.json());
  registerOnboardingRoutes({ app, ...deps });
  return app;
};

const makeValidBody = () => ({
  modelKey: "openai/gpt-5.1-codex",
  vars: [
    { key: "OPENAI_API_KEY", value: "sk-test-123456789" },
    { key: "GITHUB_TOKEN", value: "ghp_test_123456789" },
    { key: "GITHUB_WORKSPACE_REPO", value: "owner/repo" },
    { key: "TELEGRAM_BOT_TOKEN", value: "telegram_123456789" },
  ],
});

describe("server/routes/onboarding", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it("returns onboard status from dependency", async () => {
    const deps = createBaseDeps({ onboarded: true });
    const app = createApp(deps);

    const res = await request(app).get("/api/onboard/status");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ onboarded: true });
  });

  it("short-circuits when already onboarded", async () => {
    const deps = createBaseDeps({ onboarded: true });
    const app = createApp(deps);

    const res = await request(app).post("/api/onboard").send(makeValidBody());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: false, error: "Already onboarded" });
  });

  it("validates missing vars array", async () => {
    const deps = createBaseDeps();
    const app = createApp(deps);

    const res = await request(app).post("/api/onboard").send({ modelKey: "openai/gpt-5.1" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ ok: false, error: "Missing vars array" });
  });

  it("validates missing model selection", async () => {
    const deps = createBaseDeps();
    const app = createApp(deps);

    const res = await request(app).post("/api/onboard").send({ vars: [] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ ok: false, error: "A model selection is required" });
  });

  it("requires codex oauth or API key for openai-codex provider", async () => {
    const deps = createBaseDeps({ hasCodexOauth: false });
    const app = createApp(deps);

    const body = {
      modelKey: "openai-codex/gpt-5.3-codex",
      vars: [
        { key: "GITHUB_TOKEN", value: "ghp_test_123456789" },
        { key: "GITHUB_WORKSPACE_REPO", value: "owner/repo" },
        { key: "TELEGRAM_BOT_TOKEN", value: "telegram_123456789" },
      ],
    };

    const res = await request(app).post("/api/onboard").send(body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      ok: false,
      error: "Connect OpenAI Codex OAuth or provide OPENAI_API_KEY before continuing",
    });
  });

  it("returns github error when repository check fails", async () => {
    const deps = createBaseDeps();
    const app = createApp(deps);
    global.fetch.mockRejectedValue(new Error("network down"));

    const res = await request(app).post("/api/onboard").send(makeValidBody());

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ ok: false, error: "GitHub error: network down" });
    expect(deps.writeEnvFile).toHaveBeenCalledTimes(1);
    expect(deps.reloadEnv).toHaveBeenCalledTimes(1);
  });

  it("installs deterministic hourly git sync cron during successful onboarding", async () => {
    const deps = createBaseDeps();
    deps.fs.readFileSync.mockImplementation((path) => {
      if (path === "/tmp/openclaw/openclaw.json") return "{}";
      if (path === "/app/setup/AGENTS.md.append") return "AGENTS_APPEND";
      if (path === "/app/setup/TOOLS.md.append") return "TOOLS_APPEND";
      if (path === "/app/setup/skills/control-ui/SKILL.md") return "BASE={{BASE_URL}}";
      if (path === "/app/setup/hourly-git-sync.sh") return "echo Auto-commit hourly sync";
      return "{}";
    });
    const app = createApp(deps);
    global.fetch
      .mockResolvedValueOnce({ status: 404 })
      .mockResolvedValueOnce({ ok: true, statusText: "ok", json: async () => ({}) });

    const res = await request(app).post("/api/onboard").send(makeValidBody());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(deps.startGateway).toHaveBeenCalledTimes(1);

    expect(deps.fs.writeFileSync).toHaveBeenCalledWith(
      "/tmp/openclaw/hourly-git-sync.sh",
      expect.stringContaining("Auto-commit hourly sync"),
      expect.objectContaining({ mode: 0o755 }),
    );

    expect(deps.fs.writeFileSync).toHaveBeenCalledWith(
      "/etc/cron.d/openclaw-hourly-sync",
      expect.stringContaining('0 * * * * root bash "/tmp/openclaw/hourly-git-sync.sh"'),
      expect.objectContaining({ mode: 0o644 }),
    );

    const initialPushCall = deps.shellCmd.mock.calls.find(([cmd]) =>
      cmd.includes('git commit -m "initial setup"'),
    );
    expect(initialPushCall[0]).toContain("git push -u --force origin main");
  });

  it("allows onboarding into an existing repo and still force-pushes initial setup", async () => {
    const deps = createBaseDeps();
    deps.fs.readFileSync.mockImplementation((path) => {
      if (path === "/tmp/openclaw/openclaw.json") return "{}";
      if (path === "/app/setup/AGENTS.md.append") return "AGENTS_APPEND";
      if (path === "/app/setup/TOOLS.md.append") return "TOOLS_APPEND";
      if (path === "/app/setup/skills/control-ui/SKILL.md") return "BASE={{BASE_URL}}";
      if (path === "/app/setup/hourly-git-sync.sh") return "echo Auto-commit hourly sync";
      return "{}";
    });
    const app = createApp(deps);
    global.fetch.mockResolvedValueOnce({ ok: true, status: 200 });

    const res = await request(app).post("/api/onboard").send(makeValidBody());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const initialPushCall = deps.shellCmd.mock.calls.find(([cmd]) =>
      cmd.includes('git commit -m "initial setup"'),
    );
    expect(initialPushCall).toBeTruthy();
    expect(initialPushCall[0]).toContain("git push -u --force origin main");
  });
});
