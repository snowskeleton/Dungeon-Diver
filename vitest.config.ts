import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      shared: path.resolve(__dirname, "shared/src/index.ts"),
      // The client's net layer (LocalAuthority/HostSession/RemoteAuthority) deep-imports
      // the sim via this alias; the P2P session tests exercise those, so vitest resolves
      // it the same way vite does for the client bundle.
      "@engine": path.resolve(__dirname, "engine/src"),
    },
  },
  // The observable state primitive (@tracked) relies on class fields being ASSIGNED
  // (not `defineProperty`-declared) so its Proxy sees each write. Keep legacy field
  // semantics; the decorator flag is harmless leftover kept for any @tracked usage.
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
      include: ["shared/src/**/*.ts", "engine/src/**/*.ts", "server/src/**/*.ts"],
      exclude: [
        "**/*.generated.ts",
        "shared/src/index.ts",
        "engine/src/index.ts",
        "server/src/index.ts",
      ],
      reporter: ["text-summary", "html"],
    },
  },
});
