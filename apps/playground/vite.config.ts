import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@fluxa/core": resolve(root, "../../packages/core/src/index.ts"),
      "@fluxa/react": resolve(root, "../../packages/react/src/index.ts"),
    },
  },
  server: {
    port: 5173,
    open: false,
  },
});
