import { FluxaComponent, FluxaProvider, useFluxa, useHomeostasis } from "@fluxa/react";

function MetabolismMeters() {
  const meta = useHomeostasis();
  const { engine } = useFluxa();

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
        minWidth: 220,
      }}
    >
      <div style={{ marginBottom: 8, letterSpacing: "0.12em", opacity: 0.6 }}>
        HOMEOSTASIS
      </div>
      <Meter label="stress" value={meta.stress} />
      <Meter label="breath" value={(meta.breath + 1) / 2} />
      <Meter label="energy" value={Math.min(1, Math.max(0, meta.energy))} />
      <div style={{ marginTop: 8, opacity: meta.fatigued ? 1 : 0.45 }}>
        {meta.fatigued ? "FATIGUED — sim throttled" : "recovered"}
      </div>
      <button
        type="button"
        style={{
          marginTop: 10,
          padding: "6px 10px",
          cursor: "pointer",
          background: "rgba(255, 120, 100, 0.2)",
          border: "1px solid rgba(255, 160, 140, 0.45)",
          color: "#ffe8e0",
        }}
        onClick={() => {
          engine?.homeostasis.excite(0.35);
          engine?.wake();
        }}
      >
        Poke stress
      </button>
    </div>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
      <span style={{ width: 52, opacity: 0.7 }}>{label}</span>
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
            background: "linear-gradient(90deg, #5ab0ff, #ff7a6a)",
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
          Fluxa / v2 Homeostasis
        </p>
        <h1 style={{ margin: "8px 0 0", fontWeight: 500, fontSize: 28 }}>
          Breath at rest — stress warms the field
        </h1>
        <p style={{ margin: "10px 0 0", opacity: 0.7, lineHeight: 1.45 }}>
          Click for cavities + excitation. Hold bursts to trigger fatigue.
        </p>
      </div>

      <MetabolismMeters />

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
