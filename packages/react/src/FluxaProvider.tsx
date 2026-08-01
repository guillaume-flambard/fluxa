import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  createEngine,
  deriveAnimaPhase,
  type AnimaPhase,
  type ChannelSnapshot,
  type FluxaEngine,
  type FluxaEngineOptions,
  type HomeostasisSnapshot,
  type LifecycleSnapshot,
  type PerceptionSnapshot,
  type VisceralIntent,
  type VisceralPartial,
  type VisceralState,
} from "@fluxa/core";

export interface ComponentBounds {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FluxaContextValue {
  engine: FluxaEngine | null;
  registerComponent: (bounds: ComponentBounds) => void;
  unregisterComponent: (id: string) => void;
  feedVisceralChunk: (chunk: string) => VisceralPartial | null;
  applyVisceral: (state: Partial<VisceralState>) => void;
  expressVisceral: (intent: VisceralIntent) => void;
  resetVisceralStream: () => void;
  recordLanguageInput: (charCount?: number) => void;
  forceSilence: () => void;
}

const FluxaContext = createContext<FluxaContextValue | null>(null);

const IDLE_SNAPSHOT: HomeostasisSnapshot = {
  stress: 0.08,
  breath: 0,
  energy: 0.5,
  fatigued: false,
  tIdle: 0,
  energyBias: 0,
  aiDriven: false,
};

const IDLE_PERCEPTION: PerceptionSnapshot = {
  user_agitation: 0,
  clicksPerSecond: 0,
  pointerUv: { x: 0.5, y: 0.5 },
};

const IDLE_LIFECYCLE: LifecycleSnapshot = {
  stress: 0.1,
  energy: 0.8,
  affinity: 0.5,
  autonomyIndex: 0,
  mode: "react",
  idleSeconds: 0,
  autonomousTicks: 0,
};

const IDLE_CHANNELS: ChannelSnapshot = {
  active: "silence",
  languageIntensity: 0,
  proximicsIntensity: 0,
  visualIntensity: 0,
  silenceSeconds: 0,
  presence: "coupled",
  presenceGain: 1,
};

export function useFluxa(): FluxaContextValue {
  const ctx = useContext(FluxaContext);
  if (!ctx) {
    throw new Error("useFluxa must be used within <FluxaProvider>");
  }
  return ctx;
}

export function useHomeostasis(): HomeostasisSnapshot {
  const { engine } = useFluxa();
  return useSyncExternalStore(
    (onStoreChange) => {
      if (!engine) return () => undefined;
      return engine.homeostasis.subscribe(onStoreChange);
    },
    () => engine?.homeostasis.getSnapshot() ?? IDLE_SNAPSHOT,
    () => IDLE_SNAPSHOT,
  );
}

/** Ascendant perception (user agitation) for future prompt injection. */
export function usePerception(): PerceptionSnapshot {
  const { engine } = useFluxa();
  return useSyncExternalStore(
    (onStoreChange) => {
      if (!engine) return () => undefined;
      return engine.agitation.subscribe(onStoreChange);
    },
    () => engine?.agitation.getSnapshot() ?? IDLE_PERCEPTION,
    () => IDLE_PERCEPTION,
  );
}

/**
 * Feed streamed JSON chunks into the synaptic bridge.
 * Returns helpers bound to the current engine.
 */
export function useVisceralDriver(): {
  feedChunk: (chunk: string) => VisceralPartial | null;
  applyVisceral: (state: Partial<VisceralState>) => void;
  reset: () => void;
} {
  const { feedVisceralChunk, applyVisceral, resetVisceralStream } = useFluxa();
  return {
    feedChunk: feedVisceralChunk,
    applyVisceral,
    reset: resetVisceralStream,
  };
}

/** Lifecycle autonomy (react / symbiosis / dream). */
export function useLifecycle(): LifecycleSnapshot {
  const { engine } = useFluxa();
  return useSyncExternalStore(
    (onStoreChange) => {
      if (!engine) return () => undefined;
      return engine.lifecycle.subscribe(onStoreChange);
    },
    () => engine?.lifecycle.getSnapshot() ?? IDLE_LIFECYCLE,
    () => IDLE_LIFECYCLE,
  );
}

/** Anima somatic bridge — derived phase + expressVisceral. */
export function useAnima(): {
  lifecycle: LifecycleSnapshot;
  expressVisceral: (intent: VisceralIntent) => void;
  phase: AnimaPhase;
} {
  const { expressVisceral } = useFluxa();
  const lifecycle = useLifecycle();
  const phase = deriveAnimaPhase({
    mode: lifecycle.mode,
    stress: lifecycle.stress,
  });
  return { lifecycle, expressVisceral, phase };
}

/** Symbol-to-body channel activity + presence (coupled | absent). */
export function useChannels(): ChannelSnapshot {
  const { engine } = useFluxa();
  return useSyncExternalStore(
    (onStoreChange) => {
      if (!engine) return () => undefined;
      return engine.channels.subscribe(onStoreChange);
    },
    () => engine?.channels.getSnapshot() ?? IDLE_CHANNELS,
    () => IDLE_CHANNELS,
  );
}

export interface FluxaProviderProps {
  children?: ReactNode;
  engineOptions?: FluxaEngineOptions;
  canvasStyle?: CSSProperties;
  className?: string;
}

export function FluxaProvider({
  children,
  engineOptions,
  canvasStyle,
  className,
}: FluxaProviderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<FluxaEngine | null>(null);
  const componentsRef = useRef<Map<string, ComponentBounds>>(new Map());

  const registerComponent = useCallback((bounds: ComponentBounds) => {
    componentsRef.current.set(bounds.id, bounds);
  }, []);

  const unregisterComponent = useCallback((id: string) => {
    componentsRef.current.delete(id);
  }, []);

  const feedVisceralChunk = useCallback(
    (chunk: string) => (engine ? engine.feedVisceralChunk(chunk) : null),
    [engine],
  );

  const applyVisceral = useCallback(
    (state: Partial<VisceralState>) => {
      engine?.applyVisceral(state);
    },
    [engine],
  );

  const expressVisceral = useCallback(
    (intent: VisceralIntent) => {
      engine?.expressVisceral(intent);
    },
    [engine],
  );

  const resetVisceralStream = useCallback(() => {
    engine?.resetVisceralStream();
  }, [engine]);

  const recordLanguageInput = useCallback(
    (charCount?: number) => {
      engine?.recordLanguageInput(charCount);
    },
    [engine],
  );

  const forceSilence = useCallback(() => {
    engine?.forceSilence();
  }, [engine]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let eng: FluxaEngine;
    try {
      eng = createEngine(canvas, engineOptions);
    } catch (err) {
      console.error("[Fluxa]", err);
      return;
    }

    const syncSize = () => {
      const rect = container.getBoundingClientRect();
      eng.resize(rect.width, rect.height);
    };

    syncSize();
    eng.start();
    setEngine(eng);

    const onPointerDown = (e: PointerEvent) => {
      const uv = eng.clientToUv(e.clientX, e.clientY);
      eng.setPointerUv(uv.x, uv.y);
      eng.setInkPainting(true);
      eng.pushInk(uv.x, uv.y);
      eng.ripples.pointerDown(uv.x, uv.y);
      eng.homeostasis.excite();
      eng.recordClick();
      eng.recordHumanActivity(0.5);
      eng.wake();
    };

    const onPointerMove = (e: PointerEvent) => {
      const uv = eng.clientToUv(e.clientX, e.clientY);
      eng.setPointerUv(uv.x, uv.y);
      if (e.buttons > 0) {
        eng.pushInk(uv.x, uv.y);
      }
      eng.ripples.pointerMove(uv.x, uv.y);
      eng.recordHumanActivity(0.15);
      eng.wake();
    };

    const onPointerLeave = () => {
      eng.setInkPainting(false);
      eng.ripples.pointerLeave();
    };

    const onPointerUp = () => {
      eng.setInkPainting(false);
      eng.ripples.pointerLeave();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore pure modifiers; language channel for printable / edit keys
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length === 1 || e.key === "Enter" || e.key === "Backspace") {
        eng.recordLanguageInput(1);
      } else {
        eng.recordHumanActivity(0.15);
      }
      eng.wake();
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("pointerup", onPointerUp);
    window.addEventListener("keydown", onKeyDown);

    const ro = new ResizeObserver(syncSize);
    ro.observe(container);

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
      ro.disconnect();
      eng.dispose();
      setEngine(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<FluxaContextValue>(
    () => ({
      engine,
      registerComponent,
      unregisterComponent,
      feedVisceralChunk,
      applyVisceral,
      expressVisceral,
      resetVisceralStream,
      recordLanguageInput,
      forceSilence,
    }),
    [
      engine,
      registerComponent,
      unregisterComponent,
      feedVisceralChunk,
      applyVisceral,
      expressVisceral,
      resetVisceralStream,
      recordLanguageInput,
      forceSilence,
    ],
  );

  const rootStyle: CSSProperties = {
    position: "relative",
    width: "100%",
    height: "100%",
    overflow: "hidden",
  };

  const defaultCanvasStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    display: "block",
    touchAction: "none",
    ...canvasStyle,
  };

  const overlayStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    zIndex: 1,
    pointerEvents: "none",
  };

  return createElement(
    FluxaContext.Provider,
    { value },
    createElement(
      "div",
      { ref: containerRef, className, style: rootStyle },
      createElement("canvas", {
        ref: canvasRef,
        style: defaultCanvasStyle,
        "aria-hidden": true,
      }),
      createElement("div", { style: overlayStyle }, children),
    ),
  );
}
