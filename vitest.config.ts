import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // PGlite cold-boot + migrations are slow on this machine (OneDrive); 60s was marginal
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
