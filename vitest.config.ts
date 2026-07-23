import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      shared: path.resolve(__dirname, "shared/src/index.ts"),
    },
  },
  // Colyseus schemas use TS legacy decorators, and their @type fields must be
  // assigned (not `defineProperty`-declared) or the serializer never sees them.
  oxc: {
    decorator: { legacy: true },
    define: { useDefineForClassFields: "false" },
  } as any,
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      include: ["shared/src/**/*.ts", "server/src/**/*.ts"],
      exclude: [
        "**/*.generated.ts",
        "shared/src/index.ts",
        "server/src/index.ts",
      ],
      reporter: ["text-summary", "html"],
    },
  },
});
