// Static analyzer + source editor for enemy/boss balance stats.
//
// Reads every Enemy/Boss subclass straight from source with the TypeScript
// compiler API — no game code is executed and matter-js is never loaded. For
// each concrete enemy it resolves the eight tunable numeric stat getters up the
// `extends` chain, recording the resolved value AND which class declared it
// (so the UI can show inherited-vs-specific). Writes go back through the same
// AST as precise text splices, so the source stays OO and compiler-checked —
// there is no data blob and no id->config table (see CLAUDE.md).

import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

// ── Layout ──────────────────────────────────────────────────────────────────
const ENTITIES = path.resolve(__dirname, "../../server/src/entities");
const ENEMIES_DIR = path.join(ENTITIES, "enemies");
const BOSSES_DIR = path.join(ENTITIES, "bosses");

/** Every source file that can declare a relevant class. */
function classFiles(): string[] {
  const files = [path.join(ENTITIES, "Enemy.ts"), path.join(ENTITIES, "Boss.ts")];
  for (const dir of [ENEMIES_DIR, BOSSES_DIR]) {
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith(".ts") && f !== "index.ts") files.push(path.join(dir, f));
    }
  }
  return files;
}

// ── The stats we expose ───────────────────────────────────────────────────────
export interface StatMeta {
  key: string;
  label: string;
  unit: string;
}

export const STATS: StatMeta[] = [
  { key: "maxHp", label: "Max HP", unit: "" },
  { key: "speed", label: "Speed", unit: "px/s" },
  { key: "aggroRadius", label: "Aggro", unit: "px" },
  { key: "attackRadius", label: "Atk Reach", unit: "px" },
  { key: "attackDamage", label: "Atk Dmg", unit: "" },
  { key: "attackCooldownMs", label: "Atk CD", unit: "ms" },
  { key: "knockbackResistance", label: "KB Resist", unit: "" },
  { key: "cruiseHeight", label: "Cruise Ht", unit: "px" },
];
const STAT_KEYS = new Set(STATS.map((s) => s.key));

// ── Parsed model ──────────────────────────────────────────────────────────────
interface GetterInfo {
  /** span of the whole get-accessor declaration, for delete */
  fullStart: number;
  fullEnd: number;
  /** span of the returned expression, for replace */
  exprStart: number;
  exprEnd: number;
  /** resolved numeric value, or null if the body isn't a simple number/const */
  value: number | null;
}

interface ClassInfo {
  name: string;
  file: string;
  extends: string | null;
  /** static readonly type = "..." value, if any (concrete enemies only) */
  typeId: string | null;
  bodyStart: number; // position just inside the opening `{`
  bodyEnd: number; // position of the closing `}`
  singleLine: boolean;
  indent: string;
  /** the end position of the `static readonly type` property, for insertion */
  typePropEnd: number | null;
  getters: Record<string, GetterInfo>;
}

interface ParsedFile {
  path: string;
  text: string;
  consts: Record<string, number>;
  classes: ClassInfo[];
}

function numericFromExpr(
  expr: ts.Expression,
  consts: Record<string, number>,
): number | null {
  if (ts.isNumericLiteral(expr)) return Number(expr.text);
  if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.MinusToken) {
    const inner = numericFromExpr(expr.operand, consts);
    return inner === null ? null : -inner;
  }
  if (ts.isIdentifier(expr) && expr.text in consts) return consts[expr.text];
  return null;
}

function parseFile(filePath: string): ParsedFile {
  const text = fs.readFileSync(filePath, "utf8");
  const sf = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);

  // module-level numeric consts (e.g. BAT_HOVER = 16)
  const consts: Record<string, number> = {};
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && ts.isNumericLiteral(d.initializer)) {
          consts[d.name.text] = Number(d.initializer.text);
        }
      }
    }
  }

  const classes: ClassInfo[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isClassDeclaration(node) && node.name) {
      const heritage = node.heritageClauses?.find(
        (h) => h.token === ts.SyntaxKind.ExtendsKeyword,
      );
      const baseExpr = heritage?.types[0]?.expression;
      const extendsName = baseExpr && ts.isIdentifier(baseExpr) ? baseExpr.text : null;

      const info: ClassInfo = {
        name: node.name.text,
        file: filePath,
        extends: extendsName,
        typeId: null,
        bodyStart: node.members.pos,
        bodyEnd: node.end - 1, // just before final `}`
        singleLine:
          sf.getLineAndCharacterOfPosition(node.getStart(sf)).line ===
          sf.getLineAndCharacterOfPosition(node.end).line,
        indent: "  ",
        typePropEnd: null,
        getters: {},
      };

      for (const m of node.members) {
        // static readonly type = "..."
        if (
          ts.isPropertyDeclaration(m) &&
          ts.isIdentifier(m.name) &&
          m.name.text === "type"
        ) {
          info.typePropEnd = m.end;
          if (m.initializer && ts.isStringLiteral(m.initializer)) {
            info.typeId = m.initializer.text;
          }
          const line = text.split("\n")[
            sf.getLineAndCharacterOfPosition(m.getStart(sf)).line
          ];
          const lead = line.match(/^\s*/);
          if (lead) info.indent = lead[0];
        }
        // get <stat>() { return <expr>; }
        if (ts.isGetAccessorDeclaration(m) && ts.isIdentifier(m.name)) {
          const key = m.name.text;
          if (!STAT_KEYS.has(key)) continue;
          const ret = m.body?.statements[0];
          let value: number | null = null;
          let exprStart = m.getStart(sf);
          let exprEnd = m.end;
          if (ret && ts.isReturnStatement(ret) && ret.expression) {
            value = numericFromExpr(ret.expression, consts);
            exprStart = ret.expression.getStart(sf);
            exprEnd = ret.expression.end;
          }
          info.getters[key] = {
            fullStart: m.getFullStart(),
            fullEnd: m.end,
            exprStart,
            exprEnd,
            value,
          };
        }
      }
      classes.push(info);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { path: filePath, text, consts, classes };
}

/** array-literal membership (identifiers) of an exported const in a file. */
function parseMembership(filePath: string, exportName: string): string[] {
  const text = fs.readFileSync(filePath, "utf8");
  const sf = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === exportName &&
      node.initializer &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      for (const el of node.initializer.elements) {
        if (ts.isIdentifier(el)) out.push(el.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

// ── Public model ──────────────────────────────────────────────────────────────
export interface StatCell {
  value: number | null;
  declaredIn: string | null; // which class declares the getter (provenance)
  inherited: boolean; // true if not declared on the leaf class
}
export interface EnemyRow {
  className: string;
  typeId: string;
  category: "base" | "regular" | "boss" | "other";
  file: string; // repo-relative
  stats: Record<string, StatCell>;
}
export interface Model {
  stats: StatMeta[];
  enemies: EnemyRow[];
}

const REPO_ROOT = path.resolve(__dirname, "../..");
const rel = (p: string) => path.relative(REPO_ROOT, p);

function buildIndex(): { byName: Map<string, ClassInfo>; files: ParsedFile[] } {
  const files = classFiles().map(parseFile);
  const byName = new Map<string, ClassInfo>();
  for (const f of files) for (const c of f.classes) byName.set(c.name, c);
  return { byName, files };
}

function resolveStat(
  leaf: string,
  stat: string,
  byName: Map<string, ClassInfo>,
): StatCell {
  let cur: string | null = leaf;
  while (cur) {
    const ci: ClassInfo | undefined = byName.get(cur);
    if (!ci) break;
    const g = ci.getters[stat];
    if (g) {
      return { value: g.value, declaredIn: cur, inherited: cur !== leaf };
    }
    cur = ci.extends;
  }
  return { value: null, declaredIn: null, inherited: true };
}

export function loadModel(): Model {
  const { byName } = buildIndex();
  const regular = new Set(parseMembership(path.join(ENEMIES_DIR, "index.ts"), "REGULAR_ENEMIES"));
  const bosses = new Set(parseMembership(path.join(BOSSES_DIR, "index.ts"), "BOSSES"));

  // Base/intermediate classes others inherit from (Enemy, Boss, DirectionalEnemy):
  // editing one of these rows changes the default every inheriting enemy reads.
  const baseNames = new Set<string>();
  for (const ci of byName.values()) if (ci.extends && byName.has(ci.extends)) baseNames.add(ci.extends);

  const rows: EnemyRow[] = [];
  const addRow = (name: string, category: EnemyRow["category"]) => {
    const ci = byName.get(name)!;
    const stats: Record<string, StatCell> = {};
    for (const s of STATS) stats[s.key] = resolveStat(name, s.key, byName);
    // A base row's own value is "specific" if declared on it, else it inherits
    // further up — mark it as such so provenance reads the same as an enemy row.
    rows.push({ className: name, typeId: name, category, file: rel(ci.file), stats });
  };

  for (const name of baseNames) addRow(name, "base");
  for (const [name, ci] of byName) {
    if (!ci.typeId) continue; // only concrete, id-carrying enemies
    addRow(name, regular.has(name) ? "regular" : bosses.has(name) ? "boss" : "other");
  }

  const order = { base: 0, regular: 1, boss: 2, other: 3 };
  // Within the base group, root defaults first (Enemy → Boss → the rest).
  const baseRank = (n: string) => (n === "Enemy" ? 0 : n === "Boss" ? 1 : 2);
  rows.sort((a, b) => {
    if (a.category !== b.category) return order[a.category] - order[b.category];
    if (a.category === "base") return baseRank(a.className) - baseRank(b.className);
    return a.typeId.localeCompare(b.typeId);
  });
  return { stats: STATS, enemies: rows };
}

// ── Writing ───────────────────────────────────────────────────────────────────
export interface EditRequest {
  className: string;
  stat: string;
  value: number | null; // null => reset to inherited (remove own getter)
}

export function applyEdit(req: EditRequest): { ok: true; file: string } {
  if (!STAT_KEYS.has(req.stat)) throw new Error(`unknown stat ${req.stat}`);
  const { byName } = buildIndex();
  const ci = byName.get(req.className);
  if (!ci) throw new Error(`unknown class ${req.className}`);

  let text = fs.readFileSync(ci.file, "utf8");
  const own = ci.getters[req.stat]; // present only if declared on THIS class

  if (req.value === null) {
    // reset: delete the leaf's own getter (if any); otherwise nothing to do
    if (own) text = text.slice(0, own.fullStart) + text.slice(own.fullEnd);
  } else if (own) {
    // replace the returned expression in place
    text = text.slice(0, own.exprStart) + String(req.value) + text.slice(own.exprEnd);
  } else {
    // insert a new getter. Match the codebase's single-line getter style.
    const getter = `protected get ${req.stat}() { return ${req.value}; }`;
    const at = ci.typePropEnd ?? ci.bodyStart;
    if (ci.singleLine) {
      text = text.slice(0, at) + ` ${getter}` + text.slice(at);
    } else {
      text = text.slice(0, at) + `\n${ci.indent}${getter}` + text.slice(at);
    }
  }

  fs.writeFileSync(ci.file, text);
  return { ok: true, file: rel(ci.file) };
}
