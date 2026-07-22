// Dev-only local server for the enemy balance tool. Serves the spreadsheet UI
// and a tiny JSON API that reads/writes the real enemy source. NOT part of the
// game build — run it with:  npx ts-node tools/enemy-balance/server.ts
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { loadModel, applyEdit, EditRequest } from "./enemyData";

const PORT = Number(process.env.BALANCE_PORT ?? 4600);

function sendJson(res: http.ServerResponse, code: number, body: unknown) {
  const s = JSON.stringify(body);
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(s);
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
      const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
      return;
    }
    if (req.method === "GET" && url === "/api/model") {
      sendJson(res, 200, loadModel());
      return;
    }
    if (req.method === "POST" && url === "/api/edit") {
      const body = JSON.parse(await readBody(req)) as EditRequest;
      applyEdit(body);
      sendJson(res, 200, loadModel()); // return the fresh model so the UI re-renders
      return;
    }
    res.writeHead(404);
    res.end("not found");
  } catch (err) {
    sendJson(res, 500, { error: String(err instanceof Error ? err.message : err) });
  }
});

server.listen(PORT, () => {
  console.log(`\n  enemy-balance tool  →  http://localhost:${PORT}\n`);
});
