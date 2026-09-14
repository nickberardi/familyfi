import path from "node:path";
import { defineConfig } from "vitest/config";

const root = path.resolve(__dirname, "..");

export default defineConfig({
  root,
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/contract/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.join(root, "src"),
    },
  },
});
