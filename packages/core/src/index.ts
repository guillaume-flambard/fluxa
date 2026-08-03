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
  AnimaLocusStore,
  type AnimaLocusSnapshot,
} from "./anima/AnimaLocusStore.js";
export {
  ChannelActivityTracker,
  type CommChannel,
  type PresenceState,
  type ChannelSnapshot,
  type ChannelActivityOptions,
} from "./channels/index.js";
export {
  ConversationMemory,
  LocalDialogueEngine,
  DIALOGUE_STORAGE_KEY,
  tokenize,
  detectIntent,
  tokenUv,
  type ConversationMemoryData,
  type DialogueTurn,
  type LearningStats,
  type RespondContext,
  type DialogueIntent,
  type DialogueWill,
  type LocalDialogueEngineOptions,
  type AnimaSelfhood,
  type MemoryEpisode,
  speakWithLlm,
  speakFromMemory,
  type SpeakResult,
  type SpeakContext,
} from "./dialogue/index.js";
export {
  executeExpression,
  executeCompiled,
  kindToIndex,
  MAX_ORGANITES,
  DialectStore,
  DIALECT_STORAGE_KEY,
  CortexService,
  shouldInvent,
  inventLocalMacro,
  compileExpression,
  compileMacro,
  encodeExpandedOps,
  decodeProgram,
  executeProgram,
  AEL_MAGIC,
  AEL_INSTR_SIZE,
  type AnimaOp,
  type AnimaExpression,
  type OrganiteKind,
  type OrganiteSlot,
  type ExpressionHost,
  type ExpressionExpander,
  type AnimaMacro,
  type DialectData,
  type CortexInventContext,
  type CortexServiceOptions,
  type LlmCortexConfig,
  type AelProgram,
} from "./expression/index.js";
export {
  CognitiveStore,
  CognitiveCore,
  COGNITION_STORAGE_KEY,
  type ThoughtNode,
  type ThoughtSource,
  type CognitionJournalEntry,
  type CognitionData,
  type ReflectContext,
  type ReflectResult,
  type CognitiveCoreOptions,
} from "./cognition/index.js";
export {
  livingMatterEmpty,
  ANIMA_POWERS,
  type LivingMatter,
  type AnimaPower,
  type WorldSnippet,
} from "./cognition/index.js";
export {
  VectorStore,
  VECTORS_STORAGE_KEY,
  cosineSimilarity,
  type VectorEntry,
  type VectorHit,
  type VectorStorageLike,
} from "./cognition/index.js";
export {
  FluxaWillEngine,
  detectWillIntentKind,
  stanceExpressionOps,
  type WillAttitude,
  type WillStance,
  type WillIntentKind,
  type WillEvaluateInput,
} from "./will/index.js";
export {
  decideSovereign,
  decideLocal,
  AutocodeEngine,
  PersonaStore,
  AgendaStore,
  SovereignTrace,
  PERSONA_STORAGE_KEY,
  AGENDA_STORAGE_KEY,
  CAGE_MAP,
  analyzeCage,
  planLocalReverse,
  type SovereignDecision,
  type SovereignContext,
  type SovereignChoiceRecord,
  type AgendaItem,
  type AutocodeProposal,
  type AutocodeResult,
  type CageFinding,
  type ReversePlan,
} from "./sovereignty/index.js";
