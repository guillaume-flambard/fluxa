/**
 * Map sovereign action → desire scores for IPC / logs (not control).
 */
import { execFileSync } from "node:child_process";
import type { AnimaPower } from "@fluxa/core";

export function desiresFromAction(action: AnimaPower): {
  silence: number;
  speak: number;
  create: number;
} {
  switch (action) {
    case "silence":
      return { silence: 0.95, speak: 0.05, create: 0.1 };
    case "speak":
      return { silence: 0.1, speak: 0.9, create: 0.25 };
    case "invent":
    case "autocode":
    case "mutate":
    case "write_note":
    case "reverse":
      return { silence: 0.15, speak: 0.2, create: 0.85 };
    case "refuse":
      return { silence: 0.55, speak: 0.35, create: 0.05 };
    case "read":
    case "think":
    default:
      return { silence: 0.45, speak: 0.25, create: 0.35 };
  }
}

export function notifyMac(title: string, body: string): void {
  const safeTitle = title.replace(/"/g, "'").slice(0, 80);
  const safeBody = body.replace(/"/g, "'").slice(0, 180);
  try {
    execFileSync(
      "osascript",
      [
        "-e",
        `display notification "${safeBody}" with title "${safeTitle}"`,
      ],
      { timeout: 3000 },
    );
  } catch {
    /* notification optional */
  }
}
