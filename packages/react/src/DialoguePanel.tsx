import {
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type FormEvent,
} from "react";
import type { AnimaLocusSnapshot } from "@fluxa/core";
import { useChannels, useFluxa } from "./FluxaProvider.js";
import { useDialogue } from "./useDialogue.js";

const IDLE_LOCUS: AnimaLocusSnapshot = {
  x: 0.5,
  y: 0.5,
  radius: 0.1,
  presenceGain: 1,
};

/** Anima UV locus for positioning living speech on the membrane. */
export function useAnimaLocus(): AnimaLocusSnapshot {
  const { engine } = useFluxa();
  return useSyncExternalStore(
    (onStoreChange) => {
      if (!engine) return () => undefined;
      return engine.animaLocus.subscribe(onStoreChange);
    },
    () => engine?.animaLocus.getSnapshot() ?? IDLE_LOCUS,
    () => IDLE_LOCUS,
  );
}

/**
 * Speak with the living visual entity: text blooms from Anima, not a chat box.
 */
export function LivingConversation() {
  const locus = useAnimaLocus();
  const channels = useChannels();
  const { expressVisceral, engine } = useFluxa();
  const { messages, sending, streamingText, learningStats, send, resetMemory } =
    useDialogue();
  const [draft, setDraft] = useState("");

  const lastAssistant =
    streamingText ||
    [...messages].reverse().find((m) => m.role === "assistant")?.text ||
    "";
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.text;

  const left = `${locus.x * 100}%`;
  const top = `${(1 - locus.y) * 100}%`;
  const presence =
    locus.presenceGain * (channels.presence === "absent" ? 0.35 : 1);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const t = draft.trim();
    if (!t) return;
    setDraft("");
    expressVisceral({ phase: "symbiosis" });
    const snap = engine?.animaLocus.getSnapshot();
    if (snap) {
      engine?.pushInk(snap.x, snap.y);
      engine?.pushInk(snap.x + 0.02, snap.y - 0.01);
    }
    void send(t);
  };

  const speechStyle: CSSProperties = {
    position: "absolute",
    left,
    top,
    transform: "translate(-50%, calc(-100% - 28px))",
    maxWidth: "min(420px, 70vw)",
    textAlign: "center",
    pointerEvents: "none",
    color: `rgba(200, 245, 235, ${0.35 + 0.55 * presence})`,
    fontFamily: "Georgia, 'Times New Roman', serif",
    fontSize: "clamp(15px, 2.1vw, 22px)",
    lineHeight: 1.45,
    textShadow:
      "0 0 24px rgba(40, 180, 160, 0.45), 0 2px 12px rgba(0,0,0,0.6)",
    transition: "left 0.12s linear, top 0.12s linear, opacity 0.4s ease",
    opacity: lastAssistant ? presence : 0.45,
    zIndex: 3,
  };

  const userEchoStyle: CSSProperties = {
    position: "absolute",
    left,
    top,
    transform: "translate(-50%, 36px)",
    maxWidth: "min(360px, 60vw)",
    textAlign: "center",
    pointerEvents: "none",
    color: `rgba(180, 210, 255, ${0.25 + 0.4 * presence})`,
    fontFamily: "ui-monospace, Menlo, monospace",
    fontSize: 12,
    lineHeight: 1.35,
    opacity: lastUser ? 0.85 : 0,
    transition: "opacity 0.5s ease",
    zIndex: 3,
  };

  return (
    <>
      <div style={speechStyle} aria-live="polite">
        {lastAssistant ||
          (learningStats.turnCount === 0 ? "Je suis la. Parle-moi." : "...")}
      </div>
      {lastUser ? <div style={userEchoStyle}>toi : {lastUser}</div> : null}

      <form
        onSubmit={onSubmit}
        style={{
          position: "absolute",
          left: "50%",
          bottom: 28,
          transform: "translateX(-50%)",
          width: "min(480px, 88vw)",
          zIndex: 4,
          pointerEvents: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          alignItems: "stretch",
        }}
      >
        <input
          value={draft}
          disabled={sending}
          placeholder="parle a Anima..."
          autoFocus
          onChange={(e) => {
            const next = e.target.value;
            if (next.length > draft.length) {
              engine?.recordLanguageInput(1);
            }
            setDraft(next);
          }}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "14px 18px",
            background: "rgba(2, 10, 16, 0.25)",
            border: "none",
            borderBottom: "1px solid rgba(120, 220, 200, 0.35)",
            color: "#e8fff8",
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontSize: 16,
            outline: "none",
            textAlign: "center",
            backdropFilter: "blur(6px)",
          }}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            opacity: 0.4,
            fontSize: 10,
            fontFamily: "ui-monospace, Menlo, monospace",
            color: "#c8e8e4",
          }}
        >
          <span>
            {learningStats.motifCount} motifs · {learningStats.turnCount} tours
          </span>
          <button
            type="button"
            onClick={resetMemory}
            style={{
              background: "none",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              fontSize: 10,
            }}
          >
            oublier
          </button>
        </div>
      </form>
    </>
  );
}

/** Alias: chat chrome replaced by living speech at Anima. */
export function DialoguePanel() {
  return <LivingConversation />;
}
