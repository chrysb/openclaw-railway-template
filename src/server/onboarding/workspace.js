const appendTemplateIfMissing = ({ fs, targetPath, templatePath, marker, logPrefix }) => {
  try {
    const current = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, "utf8") : "";
    if (!current.includes(marker)) {
      fs.appendFileSync(targetPath, fs.readFileSync(templatePath, "utf8"));
    }
  } catch (e) {
    console.error(`[onboard] ${logPrefix} append error:`, e.message);
  }
};

const installControlUiSkill = ({ fs, openclawDir, baseUrl }) => {
  try {
    const skillDir = `${openclawDir}/skills/control-ui`;
    fs.mkdirSync(skillDir, { recursive: true });
    const skillTemplate = fs.readFileSync("/app/setup/skills/control-ui/SKILL.md", "utf8");
    const skillContent = skillTemplate.replace(/\{\{BASE_URL\}\}/g, baseUrl);
    fs.writeFileSync(`${skillDir}/SKILL.md`, skillContent);
    console.log(`[onboard] Control UI skill installed (${baseUrl})`);
  } catch (e) {
    console.error("[onboard] Skill install error:", e.message);
  }
};

module.exports = { appendTemplateIfMissing, installControlUiSkill };
