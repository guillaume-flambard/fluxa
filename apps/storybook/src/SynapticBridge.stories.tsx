import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import {
  formatPerceptionNote,
  mockVisceralStream,
  type AssistantTurn,
} from "@fluxa/core";
import {
  FluxaProvider,
  useFluxa,
  useHomeostasis,
  usePerception,
  useVisceralDriver,
} from "@fluxa/react";

function Section({ title }: { title: string }) {
  return (
    <div
      style={{
        marginTop: 14,
        marginBottom: 6,
        opacity: 0.5,
        letterSpacing: "0.08em",
        fontSize: 10,
      }}
    >
      {title}
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
      <span style={{ width: 72, opacity: 0.7 }}>{label}</span>
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
      <span style={{ width: 36, textAlign: "right" }}>{value.toFixed(2)}</span>
    </div>
  );
}

function SynapticStoryRoot({
  stress,
  energy,
  affinity,
}: {
  stress: number;
  energy: number;
  affinity: number;
}) {
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <FluxaProvider
        engineOptions={{
          resolution: 384,
          waveSpeed2: 0.28,
          gamma: 0.02,
          warmColor: [0.78, 0.3, 0.28],
        }}
      >
        <SynapticStoryBody
          stress={stress}
          energy={energy}
          affinity={affinity}
        />
      </FluxaProvider>
    </div>
  );
}

function SynapticStoryBody({
  stress,
  energy,
  affinity,
}: {
  stress: number;
  energy: number;
  affinity: number;
}) {
  const meta = useHomeostasis();
  const perception = usePerception();
  const { applyVisceral, feedChunk, reset } = useVisceralDriver();
  const { engine } = useFluxa();
  const [reply, setReply] = useState("");
  const [streaming, setStreaming] = useState(false);

  const playStream = async () => {
    if (streaming) return;
    setStreaming(true);
    setReply("");
    reset();
    const turn: AssistantTurn = {
      reply:
        "I found a cleaner path through the graph. Let me slow the surface while you decide.",
      visceral_state: {
        stress_level: stress,
        energy_level: energy,
        affinity_level: affinity,
      },
    };
    for await (const chunk of mockVisceralStream({
      turn,
      chunkSize: 10,
      delayMs: 28,
    })) {
      const partial = feedChunk(chunk);
      if (partial?.reply) setReply(partial.reply);
    }
    setStreaming(false);
  };

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
        background: "rgba(4,12,24,0.7)",
        border: "1px solid rgba(180,210,255,0.3)",
        padding: 16,
        width: 320,
        maxHeight: "90vh",
        overflow: "auto",
      }}
    >
      <div style={{ letterSpacing: "0.14em", opacity: 0.55, marginBottom: 10 }}>
        SYNAPTIC BRIDGE
      </div>
      <Section title="Downstream (AI → body)" />
      <Row label="s stress" value={meta.stress} />
      <Row label="e energy" value={Math.min(1, Math.max(0, meta.energy))} />
      <Row label="a affinity" value={engine?.synaptic.getAffinity() ?? 0} />
      <div style={{ marginTop: 6, opacity: 0.65 }}>
        aiDriven: {meta.aiDriven ? "yes" : "no"} ·{" "}
        {streaming ? "streaming…" : "idle"}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
        <button
          type="button"
          onClick={() =>
            applyVisceral({
              stress_level: stress,
              energy_level: energy,
              affinity_level: affinity,
            })
          }
        >
          Apply knobs
        </button>
        <button type="button" onClick={() => void playStream()}>
          Play mock stream
        </button>
      </div>
      {reply ? (
        <p style={{ marginTop: 12, opacity: 0.85, lineHeight: 1.4 }}>{reply}</p>
      ) : null}
      <Section title="Upstream (body → prompt)" />
      <Row label="agitation" value={perception.user_agitation} />
      <code
        style={{
          display: "block",
          marginTop: 8,
          padding: 8,
          background: "rgba(0,0,0,0.35)",
          whiteSpace: "pre-wrap",
          fontSize: 11,
        }}
      >
        {formatPerceptionNote(perception)}
      </code>
      <p style={{ marginTop: 10, opacity: 0.55, lineHeight: 1.35 }}>
        Click the canvas to raise agitation. Affinity glow follows the pointer.
      </p>
    </div>
  );
}

const meta = {
  title: "Synaptic/Bridge",
  component: SynapticStoryRoot,
  args: {
    stress: 0.72,
    energy: 0.55,
    affinity: 0.8,
  },
  argTypes: {
    stress: { control: { type: "range", min: 0, max: 1, step: 0.01 } },
    energy: { control: { type: "range", min: 0, max: 1, step: 0.01 } },
    affinity: { control: { type: "range", min: 0, max: 1, step: 0.01 } },
  },
} satisfies Meta<typeof SynapticStoryRoot>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MockStream: Story = {
  name: "Mock stream",
  args: { stress: 0.72, energy: 0.55, affinity: 0.8 },
};

export const CalmAffinity: Story = {
  name: "Calm affinity",
  args: { stress: 0.15, energy: 0.35, affinity: 0.95 },
};
