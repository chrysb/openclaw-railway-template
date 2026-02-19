import { h, render } from "https://esm.sh/preact";
import { useState, useEffect } from "https://esm.sh/preact/hooks";
import htm from "https://esm.sh/htm";
import {
  fetchStatus,
  fetchPairings,
  approvePairing,
  rejectPairing,
  fetchOnboardStatus,
} from "./lib/api.js";
import { usePolling } from "./hooks/usePolling.js";
import { Gateway } from "./components/gateway.js";
import { Channels, ALL_CHANNELS } from "./components/channels.js";
import { Pairings } from "./components/pairings.js";
import { Google } from "./components/google.js";
import { Welcome } from "./components/welcome.js";
import { Envars } from "./components/envars.js";
import { ToastContainer } from "./components/toast.js";
const html = htm.bind(h);

const GeneralTab = ({ onSwitchTab }) => {
  const [googleKey, setGoogleKey] = useState(0);

  const statusPoll = usePolling(fetchStatus, 15000);
  const status = statusPoll.data;
  const gatewayStatus = status?.gateway ?? null;
  const channels = status?.channels ?? null;
  const repo = status?.repo || null;

  const hasUnpaired = ALL_CHANNELS.some((ch) => {
    const info = channels?.[ch];
    return info && info.status !== "paired";
  });

  const hasPaired = ALL_CHANNELS.some(
    (ch) => channels?.[ch]?.status === "paired",
  );

  const pairingsPoll = usePolling(
    async () => {
      const d = await fetchPairings();
      return d.pending || [];
    },
    1000,
    { enabled: hasUnpaired && gatewayStatus === "running" },
  );
  const pending = pairingsPoll.data || [];

  // Poll status faster when gateway isn't running yet
  useEffect(() => {
    if (!gatewayStatus || gatewayStatus !== "running") {
      const id = setInterval(statusPoll.refresh, 3000);
      return () => clearInterval(id);
    }
  }, [gatewayStatus, statusPoll.refresh]);

  const refreshAfterAction = () => {
    setTimeout(pairingsPoll.refresh, 500);
    setTimeout(pairingsPoll.refresh, 2000);
    setTimeout(statusPoll.refresh, 3000);
  };

  const handleApprove = async (id, channel) => {
    await approvePairing(id, channel);
    refreshAfterAction();
  };

  const handleReject = async (id, channel) => {
    await rejectPairing(id, channel);
    refreshAfterAction();
  };

  const fullRefresh = () => {
    statusPoll.refresh();
    pairingsPoll.refresh();
    setGoogleKey((k) => k + 1);
  };

  return html`
    <div class="space-y-4">
      <${Gateway} status=${gatewayStatus} />
      <${Channels} channels=${channels} onSwitchTab=${onSwitchTab} />
      <${Pairings}
        pending=${pending}
        channels=${channels}
        visible=${hasUnpaired}
        onApprove=${handleApprove}
        onReject=${handleReject}
      />
      ${hasPaired && html`<${Google} key=${googleKey} />`}

      ${repo && html`
        <div class="bg-surface border border-border rounded-xl p-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <svg class="w-4 h-4 text-gray-400" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
              <a href="https://github.com/${repo}" target="_blank" class="text-sm text-gray-400 hover:text-gray-200 transition-colors">${repo}</a>
            </div>
            <a
              href="https://github.com/${repo}"
              target="_blank"
              class="text-xs px-2.5 py-1 rounded-lg border border-border text-gray-500 hover:text-gray-300 hover:border-gray-500 transition-colors"
            >View</a>
          </div>
        </div>
      `}

      <div class="bg-surface border border-border rounded-xl p-4">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="font-semibold text-sm">Gateway Dashboard</h2>
          </div>
          <a
            href="/openclaw"
            target="_blank"
            class="text-xs px-2.5 py-1 rounded-lg border border-border text-gray-500 hover:text-gray-300 hover:border-gray-500 transition-colors"
            >Open</a
          >
        </div>
      </div>

      <p class="text-center text-gray-600 text-xs">
        <a
          href="#"
          onclick=${(e) => {
            e.preventDefault();
            fullRefresh();
          }}
          class="text-gray-500 hover:text-gray-300"
          >Refresh all</a
        >
      </p>
    </div>
  `;
};

function App() {
  const [onboarded, setOnboarded] = useState(null);
  const [tab, setTab] = useState("general");

  useEffect(() => {
    fetchOnboardStatus()
      .then((data) => setOnboarded(data.onboarded))
      .catch(() => setOnboarded(false));
  }, []);

  // Still loading onboard status
  if (onboarded === null) {
    return html`
      <div class="max-w-lg w-full flex items-center justify-center py-20">
        <svg
          class="animate-spin h-6 w-6 text-gray-500"
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle
            class="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            stroke-width="4"
          />
          <path
            class="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      </div>
      <${ToastContainer} />
    `;
  }

  if (!onboarded) {
    return html`
      <${Welcome} onComplete=${() => setOnboarded(true)} />
      <${ToastContainer} />
    `;
  }

  return html`
    <div class="max-w-lg w-full">
      <div class="sticky top-0 z-10 bg-[#0a0a0a] pb-3">
        <div class="flex items-center gap-3 pb-3">
          <div class="text-4xl">🦞</div>
          <div>
            <h1 class="text-2xl font-semibold">OpenClaw Setup</h1>
            <p class="text-gray-500 text-sm">This should be easy, right?</p>
          </div>
        </div>

        <div class="flex gap-1 border-b border-border">
          ${["general", "envars"].map(
            (t) => html`
              <button
                onclick=${() => setTab(t)}
                class="px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab ===
                t
                  ? "border-white text-white"
                  : "border-transparent text-gray-500 hover:text-gray-300"}"
              >
                ${t === "general" ? "General" : "Envars"}
              </button>
            `,
          )}
        </div>
      </div>

      <div class="space-y-4 pt-4">
        ${tab === "general"
          ? html`<${GeneralTab} onSwitchTab=${setTab} />`
          : html`<${Envars} />`}
      </div>
    </div>
    <${ToastContainer} />
  `;
}

render(html`<${App} />`, document.getElementById("app"));
