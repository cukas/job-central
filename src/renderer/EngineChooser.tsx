import { useEffect, useRef, useState } from "react";
import { Check, Download, ExternalLink, Loader2, RefreshCw, Sparkles } from "lucide-react";
import type { AiProvider, AppData } from "../shared/types";
import { jobCentral } from "./api";

type Run = <T>(label: string, task: () => Promise<T>, done?: (value: T) => string) => Promise<T | undefined>;
type Busy = null | "scan" | "install" | "test";

function initialChoice(data: AppData): AiProvider["key"] | null {
  const engines = data.aiProviders.filter((provider) => provider.key !== "custom");
  const active = engines.find((provider) => provider.key === data.settings.activeAiProvider && provider.detected);
  return active?.key ?? engines.find((provider) => provider.detected)?.key ?? null;
}

export function EngineChooser({
  data,
  setData,
  run,
  isDe,
  onContinue,
}: {
  data: AppData;
  setData: (data: AppData) => void;
  run: Run;
  isDe: boolean;
  onContinue: (providerKey?: AiProvider["key"]) => void;
}) {
  const engines = data.aiProviders.filter((provider) => provider.key !== "custom");
  const [choice, setChoice] = useState<AiProvider["key"] | null>(() => initialChoice(data));
  const [busy, setBusy] = useState<Busy>("scan");
  const [scanned, setScanned] = useState(false);
  const [test, setTest] = useState<{ key: AiProvider["key"]; ok: boolean; message: string } | null>(null);
  const userPicked = useRef(false);

  async function scan() {
    setBusy("scan");
    try {
      const next = await jobCentral().detectAiProviders();
      setData(next);
      if (!userPicked.current) setChoice(initialChoice(next));
    } finally {
      setScanned(true);
      setBusy(null);
    }
  }

  useEffect(() => {
    void scan();
  }, []);

  function pick(key: AiProvider["key"]) {
    userPicked.current = true;
    setChoice(key);
    setTest(null);
  }

  function installAgy() {
    setBusy("install");
    void run(isDe ? "KI-Engine wird installiert" : "Installing AI engine", async () => {
      const next = await jobCentral().installCli("agy");
      setData(next);
      if (next.aiProviders.find((provider) => provider.key === "agy")?.detected) pick("agy");
      return next;
    }).finally(() => setBusy(null));
  }

  function testChoice() {
    if (!choice) return;
    setBusy("test");
    void run(isDe ? "Engine wird getestet" : "Testing engine", async () => {
      const result = await jobCentral().testCli(choice);
      setTest({ key: choice, ...result });
      return result;
    }, (result) => result.ok ? (isDe ? "Verbunden!" : "Connected!") : (isDe ? "Noch nicht verbunden" : "Not connected yet")).finally(() => setBusy(null));
  }

  const chosen = engines.find((provider) => provider.key === choice && provider.detected);
  const foundCount = engines.filter((provider) => provider.detected).length;

  return (
    <div className="engine-setup engine-pick">
      <div className="engine-pick-status" role="status" aria-live="polite">
        {busy === "scan"
          ? <><Loader2 size={15} className="spin" /> {isDe ? "Suche KI-Engines auf deinem Mac…" : "Scanning your Mac for AI engines…"}</>
          : scanned
            ? <><Check size={15} className="engine-step-ok" /> {isDe ? `${foundCount} gefunden — wähle eine Engine` : `Found ${foundCount} — choose an engine`}</>
            : null}
      </div>

      <div className="engine-pick-list" role="radiogroup" aria-label={isDe ? "KI-Engine" : "AI engine"}>
        {engines.map((provider) => {
          const isAgy = provider.key === "agy";
          return (
            <div key={provider.key} className={`engine-pick-row${provider.detected ? "" : " missing"}${choice === provider.key ? " chosen" : ""}`}>
              <label>
                <input
                  type="radio"
                  name="engine-choice"
                  checked={choice === provider.key}
                  disabled={!provider.detected || busy === "scan"}
                  onChange={() => pick(provider.key)}
                />
                <strong>{provider.label}</strong>
              </label>
              <span className={`engine-badge ${provider.detected ? "ok" : "missing"}`}>
                {provider.detected
                  ? `${isDe ? "Gefunden" : "Found"}${provider.version ? ` · ${provider.version}` : ""}`
                  : isDe ? "Nicht installiert" : "Not installed"}
              </span>
              {isAgy && !provider.detected ? (
                <div className="engine-pick-extra">
                  <span>{isDe ? "Einfachster Weg: Googles Engine, nutzt dein Google-Konto. Kein Node oder Homebrew nötig." : "Easiest option: Google's engine, uses your Google account. No Node or Homebrew needed."}</span>
                  {busy === "install"
                    ? <span className="engine-working"><Loader2 size={16} className="spin" /> {isDe ? "Installiere…" : "Installing…"}</span>
                    : <button className="primary small" disabled={busy !== null} onClick={installAgy}><Download size={15} /> {isDe ? "Installieren — 1 Klick" : "Install — 1 click"}</button>}
                </div>
              ) : null}
              {isAgy && provider.detected && choice === "agy" && !(test?.key === "agy" && test.ok) ? (
                <div className="engine-pick-extra">
                  <span>{isDe ? "Erstes Mal? Mit Google anmelden, dann testen." : "First time? Sign in with Google, then test."}</span>
                  <button className="secondary small" onClick={() => run(isDe ? "Anmeldung wird geöffnet" : "Opening sign-in", async () => {
                    await jobCentral().loginCli("agy");
                    return undefined;
                  })}><ExternalLink size={15} /> {isDe ? "Anmelden" : "Sign in"}</button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {test && test.key === choice ? <p className={`engine-pick-test ${test.ok ? "ok" : "fail"}`}>{test.message}</p> : null}

      <div className="engine-pick-actions">
        <button className="secondary small" disabled={busy !== null} onClick={() => void scan()}><RefreshCw size={15} /> {isDe ? "Neu scannen" : "Rescan"}</button>
        <span />
        {busy === "test"
          ? <span className="engine-working"><Loader2 size={16} className="spin" /> {isDe ? "Teste…" : "Testing…"}</span>
          : <button className="secondary small" disabled={!chosen || busy !== null} onClick={testChoice}><Sparkles size={15} /> {isDe ? "Testen" : "Test"}</button>}
        <button className="primary small" disabled={!chosen || busy === "scan" || busy === "install"} onClick={() => onContinue(chosen?.key)}>
          <Check size={15} /> {chosen ? (isDe ? `${chosen.label} nutzen & weiter` : `Use ${chosen.label} & continue`) : (isDe ? "Weiter" : "Continue")}
        </button>
      </div>
    </div>
  );
}
