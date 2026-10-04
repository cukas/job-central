import type { AiProvider, AppData } from "../../shared/types.js";
import { store } from "../store.js";
import { detectAiProviders } from "./ai.js";

export function markActive(providers: AiProvider[], activeKey: AiProvider["key"] | undefined): AiProvider[] {
  return providers.map((provider) => ({ ...provider, selected: provider.key === activeKey }));
}

// Detection awaits slow shell probes, so only detected/version are taken from its
// result and merged onto the providers read AFTER the await — a pick or model change
// made mid-detection must survive.
export async function redetectProviders(draft: AppData) {
  const probed = new Map((await detectAiProviders(draft.aiProviders)).map((provider) => [provider.key, provider]));
  const merged = draft.aiProviders.map((provider) => {
    const result = probed.get(provider.key);
    return result ? { ...provider, detected: result.detected, version: result.version } : provider;
  });
  draft.aiProviders = markActive(merged, draft.settings.activeAiProvider);
}

const REPROBE_COOLDOWN_MS = 30_000;
let reprobe: Promise<unknown> | undefined;
let lastReprobeAt = 0;

// Shell probes take seconds: concurrent AI calls share one in-flight probe, and a
// still-missing engine is not re-probed more than once per cooldown window.
export async function ensureActiveProviderDetected() {
  const data = await store.load();
  const active = data.aiProviders.find((provider) => provider.key === data.settings.activeAiProvider);
  if (!active || active.detected || active.key === "custom") return;
  if (!reprobe && Date.now() - lastReprobeAt < REPROBE_COOLDOWN_MS) return;
  reprobe ??= store.update(redetectProviders).finally(() => {
    lastReprobeAt = Date.now();
    reprobe = undefined;
  });
  await reprobe;
}

export function engineMissingMessage(data: AppData) {
  const active = data.aiProviders.find((provider) => provider.key === data.settings.activeAiProvider);
  return active
    ? `${active.label} was not found on this Mac. Check it is installed (\`${active.command} --version\` in Terminal), then press Detect in Settings → AI CLI.`
    : "No AI engine is selected. Choose Claude Code, Codex or Antigravity in Settings → AI CLI.";
}
