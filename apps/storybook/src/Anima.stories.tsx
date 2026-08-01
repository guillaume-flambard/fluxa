import type { Meta, StoryObj } from "@storybook/react";
import { FluxaProvider, useAnima } from "@fluxa/react";

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
      <span style={{ width: 72, opacity: 0.65 }}>{label}</span>
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

function AnimaPanel() {
  const { lifecycle, expressVisceral, phase } = useAnima();

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
        width: 300,
      }}
    >
      <div style={{ letterSpacing: "0.12em", opacity: 0.5, marginBottom: 6 }}>
        ANIMA CORE
      </div>
      <div
        style={{
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 8,
        }}
      >
        phase {phase} · {lifecycle.mode}
      </div>
      <Row label="Ia" value={lifecycle.autonomyIndex} />
      <Row label="affinity" value={lifecycle.affinity} />
      <Row label="stress" value={lifecycle.stress} />
      <Row label="energy" value={lifecycle.energy} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
        <button
          type="button"
          onClick={() => expressVisceral({ phase: "symbiosis" })}
        >
          Phase I Symbiosis
        </button>
        <button
          type="button"
          onClick={() => expressVisceral({ phase: "friction" })}
        >
          Phase II Friction
        </button>
        <button
          type="button"
          onClick={() => expressVisceral({ phase: "dream" })}
        >
          Phase III Dream
        </button>
        <button
          type="button"
          onClick={() =>
            expressVisceral({
              phase: "symbiosis",
              stress: 0.1,
              energy: 0.7,
              affinity: 0.55,
              hasErrors: false,
            })
          }
        >
          Reset
        </button>
      </div>
      <p style={{ marginTop: 10, opacity: 0.5, lineHeight: 1.35, marginBottom: 0 }}>
        Move cursor for Filament. Buttons push expressVisceral into the body.
      </p>
    </div>
  );
}

function AnimaStory({ idleThresholdSec }: { idleThresholdSec: number }) {
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
            autonomyClimbPerSec: 0.14,
            autonomousIntervalSec: 3,
          },
        }}
      >
        <AnimaPanel />
      </FluxaProvider>
    </div>
  );
}

const meta = {
  title: "Anima/Phases",
  component: AnimaStory,
  args: {
    idleThresholdSec: 8,
  },
  argTypes: {
    idleThresholdSec: {
      control: { type: "range", min: 2, max: 30, step: 1 },
    },
  },
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof AnimaStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ThreeBeings: Story = {
  name: "Three beings",
  args: { idleThresholdSec: 8 },
};

export const FastDream: Story = {
  name: "Fast dream climb",
  args: { idleThresholdSec: 3 },
};
