const { createOnboardingService } = require("../onboarding");

const registerOnboardingRoutes = ({
  app,
  fs,
  constants,
  shellCmd,
  gatewayEnv,
  writeEnvFile,
  reloadEnv,
  isOnboarded,
  resolveGithubRepoUrl,
  resolveModelProvider,
  hasCodexOauthProfile,
  ensureGatewayProxyConfig,
  getBaseUrl,
  startGateway,
}) => {
  const onboardingService = createOnboardingService({
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
  });

  app.get("/api/onboard/status", (req, res) => {
    res.json({ onboarded: isOnboarded() });
  });

  app.post("/api/onboard", async (req, res) => {
    if (isOnboarded())
      return res.json({ ok: false, error: "Already onboarded" });

    try {
      const { vars, modelKey } = req.body;
      const result = await onboardingService.completeOnboarding({
        req,
        vars,
        modelKey,
      });
      res.status(result.status).json(result.body);
    } catch (err) {
      console.error("[onboard] Error:", err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });
};

module.exports = { registerOnboardingRoutes };
