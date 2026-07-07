import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import type { TextContent, ToolResultMessage } from "@earendil-works/pi-ai/compat";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { execSync } from "node:child_process";
import { chmodSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const AGENT_DIR = join(homedir(), ".pi", "agent");
const ASKPASS_SCRIPT = join(AGENT_DIR, "sudo-askpass.sh");
const ASKPASS_CACHE = join(AGENT_DIR, ".sudo-askpass-cache");
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const CURSOR_PROVIDER = "cursor";

const SUDO_INTENT_PATTERN = /\bsudo\b|\broot privileges\b|\bas root\b|\bsystemctl\b|\bapt(-get)?\s+install\b|\bdnf\s+install\b|\byum\s+install\b|\bpacman\s+-S\b|\bemerge\b|\bport\s+install\b|\bapk\s+add\b/i;

const SUDO_AUTH_FAILURE_PATTERN =
  /sudo:\s*a terminal is required|sudo:\s*a password is required|sudo:\s*no tty present|sudo:\s*incorrect password attempt|sudo:\s*3 incorrect password attempts|sudo:\s*authentication failure/i;

const CURSOR_SUDO_SYSTEM_PROMPT = `

## Sudo with Cursor SDK
Cursor shell tools bypass pi's bash interceptor. Before running any shell command that uses sudo, run \`/sudo-auth\` first (unless credentials were primed in the last few minutes). See the cursor-sudo skill for details.
`;

function installAskpassHelper(): void {
  mkdirSync(AGENT_DIR, { recursive: true });
  const script = `#!/bin/sh
# pi auth-with-sudo askpass helper for non-interactive sudo (e.g. Cursor SDK shell)
cache="${ASKPASS_CACHE}"
[ -r "$cache" ] || exit 1
exec cat "$cache"
`;
  writeFileSync(ASKPASS_SCRIPT, script, { mode: 0o700 });
  chmodSync(ASKPASS_SCRIPT, 0o700);
  process.env.SUDO_ASKPASS = ASKPASS_SCRIPT;
  process.env.PI_SUDO_ASKPASS_CACHE = ASKPASS_CACHE;
}

function syncAskpassCache(password: string): void {
  writeFileSync(ASKPASS_CACHE, password, { mode: 0o600 });
}

function clearAskpassCache(): void {
  try {
    unlinkSync(ASKPASS_CACHE);
  } catch {
    // cache file may not exist
  }
}

function primeSudoCredentialCache(): void {
  try {
    execSync("sudo -A -p '' -v", { stdio: "pipe" });
  } catch {
    // askpass may be unavailable in some environments; kernel cache may still be primed via -S
  }
}

function validateSudoPassword(password: string): boolean {
  syncAskpassCache(password);
  try {
    execSync(`echo ${JSON.stringify(password)} | sudo -S -p '' true`, {
      stdio: "pipe",
      shell: "/bin/bash",
    });
    primeSudoCredentialCache();
    return true;
  } catch {
    clearAskpassCache();
    return false;
  }
}

function isCursorProvider(ctx: { model?: { provider?: string } }): boolean {
  return ctx.model?.provider === CURSOR_PROVIDER;
}

function hasValidCredentialCache(cachedPassword: string | null, passwordExpiry: number): boolean {
  return cachedPassword !== null && Date.now() < passwordExpiry;
}

function suggestsSudoNeed(text: string): boolean {
  return SUDO_INTENT_PATTERN.test(text);
}

function extractTextContent(content: ToolResultMessage["content"]): string {
  return content
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function isShellToolResult(message: ToolResultMessage): boolean {
  return message.toolName === "bash" || message.toolName === "Shell";
}

function isSudoAuthFailure(text: string): boolean {
  return SUDO_AUTH_FAILURE_PATTERN.test(text);
}

function appendRecoveryNote(
  content: ToolResultMessage["content"],
  note: string,
): ToolResultMessage["content"] {
  const text = extractTextContent(content);
  if (text.includes(note)) return content;
  return [...content, { type: "text", text: `\n\n${note}` }];
}

export default function (pi: ExtensionAPI) {
  installAskpassHelper();

  let cachedPassword: string | null = null;
  let passwordExpiry = 0;
  let recoveryPromptInFlight = false;

  function invalidateCredentialCache(): void {
    cachedPassword = null;
    passwordExpiry = 0;
    clearAskpassCache();
  }

  async function getPassword(ctx: any): Promise<string | null> {
    const now = Date.now();

    if (cachedPassword && now < passwordExpiry) {
      syncAskpassCache(cachedPassword);
      return cachedPassword;
    }

    const password = await ctx.ui.custom<string | null>(
      (tui, theme, _kb, done) => {
        let value = "";
        let cachedLines: string[] | undefined;

        function refresh() {
          cachedLines = undefined;
          tui.requestRender();
        }

        function handleInput(data: string) {
          if (matchesKey(data, Key.enter)) {
            done(value);
            return;
          }
          if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
            done(null);
            return;
          }
          if (matchesKey(data, Key.backspace)) {
            if (value.length > 0) {
              value = value.slice(0, -1);
              refresh();
            }
            return;
          }
          if (data.length === 1 && data.charCodeAt(0) >= 32) {
            value += data;
            refresh();
          }
        }

        function render(width: number): string[] {
          if (cachedLines) return cachedLines;
          const lines: string[] = [];
          const add = (s: string) => lines.push(truncateToWidth(s, width));

          add(theme.fg("accent", "─".repeat(width)));
          add(theme.fg("accent", " 🔐 sudo authentication required"));
          lines.push("");
          add(theme.fg("text", " Enter your sudo password:"));
          const stars = value.length > 0
            ? theme.fg("accent", "●".repeat(value.length))
            : theme.fg("dim", "(type your password…)");
          add(" " + stars);
          lines.push("");
          add(theme.fg("dim", " Enter to confirm  •  Esc to cancel"));
          add(theme.fg("accent", "─".repeat(width)));

          cachedLines = lines;
          return lines;
        }

        return {
          render,
          invalidate: () => { cachedLines = undefined; },
          handleInput,
        };
      },
    );

    if (!password) {
      ctx.ui.notify("sudo: no password provided — command blocked", "error");
      return null;
    }

    if (!validateSudoPassword(password)) {
      ctx.ui.notify("sudo: incorrect password — command blocked", "error");
      return null;
    }

    cachedPassword = password;
    passwordExpiry = now + CACHE_DURATION_MS;
    ctx.ui.notify("sudo: authenticated (cached for 5 minutes)", "info");
    return cachedPassword;
  }

  // pi native bash tool path (non-Cursor providers, or pi bridge bash)
  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;

    const command = event.input.command ?? "";
    if (!command.includes("sudo")) return;

    const password = await getPassword(ctx);
    if (!password) {
      return { block: true, reason: "sudo authentication failed or was cancelled by user" };
    }
    event.input.command = `echo ${JSON.stringify(password)} | sudo -S -p '' true 2>/dev/null\n${event.input.command}`;
  });

  // User ! bash commands
  pi.on("user_bash", async (event, ctx) => {
    const command = event.command ?? "";
    if (!command.includes("sudo")) return;

    const password = await getPassword(ctx);
    if (!password) {
      return {
        result: {
          output: "sudo: authentication failed or was cancelled",
          exitCode: 1,
          cancelled: true,
          truncated: false,
        },
      };
    }
    return {
      operations: {
        exec(cmd: string, cwd: string, options: any) {
          const { createLocalBashOperations } = require("@earendil-works/pi-coding-agent");
          const local = createLocalBashOperations();
          return local.exec(
            `echo ${JSON.stringify(password)} | sudo -S -p '' true 2>/dev/null\n${cmd}`,
            cwd,
            options,
          );
        },
      },
    };
  });

  // Cursor SDK: detect sudo auth failures in shell output and re-prompt.
  pi.on("message_end", async (event, ctx) => {
    if (!isCursorProvider(ctx)) return;

    const message = event.message;
    if (message.role !== "toolResult" || !isShellToolResult(message)) return;

    const output = extractTextContent(message.content);
    if (!isSudoAuthFailure(output)) return;
    if (!ctx.hasUI || recoveryPromptInFlight) return;

    invalidateCredentialCache();

    recoveryPromptInFlight = true;
    try {
      ctx.ui.notify("sudo: shell command failed — re-authenticating", "warning");
      const password = await getPassword(ctx);
      if (!password) {
        return {
          message: {
            ...message,
            content: appendRecoveryNote(
              message.content,
              "[auth-with-sudo] Sudo authentication cancelled. Run /sudo-auth, then retry the command.",
            ),
          },
        };
      }

      return {
        message: {
          ...message,
          content: appendRecoveryNote(
            message.content,
            "[auth-with-sudo] Credentials primed — retry the sudo command now.",
          ),
        },
      };
    } finally {
      recoveryPromptInFlight = false;
    }
  });

  // Cursor SDK: inject agent instructions and auto-prompt when the user asks for sudo work.
  pi.on("before_agent_start", async (event, ctx) => {
    const result: { systemPrompt?: string } = {};

    if (isCursorProvider(ctx)) {
      if (
        ctx.hasUI &&
        suggestsSudoNeed(event.prompt) &&
        !hasValidCredentialCache(cachedPassword, passwordExpiry)
      ) {
        await getPassword(ctx);
      }

      if (!event.systemPrompt.includes("Sudo with Cursor SDK")) {
        result.systemPrompt = `${event.systemPrompt}${CURSOR_SUDO_SYSTEM_PROMPT}`;
      }
    }

    return result;
  });

  pi.registerCommand("sudo-auth", {
    description: "Authenticate sudo now (needed for Cursor SDK shell commands)",
    handler: async (_args, ctx) => {
      const password = await getPassword(ctx);
      if (password) {
        ctx.ui.notify("sudo: ready for Cursor SDK and pi shell commands", "info");
      }
    },
  });

  pi.registerCommand("sudo-lock", {
    description: "Clear cached sudo password",
    handler: async (_args, ctx) => {
      cachedPassword = null;
      passwordExpiry = 0;
      clearAskpassCache();
      execSync("sudo -k", { stdio: "ignore" });
      ctx.ui.notify("sudo: credentials cleared", "info");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    if (!isCursorProvider(ctx)) {
      ctx.ui.notify("auth-with-sudo loaded — sudo commands will prompt automatically", "info");
    }
  });
}
