export { createGL, GLError, type GLContext } from "./gl/context.js";
export {
  createPingPong,
  type PingPongTarget,
  type FrameTarget,
} from "./gl/framebuffer.js";
export { createProgram, createFullscreenVAO, createShader } from "./gl/program.js";
export {
  RippleManager,
  type RippleImpulse,
  type RippleManagerOptions,
} from "./ripple/RippleManager.js";
export {
  createEngine,
  HeightmapSimulator,
  type FluxaEngine,
  type FluxaEngineOptions,
} from "./sim/HeightmapSimulator.js";
export {
  HomeostasisEngine,
  type HomeostasisOptions,
  type HomeostasisSnapshot,
} from "./homeostasis/HomeostasisEngine.js";
export {
  VisceralStreamParser,
  UserAgitationTracker,
  SynapticBridge,
  mockVisceralStream,
  formatPerceptionNote,
  clamp01,
  type VisceralState,
  type AssistantTurn,
  type VisceralPartial,
  type PerceptionSnapshot,
  type UserAgitationOptions,
  type SynapticBridgeOptions,
  type MockStreamOptions,
} from "./synaptic/index.js";
export {
  FluxaLifecycleEngine,
  type LifecycleMode,
  type LifecycleSnapshot,
  type FluxaLifecycleOptions,
} from "./lifecycle/FluxaLifecycleEngine.js";
export {
  deriveAnimaPhase,
  type AnimaPhase,
  type VisceralIntent,
} from "./anima/types.js";
export {
  ChannelActivityTracker,
  type CommChannel,
  type PresenceState,
  type ChannelSnapshot,
  type ChannelActivityOptions,
} from "./channels/index.js";
