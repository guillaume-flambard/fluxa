import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { FluxaProvider, useFluxa, useLifecycle } from "@fluxa/react";

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

function MembraneMeters({ idleThresholdSec }: { idleThresholdSec: number }) {
  const life = useLifecycle();
  const { engine } = useFluxa();
  const [hasErrors, setHasErrors] = useState(false);

  // Seed affinity so Filament glows and Anima can drift toward the cursor
  useEffect(() => {
    engine?.applyVisceral({ affinity_level: 0.75 });
  }, [engine]);

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
        width: 280,
      }}
    >
      <div style={{ letterSpacing: "0.12em", opacity: 0.5, marginBottom: 6 }}>
        MEMBRANE
      </div>
      <div style={{ textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
        {life.mode}
      </div>
      <Row label="Ia" value={life.autonomyIndex} />
      <Row label="affinity" value={life.affinity} />
      <Row label="stress" value={life.stress} />
      <Row label="energy" value={life.energy} />
      <div style={{ marginTop: 6, opacity: 0.55 }}>
        idle {life.idleSeconds.toFixed(1)}s / {idleThresholdSec}s
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
        <button
          type="button"
          onClick={() => {
            engine?.forceIdleForTesting();
          }}
        >
          Force idle
        </button>
        <button
          type="button"
          onClick={() => {
            engine?.recordHumanActivity(0.6);
            engine?.wake();
          }}
        >
          Human return
        </button>
        <button
          type="button"
          onClick={() => {
            const next = !hasErrors;
            setHasErrors(next);
            engine?.reportCodeHealth({ hasErrors: next });
          }}
        >
          {hasErrors ? "Clear errors" : "Inject errors"}
        </button>
      </div>
      <p style={{ marginTop: 10, opacity: 0.5, lineHeight: 1.35, marginBottom: 0 }}>
        Move cursor: Filament stretches to Anima. Idle → violet dream. Errors →
        amber/red.
      </p>
    </div>
  );
}

function MembraneStory({ idleThresholdSec }: { idleThresholdSec: number }) {
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
        }}
      >
        <MembraneMeters idleThresholdSec={idleThresholdSec} />
      </FluxaProvider>
    </div>
  );
}

const meta = {
  title: "Membrane/Symbiotic",
  component: MembraneStory,
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
} satisfies Meta<typeof MembraneStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LivingMembrane: Story = {
  name: "Living membrane",
  args: { idleThresholdSec: 8 },
};

export const FastDream: Story = {
  name: "Fast dream",
  args: { idleThresholdSec: 3 },
};
