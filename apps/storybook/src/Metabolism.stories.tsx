import type { Meta, StoryObj } from "@storybook/react";
import { FluxaProvider, useFluxa, useHomeostasis } from "@fluxa/react";

function MetabolismPanel({ burstCount }: { burstCount: number }) {
  const meta = useHomeostasis();
  const { engine } = useFluxa();

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
        fontSize: 13,
        background: "rgba(4,12,24,0.65)",
        border: "1px solid rgba(180,210,255,0.3)",
        padding: 16,
        width: 280,
      }}
    >
      <div style={{ letterSpacing: "0.14em", opacity: 0.55, marginBottom: 10 }}>
        METABOLISM
      </div>
      <Row label="stress" value={meta.stress} />
      <Row label="breath" value={(meta.breath + 1) / 2} />
      <Row label="energy" value={Math.min(1, Math.max(0, meta.energy))} />
      <div
        style={{
          marginTop: 12,
          padding: "6px 8px",
          background: meta.fatigued
            ? "rgba(255,100,80,0.25)"
            : "rgba(80,160,255,0.12)",
        }}
      >
        {meta.fatigued ? "FATIGUED" : "resting / active"}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button
          type="button"
          onClick={() => {
            engine?.homeostasis.excite(0.3);
            engine?.wake();
          }}
        >
          Poke
        </button>
        <button
          type="button"
          onClick={() => {
            for (let i = 0; i < burstCount; i++) {
              engine?.homeostasis.excite(0.28);
            }
            engine?.wake();
          }}
        >
          Burst ×{burstCount}
        </button>
      </div>
      <p style={{ marginTop: 12, opacity: 0.65, lineHeight: 1.4 }}>
        Canvas keeps breathing at rest. Clicks add cavities and raise S.
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
      <span style={{ width: 56, opacity: 0.7 }}>{label}</span>
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
            width: `${Math.round(value * 100)}%`,
            height: "100%",
            background: "linear-gradient(90deg,#4aa3ff,#ff7b6c)",
          }}
        />
      </div>
      <span style={{ width: 40, textAlign: "right" }}>{value.toFixed(2)}</span>
    </div>
  );
}

function MetabolismCanvas({
  burstCount,
  f0,
  fGain,
  lambda,
}: {
  burstCount: number;
  f0: number;
  fGain: number;
  lambda: number;
}) {
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <FluxaProvider
        key={`${f0}-${fGain}-${lambda}`}
        engineOptions={{
          resolution: 384,
          waveSpeed2: 0.28,
          gamma: 0.02,
          warmColor: [0.78, 0.3, 0.28],
          homeostasis: { f0, fGain, lambda },
        }}
      >
        <MetabolismPanel burstCount={burstCount} />
      </FluxaProvider>
    </div>
  );
}

const meta = {
  title: "Metabolism/Homeostasis",
  component: MetabolismCanvas,
  args: {
    burstCount: 8,
    f0: 0.08,
    fGain: 0.35,
    lambda: 0.85,
  },
  argTypes: {
    burstCount: { control: { type: "range", min: 1, max: 20, step: 1 } },
    f0: { control: { type: "range", min: 0.02, max: 0.25, step: 0.01 } },
    fGain: { control: { type: "range", min: 0, max: 0.8, step: 0.05 } },
    lambda: { control: { type: "range", min: 0.2, max: 2, step: 0.05 } },
  },
} satisfies Meta<typeof MetabolismCanvas>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RestingBreath: Story = {
  name: "Resting breath",
  args: { burstCount: 8, f0: 0.08, fGain: 0.35, lambda: 0.85 },
};

export const HighStrung: Story = {
  name: "High-strung",
  args: { burstCount: 12, f0: 0.12, fGain: 0.55, lambda: 0.45 },
};
