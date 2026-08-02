/**
 * Durable StorageLike for Node daemon (replaces missing localStorage).
 * Files live under ~/Library/Application Support/Fluxa/memory/
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function defaultMemoryDir(): string {
  return (
    process.env.FLUXA_MEMORY_DIR?.trim() ||
    join(homedir(), "Library", "Application Support", "Fluxa", "memory")
  );
}

function safeFileName(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]+/g, "_") + ".json";
}

export function createFileStorage(dir = defaultMemoryDir()): StorageLike {
  mkdirSync(dir, { recursive: true });
  return {
    getItem(key: string): string | null {
      const path = join(dir, safeFileName(key));
      try {
        if (!existsSync(path)) return null;
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    setItem(key: string, value: string): void {
      const path = join(dir, safeFileName(key));
      const tmp = `${path}.${process.pid}.tmp`;
      try {
        writeFileSync(tmp, value, "utf8");
        renameSync(tmp, path);
      } catch {
        try {
          writeFileSync(path, value, "utf8");
        } catch {
          /* */
        }
        try {
          if (existsSync(tmp)) unlinkSync(tmp);
        } catch {
          /* */
        }
      }
    },
    removeItem(key: string): void {
      const path = join(dir, safeFileName(key));
      try {
        if (existsSync(path)) unlinkSync(path);
      } catch {
        /* */
      }
    },
  };
}
