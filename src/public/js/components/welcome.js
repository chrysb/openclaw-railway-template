import { h } from "https://esm.sh/preact";
import { useState, useEffect } from "https://esm.sh/preact/hooks";
import htm from "https://esm.sh/htm";
import { runOnboard } from "../lib/api.js";
const html = htm.bind(h);

const kGroups = [
  {
    id: "ai",
    title: "AI Provider",
    description: "At least one is required to power your agent",
    fields: [
      { key: "ANTHROPIC_API_KEY", label: "Anthropic API Key", hint: "From console.anthropic.com — recommended", placeholder: "sk-ant-..." },
      { key: "ANTHROPIC_TOKEN", label: "Anthropic Setup Token", hint: "From claude setup-token (uses your Claude subscription)", placeholder: "Token..." },
      { key: "OPENAI_API_KEY", label: "OpenAI API Key", hint: "From platform.openai.com", placeholder: "sk-..." },
      { key: "GEMINI_API_KEY", label: "Gemini API Key", hint: "From aistudio.google.com", placeholder: "AI..." },
    ],
    validate: (vals) => !!(vals.ANTHROPIC_API_KEY || vals.ANTHROPIC_TOKEN || vals.OPENAI_API_KEY || vals.GEMINI_API_KEY),
  },
  {
    id: "github",
    title: "GitHub",
    description: "Backs up your agent's config and workspace",
    fields: [
      {
        key: "GITHUB_TOKEN",
        label: "Personal Access Token",
        hint: html`Create at <a href="https://github.com/settings/tokens" target="_blank" class="text-blue-400 hover:underline">github.com/settings/tokens</a> with <code class="text-xs bg-black/30 px-1 rounded">repo</code> scope`,
        placeholder: "ghp_...",
      },
      { key: "GITHUB_WORKSPACE_REPO", label: "Workspace Repo", hint: "We'll create this private repo for you if it doesn't exist", placeholder: "username/my-agent", isText: true },
    ],
    validate: (vals) => !!(vals.GITHUB_TOKEN && vals.GITHUB_WORKSPACE_REPO),
  },
  {
    id: "channels",
    title: "Channels",
    description: "At least one is required to talk to your agent",
    fields: [
      {
        key: "TELEGRAM_BOT_TOKEN",
        label: "Telegram Bot Token",
        hint: html`From <a href="https://t.me/BotFather" target="_blank" class="text-blue-400 hover:underline">@BotFather</a> · <a href="https://docs.openclaw.ai/channels/telegram" target="_blank" class="text-blue-400 hover:underline">full guide</a>`,
        placeholder: "123456789:AAH...",
      },
      {
        key: "DISCORD_BOT_TOKEN",
        label: "Discord Bot Token",
        hint: html`From <a href="https://discord.com/developers/applications" target="_blank" class="text-blue-400 hover:underline">Developer Portal</a> · <a href="https://docs.openclaw.ai/channels/discord" target="_blank" class="text-blue-400 hover:underline">full guide</a>`,
        placeholder: "MTQ3...",
      },
    ],
    validate: (vals) => !!(vals.TELEGRAM_BOT_TOKEN || vals.DISCORD_BOT_TOKEN),
  },
  {
    id: "tools",
    title: "Tools (optional)",
    description: "Enable extra capabilities for your agent",
    fields: [
      {
        key: "BRAVE_API_KEY",
        label: "Brave Search API Key",
        hint: html`From <a href="https://brave.com/search/api/" target="_blank" class="text-blue-400 hover:underline">brave.com/search/api</a> — free tier available`,
        placeholder: "BSA...",
      },
    ],
    validate: () => true,
  },
];

export const Welcome = ({ onComplete }) => {
  const [vals, setVals] = useState(() => {
    try { return JSON.parse(localStorage.getItem('openclaw_setup') || '{}'); }
    catch { return {}; }
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    localStorage.setItem('openclaw_setup', JSON.stringify(vals));
  }, [vals]);

  const set = (key, value) => setVals((prev) => ({ ...prev, [key]: value }));

  const allValid = kGroups.every((g) => g.validate(vals));

  const handleSubmit = async () => {
    if (!allValid || loading) return;
    setLoading(true);
    setError(null);

    try {
      const vars = Object.entries(vals)
        .filter(([, v]) => v)
        .map(([key, value]) => ({ key, value }));
      const result = await runOnboard(vars);
      if (!result.ok) throw new Error(result.error || "Onboarding failed");
      localStorage.removeItem('openclaw_setup');
      onComplete();
    } catch (err) {
      console.error("Onboard error:", err);
      setError(err.message);
      setLoading(false);
    }
  };

  if (loading) {
    return html`
      <div class="fixed inset-0 bg-[#0a0a0a] flex items-center justify-center z-50">
        <div class="flex flex-col items-center gap-4">
          <svg class="animate-spin h-8 w-8 text-white" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <h2 class="text-lg font-semibold text-white">Initializing OpenClaw</h2>
          <p class="text-sm text-gray-500">This could take 10–15 seconds</p>
        </div>
      </div>
    `;
  }

  return html`
    <div class="max-w-lg w-full space-y-4">
      <div class="flex items-center gap-3">
        <div class="text-4xl">🦞</div>
        <div>
          <h1 class="text-2xl font-semibold">Welcome to OpenClaw</h1>
          <p class="text-gray-500 text-sm">
            Let's get your agent running
          </p>
        </div>
      </div>

      ${kGroups.map(
        (group) => html`
          <div class="bg-surface border border-border rounded-xl p-4 space-y-3">
            <div class="flex items-center justify-between">
              <div>
                <h2 class="text-sm font-medium text-gray-200">
                  ${group.title}
                </h2>
                <p class="text-xs text-gray-500">${group.description}</p>
              </div>
              ${group.validate(vals)
                ? html`<span
                    class="text-xs font-medium px-2 py-0.5 rounded-full bg-green-900/50 text-green-400"
                    >✓</span
                  >`
                : group.id !== "tools"
                ? html`<span
                    class="text-xs font-medium px-2 py-0.5 rounded-full bg-yellow-900/50 text-yellow-400"
                    >Required</span
                  >`
                : null}
            </div>

            ${group.fields.map(
              (field) => html`
                <div class="space-y-1">
                  <label class="text-xs font-medium text-gray-400"
                    >${field.label}</label
                  >
                  <input
                    type=${field.isText ? "text" : "password"}
                    placeholder=${field.placeholder || ""}
                    value=${vals[field.key] || ""}
                    onInput=${(e) => set(field.key, e.target.value)}
                    class="w-full bg-black/30 border border-border rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-gray-500 font-mono"
                  />
                  <p class="text-xs text-gray-600">${field.hint}</p>
                </div>
              `
            )}
          </div>
        `
      )}

      ${error
        ? html`<div
            class="bg-red-900/30 border border-red-800 rounded-xl p-3 text-red-300 text-sm"
          >
            ${error}
          </div>`
        : null}

      <button
        onclick=${handleSubmit}
        disabled=${!allValid}
        class="w-full text-sm font-medium px-4 py-3 rounded-xl transition-all ${allValid
          ? "bg-white text-black hover:opacity-85"
          : "bg-gray-800 text-gray-500 cursor-not-allowed"}"
      >
        Complete Setup
      </button>
    </div>
  `;
};
