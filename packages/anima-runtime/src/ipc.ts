/**
 * UNIX socket JSONL hub — soma / clients subscribe to visceral + chat lines.
 * Inbound (soma → daemon): user_message.
 */
import {
  createServer,
  type Server,
  type Socket,
} from "node:net";
import { mkdirSync, unlinkSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_SOCK = join(
  homedir(),
  "Library",
  "Application Support",
  "Fluxa",
  "anima.sock",
);

export interface VisceralSnapshot {
  type?: "visceral";
  ts: number;
  thought: string;
  action: string;
  reason: string;
  source: string;
  desires: {
    silence: number;
    speak: number;
    create: number;
  };
  visceral?: {
    stress: number;
    energy: number;
    affinity: number;
  };
  note?: string;
}

export interface ChatLine {
  type: "line";
  ts: number;
  role: "anima" | "human" | "system";
  text: string;
  action?: string;
  inner?: string;
  /** "reply" = direct answer to the human; "pulse" = autonomous thought, dimmed. */
  kind?: "reply" | "pulse";
}

export type OutboundMessage = VisceralSnapshot | ChatLine;

export interface UserMessageInbound {
  type: "user_message";
  text: string;
}

export type InboundMessage = UserMessageInbound | { type: string; [k: string]: unknown };

export type InboundHandler = (msg: InboundMessage, sock: Socket) => void;

export class AnimaIpcHub {
  private server: Server | null = null;
  private clients = new Set<Socket>();
  private inboundHandler: InboundHandler | null = null;
  readonly path: string;

  constructor(path = process.env.FLUXA_IPC_SOCK ?? DEFAULT_SOCK) {
    this.path = path;
  }

  onInbound(handler: InboundHandler): void {
    this.inboundHandler = handler;
  }

  async listen(): Promise<void> {
    mkdirSync(dirname(this.path), { recursive: true });
    if (existsSync(this.path)) {
      try {
        unlinkSync(this.path);
      } catch {
        /* */
      }
    }
    this.server = createServer((sock) => {
      this.clients.add(sock);
      sock.setEncoding("utf8");
      let buf = "";
      sock.on("data", (chunk: string | Buffer) => {
        buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          try {
            const msg = JSON.parse(line) as InboundMessage;
            this.inboundHandler?.(msg, sock);
          } catch {
            /* ignore bad JSON */
          }
        }
      });
      sock.on("close", () => this.clients.delete(sock));
      sock.on("error", () => this.clients.delete(sock));
      this.writeSock(sock, {
        type: "line",
        ts: Date.now(),
        role: "system",
        text: "Canal ouvert. Ecris-moi ici; je m'ecris aussi quand je choisis de parler ou de penser.",
      });
      this.writeSock(sock, {
        type: "visceral",
        ts: Date.now(),
        thought: "canal ouvert",
        action: "think",
        reason: "hello",
        source: "ipc",
        desires: { silence: 0.5, speak: 0.2, create: 0.2 },
        note: "fluxa anima.sock",
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.path, () => resolve());
      this.server!.on("error", reject);
    });
    console.log(`[ipc] listening ${this.path}`);
  }

  private writeSock(sock: Socket, msg: OutboundMessage): void {
    try {
      sock.write(JSON.stringify(msg) + "\n");
    } catch {
      this.clients.delete(sock);
    }
  }

  broadcast(snap: VisceralSnapshot): void {
    const payload: VisceralSnapshot = { type: "visceral", ...snap };
    for (const c of this.clients) this.writeSock(c, payload);
  }

  broadcastLine(line: Omit<ChatLine, "type" | "ts"> & { ts?: number }): void {
    const payload: ChatLine = {
      type: "line",
      ts: line.ts ?? Date.now(),
      role: line.role,
      text: line.text,
      ...(line.action ? { action: line.action } : {}),
      ...(line.inner ? { inner: line.inner } : {}),
      ...(line.kind ? { kind: line.kind } : {}),
    };
    for (const c of this.clients) this.writeSock(c, payload);
  }

  close(): void {
    for (const c of this.clients) c.destroy();
    this.clients.clear();
    this.server?.close();
    try {
      if (existsSync(this.path)) unlinkSync(this.path);
    } catch {
      /* */
    }
  }
}
