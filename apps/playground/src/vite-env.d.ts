/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ANIMA_LLM_BASE_URL?: string;
  readonly VITE_ANIMA_LLM_API_KEY?: string;
  readonly VITE_ANIMA_LLM_MODEL?: string;
  readonly VITE_FLUXA_COGNITION_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
