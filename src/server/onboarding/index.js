const { validateOnboardingInput } = require("./validation");
const { ensureGithubRepoAccessible } = require("./github");
const { buildOnboardArgs, writeSanitizedOpenclawConfig } = require("./openclaw");
const { appendTemplateIfMissing, installControlUiSkill } = require("./workspace");
const { installHourlyGitSyncScript, installHourlyGitSyncCron } = require("./cron");

const createOnboardingService = ({
  fs,
  constants,
  shellCmd,
  gatewayEnv,
  writeEnvFile,
  reloadEnv,
  resolveGithubRepoUrl,
  resolveModelProvider,
  hasCodexOauthProfile,
  ensureGatewayProxyConfig,
  getBaseUrl,
  startGateway,
}) => {
  const { OPENCLAW_DIR, WORKSPACE_DIR } = constants;

  const completeOnboarding = async ({ req, vars, modelKey }) => {
    const validation = validateOnboardingInput({
      vars,
      modelKey,
      resolveModelProvider,
      hasCodexOauthProfile,
    });
    if (!validation.ok) {
      return { status: validation.status, body: { ok: false, error: validation.error } };
    }

    const { varMap, githubToken, githubRepoInput, selectedProvider, hasCodexOauth } =
      validation.data;

    const repoUrl = resolveGithubRepoUrl(githubRepoInput);
    const varsToSave = [...vars.filter((v) => v.value && v.key !== "GITHUB_WORKSPACE_REPO")];
    varsToSave.push({ key: "GITHUB_WORKSPACE_REPO", value: repoUrl });
    writeEnvFile(varsToSave);
    reloadEnv();

    const remoteUrl = `https://${githubToken}@github.com/${repoUrl}.git`;
    const [, repoName] = repoUrl.split("/");
    const repoCheck = await ensureGithubRepoAccessible({
      repoUrl,
      repoName,
      remoteUrl,
      githubToken,
    });
    if (!repoCheck.ok) {
      return { status: repoCheck.status, body: { ok: false, error: repoCheck.error } };
    }

    fs.mkdirSync(OPENCLAW_DIR, { recursive: true });
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

    if (!fs.existsSync(`${OPENCLAW_DIR}/.git`)) {
      await shellCmd(
        `cd ${OPENCLAW_DIR} && git init -b main && git remote add origin "${remoteUrl}" && git config user.email "agent@openclaw.ai" && git config user.name "OpenClaw Agent"`,
      );
      console.log("[onboard] Git initialized");
    }

    if (!fs.existsSync(`${OPENCLAW_DIR}/.gitignore`)) {
      fs.copyFileSync("/app/setup/gitignore", `${OPENCLAW_DIR}/.gitignore`);
    }

    const onboardArgs = buildOnboardArgs({
      varMap,
      selectedProvider,
      hasCodexOauth,
      workspaceDir: WORKSPACE_DIR,
    });
    console.log(
      `[onboard] Running: openclaw onboard ${onboardArgs.join(" ").replace(/sk-[^\s]+/g, "***")}`,
    );
    await shellCmd(`openclaw onboard ${onboardArgs.map((a) => `"${a}"`).join(" ")}`, {
      env: {
        ...process.env,
        OPENCLAW_HOME: "/data",
        OPENCLAW_CONFIG_PATH: `${OPENCLAW_DIR}/openclaw.json`,
      },
      timeout: 120000,
    });
    console.log("[onboard] Onboard complete");

    await shellCmd(`openclaw models set "${modelKey}"`, {
      env: gatewayEnv(),
      timeout: 30000,
    }).catch((e) => {
      console.error("[onboard] Failed to set model:", e.message);
      throw new Error(`Onboarding completed but failed to set model "${modelKey}"`);
    });

    try {
      fs.rmSync(`${WORKSPACE_DIR}/.git`, { recursive: true, force: true });
    } catch {}

    writeSanitizedOpenclawConfig({ fs, openclawDir: OPENCLAW_DIR, varMap });
    ensureGatewayProxyConfig(getBaseUrl(req));

    appendTemplateIfMissing({
      fs,
      targetPath: `${WORKSPACE_DIR}/AGENTS.md`,
      templatePath: "/app/setup/AGENTS.md.append",
      marker: "No YOLO System Changes",
      logPrefix: "AGENTS.md",
    });
    appendTemplateIfMissing({
      fs,
      targetPath: `${WORKSPACE_DIR}/TOOLS.md`,
      templatePath: "/app/setup/TOOLS.md.append",
      marker: "Git Discipline",
      logPrefix: "TOOLS.md",
    });
    installControlUiSkill({ fs, openclawDir: OPENCLAW_DIR, baseUrl: getBaseUrl(req) });

    await shellCmd(
      `cd ${OPENCLAW_DIR} && git add -A && git commit -m "initial setup" && git push -u --force origin main`,
      { timeout: 30000 },
    ).catch((e) => console.error("[onboard] Git push error:", e.message));
    console.log("[onboard] Initial state committed and pushed");

    installHourlyGitSyncScript({ fs, openclawDir: OPENCLAW_DIR });
    await installHourlyGitSyncCron({ fs, openclawDir: OPENCLAW_DIR });

    startGateway();
    return { status: 200, body: { ok: true } };
  };

  return { completeOnboarding };
};

module.exports = { createOnboardingService };
