// Dev-only local server for the weapon + ammo balance tool. Serves the
// spreadsheet UI and a tiny JSON API that reads/writes the real source. NOT part
// of the game build — run it with:  npm run balance:weapons
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { loadSheet, applyEdit, SheetConfig, EditRequest } from "./getterSheet";
import { WEAPON_SHEET } from "./weaponData";
import { AMMO_SHEET } from "./ammoData";

const PORT = Number(process.env.BALANCE_PORT ?? 4601);
const SHEETS: Record<string, SheetConfig> = { weapon: WEAPON_SHEET, ammo: AMMO_SHEET };

/** Both domains in one payload; the UI renders a sheet per domain. */
function model() {
  return { title: "Weapon & Ammo Balance", sheets: Object.values(SHEETS).map(loadSheet) };
}

interface EditBody extends EditRequest {
  domain: string;
}

function sendJson(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = req.url ?? "/";
    if (req.method === "GET" && (url === "/" || url === "/index.html")) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(fs.readFileSync(path.join(__dirname, "index.html"), "utf8"));
      return;
    }
    if (req.method === "GET" && url === "/api/model") {
      sendJson(res, 200, model());
      return;
    }
    if (req.method === "POST" && url === "/api/edit") {
      const body = JSON.parse(await readBody(req)) as EditBody;
      const cfg = SHEETS[body.domain];
      if (!cfg) throw new Error(`unknown domain ${body.domain}`);
      applyEdit(cfg, body);
      sendJson(res, 200, model());
      return;
    }
    res.writeHead(404);
    res.end("not found");
  } catch (err) {
    sendJson(res, 500, { error: String(err instanceof Error ? err.message : err) });
  }
});

server.listen(PORT, () => {
  console.log(`\n  weapon + ammo balance tool  →  http://localhost:${PORT}\n`);
});
