import { defineConfig, Plugin } from "vite";
import path from "path";

// Lets client code send data to the terminal running `npm run dev` (via Vite's
// dev-server websocket) instead of only the browser devtools console.
// Channel: "debug:log" (generic dev logging).
function terminalLogPlugin(): Plugin {
  return {
    name: "terminal-log",
    configureServer(server) {
      server.ws.on("debug:log", (data) => {
        console.log(`\n[${data?.label ?? "client"}]`, JSON.stringify(data?.payload ?? data, null, 2));
      });
    },
  };
}

export default defineConfig({
  resolve: {
    alias: {
      shared: path.resolve(__dirname, "../shared/src/index.ts"),
      // The authoritative simulation is now client-importable (Colyseus- and
      // matter-free portable TS). The in-process LocalAuthority runs it directly.
      "@engine": path.resolve(__dirname, "../engine/src"),
    },
  },
  esbuild: {
    // The imported sim tree uses legacy decorators (@tracked); target ES2020 keeps
    // useDefineForClassFields false so field initializers assign (the Observable
    // Proxy also handles the other case).
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        useDefineForClassFields: false,
      },
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  plugins: [terminalLogPlugin()],
});
