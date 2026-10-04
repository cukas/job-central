import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import type { AiProvider } from "../../shared/types.js";

const execFileAsync = promisify(execFile);

let cachedEnv: NodeJS.ProcessEnv | undefined;

/**
 * GUI-launched Electron apps inherit only a minimal PATH, and a plain `sh -lc`
 * does not load the user's `~/.zshrc`. As a result CLIs installed in Homebrew,
 * `~/.local/bin`, `~/.opencode/bin`, etc. are invisible. We resolve the real
 * PATH from the user's login+interactive shell and merge in the common bin
 * directories, then reuse that environment for detection and for running CLIs.
 */
export async function resolveCliEnv(): Promise<NodeJS.ProcessEnv> {
  if (cachedEnv) return cachedEnv;
  const base = process.env;
  const home = base.HOME ?? os.homedir();
  const commonDirs = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
    `${home}/.local/bin`,
    `${home}/.claude/local`,
    `${home}/.codex/bin`,
    `${home}/.opencode/bin`,
    `${home}/.bun/bin`,
    `${home}/.cargo/bin`,
    `${home}/.deno/bin`,
    `${home}/.volta/bin`,
    `${home}/.npm-global/bin`,
    `${home}/go/bin`,
  ];

  let shellPath = "";
  try {
    const shell = base.SHELL || "/bin/zsh";
    // -l (login) + -i (interactive) so zsh sources ~/.zshrc where PATH is set.
    const { stdout } = await execFileAsync(shell, ["-lic", "printf %s \"$PATH\""], {
      timeout: 6000,
      env: base,
    });
    shellPath = stdout.trim();
  } catch {
    // Fall back to the merged common dirs below.
  }

  const seen = new Set<string>();
  const merged = [shellPath, base.PATH ?? "", ...commonDirs]
    .flatMap((entry) => entry.split(":"))
    .map((entry) => entry.trim())
    .filter((entry) => entry && !seen.has(entry) && seen.add(entry))
    .join(":");

  cachedEnv = { ...base, PATH: merged };
  return cachedEnv;
}

async function detectCommand(command: string, env: NodeJS.ProcessEnv): Promise<{ detected: boolean; version?: string }> {
  try {
    const which = await execFileAsync("/bin/sh", ["-c", `command -v ${command}`], { timeout: 4000, env });
    if (!which.stdout.trim()) return { detected: false };

    try {
      const version = await execFileAsync(command, ["--version"], { timeout: 5000, env });
      return { detected: true, version: (version.stdout || version.stderr).trim().split("\n")[0] };
    } catch {
      return { detected: true };
    }
  } catch {
    return { detected: false };
  }
}

export async function detectAiProviders(providers: AiProvider[]): Promise<AiProvider[]> {
  const env = await resolveCliEnv();
  const detected = await Promise.all(
    providers.map(async (provider) => {
      if (provider.key === "custom") return provider;
      const result = await detectCommand(provider.command, env);
      return {
        ...provider,
        detected: result.detected,
        version: result.version,
      };
    }),
  );

  return detected;
}

