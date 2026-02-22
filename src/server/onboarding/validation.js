const validateOnboardingInput = ({ vars, modelKey, resolveModelProvider, hasCodexOauthProfile }) => {
  if (!Array.isArray(vars)) {
    return { ok: false, status: 400, error: "Missing vars array" };
  }
  if (!modelKey || typeof modelKey !== "string" || !modelKey.includes("/")) {
    return { ok: false, status: 400, error: "A model selection is required" };
  }

  const varMap = Object.fromEntries(vars.map((v) => [v.key, v.value]));
  const githubToken = String(varMap.GITHUB_TOKEN || "");
  const githubRepoInput = String(varMap.GITHUB_WORKSPACE_REPO || "").trim();
  const selectedProvider = resolveModelProvider(modelKey);
  const hasCodexOauth = hasCodexOauthProfile();
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
      return {
        ok: false,
        status: 400,
        error: "Connect OpenAI Codex OAuth or provide OPENAI_API_KEY before continuing",
      };
    }
    return {
      ok: false,
      status: 400,
      error: `Missing credentials for selected provider "${selectedProvider}"`,
    };
  }
  if (!hasGithub) {
    return {
      ok: false,
      status: 400,
      error: "GitHub token and workspace repo are required",
    };
  }
  if (!hasChannel) {
    return {
      ok: false,
      status: 400,
      error: "At least one channel token is required",
    };
  }

  return {
    ok: true,
    data: {
      varMap,
      githubToken,
      githubRepoInput,
      selectedProvider,
      hasCodexOauth,
    },
  };
};

module.exports = { validateOnboardingInput };
