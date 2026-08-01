import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { FluxaProvider, useFluxa, useLifecycle } from "@fluxa/react";

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
      <span style={{ width: 88, opacity: 0.7 }}>{label}</span>
      <div
        style={{
          flex: 1,
          height: 7,
          background: "rgba(255,255,255,0.08)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`,
            height: "100%",
            background: "linear-gradient(90deg,#7b5cff,#c4a1ff)",
          }}
        />
      </div>
      <span style={{ width: 40, textAlign: "right" }}>{value.toFixed(2)}</span>
    </div>
  );
}

function LifecyclePanel({ idleThresholdSec }: { idleThresholdSec: number }) {
  const life = useLifecycle();
  const { engine } = useFluxa();
  const [hasErrors, setHasErrors] = useState(false);

  return (
    <div
      style={{
        position: "absolute",
        left: 24,
        top: 24,
        zIndex: 2,
        pointerEvents: "auto",
        color: "#e8f1ff",
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: 12,
        background: "rgba(4,12,24,0.72)",
        border: "1px solid rgba(180,160,255,0.35)",
        padding: 16,
        width: 320,
      }}
    >
      <div style={{ letterSpacing: "0.14em", opacity: 0.55, marginBottom: 8 }}>
        LIFECYCLE
      </div>
      <div
        style={{
          display: "inline-block",
          padding: "4px 10px",
          marginBottom: 10,
          background:
            life.mode === "dream"
              ? "rgba(120,80,255,0.35)"
              : life.mode === "symbiosis"
                ? "rgba(80,160,255,0.25)"
                : "rgba(255,255,255,0.08)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        {life.mode}
      </div>
      <Row label="Ia autonomy" value={life.autonomyIndex} />
      <Row label="affinity" value={life.affinity} />
      <Row label="stress" value={life.stress} />
      <Row label="energy" value={life.energy} />
      <div style={{ marginTop: 8, opacity: 0.65 }}>
        idle {life.idleSeconds.toFixed(1)}s / {idleThresholdSec}s · agent ticks{" "}
        {life.autonomousTicks}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
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
      <p style={{ marginTop: 12, opacity: 0.55, lineHeight: 1.4 }}>
        Leave the canvas alone (or Force idle) to climb Ia into dream. Ethereal
        violet mixes in via u_autonomy. Move/click to return to symbiosis.
      </p>
    </div>
  );
}

function LifecycleStory({
  idleThresholdSec,
}: {
  idleThresholdSec: number;
}) {
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <FluxaProvider
        key={idleThresholdSec}
        engineOptions={{
          resolution: 384,
          waveSpeed2: 0.28,
          gamma: 0.02,
          warmColor: [0.78, 0.3, 0.28],
          lifecycle: {
            idleThresholdSec,
            autonomyClimbPerSec: 0.12,
            autonomousIntervalSec: 3,
          },
        }}
      >
        <LifecyclePanel idleThresholdSec={idleThresholdSec} />
      </FluxaProvider>
    </div>
  );
}

const meta = {
  title: "Lifecycle/Autonomy",
  component: LifecycleStory,
  args: {
    idleThresholdSec: 8,
  },
  argTypes: {
    idleThresholdSec: {
      control: { type: "range", min: 2, max: 30, step: 1 },
    },
  },
} satisfies Meta<typeof LifecycleStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DreamClimb: Story = {
  name: "Dream climb",
  args: { idleThresholdSec: 8 },
};

export const FastDream: Story = {
  name: "Fast dream (demo)",
  args: { idleThresholdSec: 3 },
};
