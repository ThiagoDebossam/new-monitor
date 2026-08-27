import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // import.meta.dirname (Node >=20.11) em vez de __dirname: este arquivo roda como ESM.
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
