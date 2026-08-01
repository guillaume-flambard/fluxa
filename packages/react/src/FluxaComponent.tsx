import {
  createElement,
  useEffect,
  useId,
  useRef,
  type CSSProperties,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { useFluxa } from "./FluxaProvider.js";

export interface FluxaComponentProps extends HTMLAttributes<HTMLElement> {
  /** Semantic element for a11y. Default: div */
  as?: keyof HTMLElementTagNameMap;
  children?: ReactNode;
}

/**
 * Headless wrapper: registers its bounding box with the Fluxa engine
 * and exposes a semantic DOM node for accessibility / layout.
 * Visuals remain on the WebGL canvas (SDF components come in Step 4).
 */
export function FluxaComponent({
  as = "div",
  children,
  style,
  ...rest
}: FluxaComponentProps): ReactElement {
  const id = useId();
  const ref = useRef<HTMLElement | null>(null);
  const { registerComponent, unregisterComponent } = useFluxa();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const publish = () => {
      const rect = el.getBoundingClientRect();
      registerComponent({
        id,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      });
    };

    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    window.addEventListener("scroll", publish, true);

    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", publish, true);
      unregisterComponent(id);
    };
  }, [id, registerComponent, unregisterComponent]);

  const mergedStyle: CSSProperties = {
    pointerEvents: "auto",
    ...style,
  };

  return createElement(
    as,
    {
      ...rest,
      ref,
      style: mergedStyle,
    },
    children,
  );
}
