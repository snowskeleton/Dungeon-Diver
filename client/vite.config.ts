import { defineConfig, Plugin } from "vite";
import path from "path";

// Lets client code send data to the terminal running `npm run dev` (via Vite's
// dev-server websocket) instead of only the browser devtools console.
// Channels: "debug:log" (generic dev logging) and "assets:placeholders"
// (sent by client/src/dev/PlaceholderReport.ts to print the ASSET STATUS box).
function terminalLogPlugin(): Plugin {
  return {
    name: "terminal-log",
    configureServer(server) {
      server.ws.on("debug:log", (data) => {
        console.log(`\n[${data?.label ?? "client"}]`, JSON.stringify(data?.payload ?? data, null, 2));
      });

      server.ws.on("assets:placeholders", (data: { count: number; byCategory: Record<string, string[]> }) => {
        const line = "─".repeat(48);
        console.log(`\n${line}`);
        console.log(`  ASSET STATUS  ${data.count} placeholder(s) need artwork`);
        console.log(line);
        for (const [category, ids] of Object.entries(data.byCategory)) {
          console.log(`  ${category}:`);
          for (const id of ids) console.log(`    ○ ${id}`);
        }
        console.log(line + "\n");
      });
    },
  };
}

export default defineConfig({
  resolve: {
    alias: {
      shared: path.resolve(__dirname, "../shared/src/index.ts"),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  plugins: [terminalLogPlugin()],
});
