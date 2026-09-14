import path from "node:path";
import { defineConfig } from "vitest/config";

const root = path.resolve(__dirname, "..");

export default defineConfig({
  root,
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    fileParallelism: false,
    setupFiles: ["tests/integration/setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": path.join(root, "src"),
    },
  },
});
