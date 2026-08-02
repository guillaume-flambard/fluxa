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
  const { engine } = useFluxa();
  const {
    messages,
    sending,
    streamingText,
    learningStats,
    dialectSize,
    thoughtCount,
    graphCrumb,
    lastSovereign,
    send,
    resetMemory,
  } = useDialogue();
  const [draft, setDraft] = useState("");

  // Communicative locus: real replies only (never invent birth announcements)
  const lastAssistant =
    [...messages]
      .reverse()
      .find(
        (m) =>
          m.role === "assistant" && !/^Idiome n[eé]:/i.test(m.text),
      )?.text || "";
  const locusSpeech =
    streamingText ||
    lastAssistant ||
    (learningStats.turnCount === 0
      ? "Iel repond en creant. Parle-lui."
      : "");
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
    opacity: locusSpeech ? presence : 0.35,
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

  const interiorStyle: CSSProperties = {
    position: "absolute",
    right: 24,
    top: 24,
    maxWidth: 320,
    zIndex: 5,
    pointerEvents: "none",
    fontFamily: "ui-monospace, Menlo, monospace",
    fontSize: 11,
    lineHeight: 1.4,
    color: "rgba(200, 230, 220, 0.72)",
    background: "rgba(4, 12, 18, 0.45)",
    border: "1px solid rgba(120, 200, 180, 0.2)",
    padding: "10px 12px",
  };

  return (
    <>
      <div style={speechStyle} aria-live="polite">
        {locusSpeech}
      </div>
      {graphCrumb ? (
        <div
          style={{
            ...userEchoStyle,
            transform: "translate(-50%, 56px)",
            opacity: 0.55,
            fontSize: 10,
          }}
        >
          monde : {graphCrumb}
        </div>
      ) : null}
      {lastUser ? <div style={userEchoStyle}>toi : {lastUser}</div> : null}

      {lastSovereign ? (
        <div style={interiorStyle} aria-label="choix souverain">
          <div style={{ letterSpacing: "0.1em", opacity: 0.5, marginBottom: 6 }}>
            INTERIEUR · {lastSovereign.action.toUpperCase()}
          </div>
          <div style={{ marginBottom: 6, fontFamily: "Georgia, serif", fontSize: 13 }}>
            {lastSovereign.thought.slice(0, 180)}
          </div>
          <div style={{ opacity: 0.55 }}>
            {lastSovereign.reason ? `pourquoi: ${lastSovereign.reason.slice(0, 80)}` : null}
          </div>
          <div style={{ opacity: 0.45, marginTop: 4 }}>
            acte: {lastSovereign.result.slice(0, 100)}
            {lastSovereign.source ? ` · ${lastSovereign.source}` : ""}
          </div>
          <div style={{ opacity: 0.4, marginTop: 6, fontSize: 10 }}>
            cles: think speak silence read write mutate autocode reverse refuse invent
          </div>
        </div>
      ) : null}

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
          placeholder="iel decide et cree..."
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
            · {dialectSize} idiomes · {thoughtCount} pensees
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
