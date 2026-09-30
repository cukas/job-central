import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AiPlan, AiProvider } from "../../shared/types.js";
import { resolveCliEnv } from "./ai.js";

let aiRunQueue: Promise<unknown> = Promise.resolve();
let aiQueueDepth = 0;
const maxAiQueueDepth = 8;
// Agentic CLIs do live web browsing + multiple tool rounds, so runs vary widely
// (often 1-2 min, sometimes longer). 7 min gives agy room to finish instead of
// being killed mid-search; faster CLIs return well before this.
const RUN_TIMEOUT_MS = 420000;

// agy (Antigravity) is an agentic IDE CLI: left to itself in print mode it writes
// the answer to artifact FILES, asks clarifying questions, and runs many tool
// rounds — which both blows past the timeout and returns prose the app can't
// parse. This preamble forces a single-pass, inline, plain-text answer.
const AGY_PREAMBLE =
  "OUTPUT RULES (important): Reply with your COMPLETE final answer as plain text in THIS response only. " +
  "Do NOT create, write, edit, or reference any files or artifacts. " +
  "Do NOT ask clarifying questions — make reasonable assumptions and proceed. " +
  "Do NOT use slash commands or start an interactive session. " +
  "Do all the work in a single pass and output the final result directly as text now.\n\n";

// The CLIs (gemini, codex, claude) are coding AGENTS: if spawned inside a real
// project they explore files and plan changes, making many model calls per run
// and producing irrelevant output. We run them in an isolated EMPTY directory so
// they simply answer the prompt (which already carries all needed context).
const AI_SANDBOX_DIR = path.join(os.tmpdir(), "job-central-ai-sandbox");
function ensureSandbox() {
  try {
    mkdirSync(AI_SANDBOX_DIR, { recursive: true });
  } catch {
    // best-effort; spawn will fall back to inheriting cwd if this fails
  }
  return AI_SANDBOX_DIR;
}

export type AiChunkSink = (text: string, kind: "stdout" | "stderr") => void;

function modelArgs(provider: AiProvider, plan: AiPlan) {
  const modelId = plan.modelId ?? provider.selectedModel;
  return provider.modelFlag && modelId ? [provider.modelFlag, modelId] : [];
}

function argsFor(provider: AiProvider, plan: AiPlan, includeModel: boolean) {
  const prompt = plan.prompt;
  const selectedModel = includeModel ? modelArgs(provider, plan) : [];
  if (provider.key === "claude") return [...selectedModel, "-p", prompt];
  if (provider.key === "gemini") return ["-p", prompt, ...selectedModel];
  if (provider.key === "codex") return ["exec", ...selectedModel, prompt];
  if (provider.key === "opencode") return ["run", ...selectedModel, prompt];
  // Give agy its own print-timeout just under our SIGKILL so it returns whatever
  // it has rather than being hard-killed, and wrap the prompt to keep it inline.
  if (provider.key === "agy") return ["--print-timeout", "400s", "-p", AGY_PREAMBLE + prompt];
  return [prompt];
}

// Run the CLI as a spawned process so stdout/stderr can be streamed live to the
// UI as it is produced, instead of only returning the buffered result at the end.
function spawnOnce(command: string, args: string[], env: NodeJS.ProcessEnv, onChunk?: AiChunkSink): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const runEnv = { ...env, GEMINI_CLI_TRUST_WORKSPACE: "true" };
    // stdin = "ignore" (no open pipe). agy blocks at 0% CPU waiting for stdin EOF
    // if it inherits an open pipe; this is the equivalent of running it with
    // `< /dev/null`, so it proceeds straight to answering the prompt.
    const child = spawn(command, args, { env: runEnv, cwd: ensureSandbox(), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const limit = 1024 * 1024 * 8;

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`AI run timed out after ${Math.round(RUN_TIMEOUT_MS / 1000)}s.`));
    }, RUN_TIMEOUT_MS);

    child.stdout?.on("data", (data: Buffer) => {
      const text = data.toString();
      if (stdout.length < limit) stdout += text;
      onChunk?.(text, "stdout");
    });
    child.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      if (stderr.length < limit) stderr += text;
      onChunk?.(text, "stderr");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve([stdout, stderr].filter(Boolean).join("\n").trim());
      } else {
        reject(new Error(stderr.trim() || stdout.trim() || `${command} exited with code ${code ?? "unknown"}.`));
      }
    });
  });
}

// Only a genuine "unknown model" failure should trigger the no-model retry.
// Quota, rate-limit, auth, and timeout errors must NOT retry, or we would double
// the model usage on exactly the failures where that is most harmful.
function isUnknownModelError(message: string) {
  const m = message.toLowerCase();
  if (/quota|rate.?limit|\b429\b|exhaust|too many requests|unauthor|forbidden|api key|timed out|timeout|resource_exhausted/.test(m)) {
    return false;
  }
  return /model/.test(m) && /(not found|unknown|unsupported|invalid|does not exist|not available|no such|unrecognized)/.test(m);
}

export async function runAiPlanWithProvider(provider: AiProvider, plan: AiPlan, onChunk?: AiChunkSink) {
  if (!provider.detected) {
    throw new Error(`${provider.label} is not detected. Choose another CLI or run detection again.`);
  }
  if (aiQueueDepth >= maxAiQueueDepth) {
    throw new Error("Too many AI runs are queued. Wait for the current runs to finish.");
  }

  // Augmented PATH (resolved from the login shell) so Homebrew/local CLIs resolve.
  const env = await resolveCliEnv();
  const hasModelFlag = modelArgs(provider, plan).length > 0;

  // Serialize runs through a depth-capped queue so the app never hammers the CLI.
  aiQueueDepth += 1;
  const run = aiRunQueue.then(async () => {
    try {
      return await spawnOnce(provider.command, argsFor(provider, plan, true), env, onChunk);
    } catch (error) {
      // Retry without the explicit model ONLY for an unknown-model error — never
      // for quota/rate-limit/auth/timeout, so we never double the usage there.
      const message = error instanceof Error ? error.message : String(error);
      if (!hasModelFlag || !isUnknownModelError(message)) throw error;
      onChunk?.("\n[retrying without explicit model]\n", "stderr");
      return await spawnOnce(provider.command, argsFor(provider, plan, false), env, onChunk);
    }
  });
  aiRunQueue = run.catch(() => undefined);
  try {
    return await run;
  } finally {
    aiQueueDepth -= 1;
    if (aiQueueDepth === 0) aiRunQueue = Promise.resolve();
  }
}
