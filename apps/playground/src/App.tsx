import type { CSSProperties } from "react";
import {
  DialoguePanel,
  FluxaComponent,
  FluxaProvider,
  useAnima,
  useChannels,
  useFluxa,
  useHomeostasis,
} from "@fluxa/react";

function LivingHud() {
  const meta = useHomeostasis();
  const { phase, lifecycle } = useAnima();
  const channels = useChannels();
  const { engine, dialect, recordLanguageInput, forceSilence } = useFluxa();

  const invokeSeed = (name: string, asPanel = false) => {
    if (!engine) return;
    if (asPanel) engine.beginPanelSpawn();
    try {
      engine.executeExpression({ ops: [{ op: "invoke", name }] }, dialect);
    } finally {
      if (asPanel) engine.endPanelSpawn();
    }
    engine.wake();
  };

  return (
    <div
      style={{
        position: "absolute",
        left: 32,
        bottom: 32,
        pointerEvents: "auto",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 12,
        color: "#d7e8ff",
        background: "rgba(4, 12, 24, 0.55)",
        border: "1px solid rgba(180, 210, 255, 0.25)",
        padding: "12px 14px",
        minWidth: 280,
      }}
    >
      <div style={{ marginBottom: 6, letterSpacing: "0.12em", opacity: 0.6 }}>
        ANIMA · {phase.toUpperCase()} · {channels.presence.toUpperCase()}
      </div>
      <Meter label="language" value={channels.languageIntensity} />
      <Meter label="proximics" value={channels.proximicsIntensity} />
      <Meter label="presence" value={channels.presenceGain} />
      <Meter label="stress" value={Math.max(meta.stress, lifecycle.stress)} />
      <Meter label="energy" value={Math.min(1, Math.max(0, Math.max(meta.energy, lifecycle.energy)))} />
      <Meter label="Ia" value={lifecycle.autonomyIndex} />
      <div style={{ marginTop: 8, opacity: 0.55, fontSize: 11 }}>
        volonte · soma bytecode · clic = nudge organite
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
        <button
          type="button"
          style={btnStyle}
          onClick={() => {
            engine?.homeostasis.excite(0.9);
            engine?.applyVisceral({
              stress_level: 0.88,
              energy_level: 0.35,
              affinity_level: 0.3,
            });
            invokeSeed("anxiety_pulse");
          }}
          title="Force refuse soma (surcharge)"
        >
          will:refuse
        </button>
        <button
          type="button"
          style={btnStyle}
          onClick={() => {
            engine?.applyVisceral({
              stress_level: 0.2,
              energy_level: 0.75,
              affinity_level: 0.78,
            });
            invokeSeed("living_panel", true);
          }}
          title="Force living_panel organites"
        >
          will:panel
        </button>
        <button
          type="button"
          style={btnStyle}
          onClick={() => invokeSeed("soft_bloom")}
        >
          soft_bloom
        </button>
        <button
          type="button"
          style={btnStyle}
          onClick={() => invokeSeed("anxiety_pulse")}
        >
          anxiety_pulse
        </button>
        <button
          type="button"
          style={btnStyle}
          onClick={() => invokeSeed("shard_storm")}
        >
          shard_storm
        </button>
        <button
          type="button"
          style={btnStyle}
          onClick={() => {
            engine?.homeostasis.excite(0.35);
            engine?.wake();
          }}
        >
          Poke stress
        </button>
        <button
          type="button"
          style={btnStyle}
          onClick={() => {
            recordLanguageInput(4);
          }}
        >
          Speak
        </button>
        <button type="button" style={btnStyle} onClick={() => forceSilence()}>
          Silence
        </button>
      </div>
    </div>
  );
}

const btnStyle: CSSProperties = {
  padding: "6px 10px",
  cursor: "pointer",
  background: "rgba(255, 120, 100, 0.15)",
  border: "1px solid rgba(255, 160, 140, 0.4)",
  color: "#ffe8e0",
  fontSize: 11,
};

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
      <span style={{ width: 68, opacity: 0.7 }}>{label}</span>
      <div
        style={{
          flex: 1,
          height: 6,
          background: "rgba(255,255,255,0.08)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.round(value * 100)}%`,
            height: "100%",
            background: "linear-gradient(90deg, #5ab0ff, #7b5cff)",
          }}
        />
      </div>
      <span style={{ width: 36, textAlign: "right" }}>{value.toFixed(2)}</span>
    </div>
  );
}

export function App() {
  return (
    <FluxaProvider
      className="fluxa-root"
      engineOptions={{
        resolution: 512,
        waveSpeed2: 0.28,
        gamma: 0.02,
        sponge: 0.08,
        substeps: 2,
        baseColor: [0.03, 0.1, 0.2],
        highlight: [0.55, 0.85, 1.0],
        warmColor: [0.75, 0.28, 0.3],
        channels: { silenceThresholdSec: 2.5 },
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 32,
          top: 32,
          maxWidth: 420,
          pointerEvents: "none",
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 12,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            opacity: 0.55,
          }}
        >
          Fluxa / Living link
        </p>
        <h1 style={{ margin: "8px 0 0", fontWeight: 500, fontSize: 28 }}>
          Elle repond en creant.
        </h1>
        <p style={{ margin: "10px 0 0", opacity: 0.7, lineHeight: 1.45 }}>
          Anima pense, invente des idiomes Meta-AEL, et sync son monde mental
          vers Obsidian si le sidecar tourne. Les mots au locus sont rares.
        </p>
      </div>

      <LivingHud />
      <DialoguePanel />

      <FluxaComponent
        as="button"
        style={{
          position: "absolute",
          right: 40,
          bottom: 40,
          padding: "12px 18px",
          border: "1px solid rgba(200, 230, 255, 0.35)",
          background: "rgba(8, 20, 36, 0.45)",
          color: "#e8f1ff",
          borderRadius: 4,
          cursor: "pointer",
          backdropFilter: "blur(4px)",
        }}
      >
        FluxaComponent (bbox stub)
      </FluxaComponent>
    </FluxaProvider>
  );
}
