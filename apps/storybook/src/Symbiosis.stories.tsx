import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import {
  DialoguePanel,
  FluxaProvider,
  useAnima,
  useChannels,
  useFluxa,
} from "@fluxa/react";

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
      <span style={{ width: 80, opacity: 0.65 }}>{label}</span>
      <div
        style={{
          flex: 1,
          height: 6,
          background: "rgba(255,255,255,0.06)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`,
            height: "100%",
            background: "linear-gradient(90deg,#1a8a7a,#7b5cff)",
          }}
        />
      </div>
      <span style={{ width: 36, textAlign: "right", opacity: 0.8 }}>
        {value.toFixed(2)}
      </span>
    </div>
  );
}

function LivingPanel() {
  const { lifecycle, expressVisceral, phase } = useAnima();
  const channels = useChannels();
  const { forceSilence, recordLanguageInput } = useFluxa();
  const [draft, setDraft] = useState("");

  return (
    <div
      style={{
        position: "absolute",
        left: 16,
        top: 16,
        zIndex: 2,
        pointerEvents: "auto",
        color: "#c8e8e4",
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: 11,
        background: "rgba(2,8,14,0.55)",
        padding: 12,
        width: 320,
      }}
    >
      <div style={{ letterSpacing: "0.12em", opacity: 0.5, marginBottom: 6 }}>
        SYMBIOSIS / LIVING
      </div>
      <div style={{ marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>
        phase {phase} · presence {channels.presence} · channel {channels.active}
      </div>
      <Row label="language" value={channels.languageIntensity} />
      <Row label="proximics" value={channels.proximicsIntensity} />
      <Row label="visual" value={channels.visualIntensity} />
      <Row
        label="silence"
        value={Math.min(1, channels.silenceSeconds / 4)}
      />
      <Row label="presence" value={channels.presenceGain} />
      <Row label="Ia" value={lifecycle.autonomyIndex} />
      <Row label="affinity" value={lifecycle.affinity} />

      <input
        type="text"
        value={draft}
        placeholder="type = language channel"
        onChange={(e) => {
          const next = e.target.value;
          const delta = Math.max(0, next.length - draft.length);
          setDraft(next);
          if (delta > 0) recordLanguageInput(delta);
        }}
        style={{
          marginTop: 10,
          width: "100%",
          boxSizing: "border-box",
          padding: "6px 8px",
          background: "rgba(0,0,0,0.35)",
          border: "1px solid rgba(120,200,180,0.35)",
          color: "#e8fff8",
          fontFamily: "inherit",
          fontSize: 11,
        }}
      />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
        <button
          type="button"
          onClick={() => expressVisceral({ phase: "symbiosis" })}
        >
          Phase I
        </button>
        <button
          type="button"
          onClick={() => expressVisceral({ phase: "friction" })}
        >
          Phase II friction
        </button>
        <button
          type="button"
          onClick={() => expressVisceral({ phase: "dream" })}
        >
          Phase III dream
        </button>
        <button type="button" onClick={() => forceSilence()}>
          Force silence
        </button>
      </div>
      <p style={{ marginTop: 10, opacity: 0.5, lineHeight: 1.35, marginBottom: 0 }}>
        Drag to paint visual ink (gesture light). Type for language. Presence
        couples only while the link signals.
      </p>
    </div>
  );
}

function LivingStory({ idleThresholdSec }: { idleThresholdSec: number }) {
  return (
    <div style={{ width: "100vw", height: "100vh", background: "#010507" }}>
      <FluxaProvider
        key={idleThresholdSec}
        engineOptions={{
          resolution: 384,
          waveSpeed2: 0.28,
          gamma: 0.02,
          baseColor: [0.04, 0.14, 0.18],
          highlight: [0.35, 0.85, 0.78],
          warmColor: [0.78, 0.3, 0.28],
          lifecycle: {
            idleThresholdSec,
            autonomyClimbPerSec: 0.12,
            autonomousIntervalSec: 3,
          },
          channels: { silenceThresholdSec: 2.5 },
        }}
      >
        <LivingPanel />
        <DialoguePanel />
      </FluxaProvider>
    </div>
  );
}

const meta = {
  title: "Symbiosis/Living",
  component: LivingStory,
  args: { idleThresholdSec: 8 },
  argTypes: {
    idleThresholdSec: {
      control: { type: "range", min: 2, max: 30, step: 1 },
    },
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof LivingStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LivingLink: Story = {
  name: "Living link",
  args: { idleThresholdSec: 8 },
};
