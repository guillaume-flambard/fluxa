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
  type FluxaEngine,
  type FluxaEngineOptions,
  type HomeostasisSnapshot,
  type PerceptionSnapshot,
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
  resetVisceralStream: () => void;
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

  const resetVisceralStream = useCallback(() => {
    engine?.resetVisceralStream();
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
      eng.ripples.pointerDown(uv.x, uv.y);
      eng.homeostasis.excite();
      eng.recordClick();
      eng.wake();
    };

    const onPointerMove = (e: PointerEvent) => {
      const uv = eng.clientToUv(e.clientX, e.clientY);
      eng.setPointerUv(uv.x, uv.y);
      eng.ripples.pointerMove(uv.x, uv.y);
      eng.wake();
    };

    const onPointerLeave = () => {
      eng.ripples.pointerLeave();
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("pointerup", onPointerLeave);

    const ro = new ResizeObserver(syncSize);
    ro.observe(container);

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("pointerup", onPointerLeave);
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
      resetVisceralStream,
    }),
    [
      engine,
      registerComponent,
      unregisterComponent,
      feedVisceralChunk,
      applyVisceral,
      resetVisceralStream,
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
