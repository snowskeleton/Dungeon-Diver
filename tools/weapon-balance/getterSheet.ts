// Generic static analyzer + source editor for the getter-class content families
// (weapons and ammo — both `Base → category base → concrete` chains of getter
// overrides, both with the alias collisions where a concrete shares its name
// with its category base). One core, parameterised by a SheetConfig; weaponData
// and ammoData are thin configs over it.
//
// Reads classes with the TypeScript compiler API (no game code runs), resolves
// each numeric stat getter up the `extends` chain — through each file's import
// bindings, keying classes by file+name so aliases (`class Spear extends
// SpearBase`) resolve correctly — and records which class declared each so the
// UI shows inherited-vs-specific. Writes are precise AST-span splices.

import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

const REPO_ROOT = path.resolve(__dirname, "../..");
const rel = (p: string) => path.relative(REPO_ROOT, p);

export interface StatMeta {
  key: string;
  label: string;
  unit: string;
}

export interface SheetConfig {
  domain: string;
  title: string;
  /** Absolute root dir to scan (e.g. shared/src/weapons). */
  dir: string;
  stats: StatMeta[];
  /** Group for a concrete class whose `category` getter chain yields nothing. */
  noCategoryGroup: string;
}

// ── Parsed model ──────────────────────────────────────────────────────────────
interface GetterInfo {
  fullStart: number;
  fullEnd: number;
  exprStart: number;
  exprEnd: number;
  value: number | null;
}
interface ClassInfo {
  key: string; // absFile + "::" + name
  name: string;
  absFile: string;
  extendsLocal: string | null;
  id: string | null; // `readonly id = "..."` → concrete
  category: string | null; // `get category() { return "..."; }` declared here
  bodyStart: number;
  singleLine: boolean;
  indent: string;
  anchorEnd: number; // end of the `name` (or `id`) property, for insertion
  getters: Record<string, GetterInfo>;
}
type ImportMap = Map<string, { absTarget: string; exportName: string }>;

const keyOf = (absFile: string, name: string) => `${absFile}::${name}`;

/** Every source file under `dir` that can declare a class: any base.ts, plus any
 *  index.ts that is NOT the aggregate registry (i.e. not an immediate child of
 *  `dir`). Concrete content lives at <…>/<id>/index.ts; the root index.ts is the
 *  registry and is skipped. */
function classFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "base.ts") out.push(p);
      else if (e.name === "index.ts" && path.dirname(p) !== dir) out.push(p);
    }
  };
  walk(dir);
  return out;
}

function resolveModule(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const cand of [base + ".ts", path.join(base, "index.ts")]) {
    if (fs.existsSync(cand)) return cand;
  }
  return null;
}

function numericFromExpr(expr: ts.Expression, consts: Record<string, number>): number | null {
  if (ts.isNumericLiteral(expr)) return Number(expr.text);
  if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.MinusToken) {
    const inner = numericFromExpr(expr.operand, consts);
    return inner === null ? null : -inner;
  }
  if (ts.isAsExpression(expr)) return numericFromExpr(expr.expression, consts);
  if (ts.isIdentifier(expr) && expr.text in consts) return consts[expr.text];
  return null;
}

interface ParsedFile {
  classes: ClassInfo[];
  imports: ImportMap;
}
function parseFile(absFile: string, statKeys: Set<string>): ParsedFile {
  const text = fs.readFileSync(absFile, "utf8");
  const sf = ts.createSourceFile(absFile, text, ts.ScriptTarget.Latest, true);

  const consts: Record<string, number> = {};
  const imports: ImportMap = new Map();
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && ts.isNumericLiteral(d.initializer)) {
          consts[d.name.text] = Number(d.initializer.text);
        }
      }
    }
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const target = resolveModule(absFile, st.moduleSpecifier.text);
      const named = st.importClause?.namedBindings;
      if (target && named && ts.isNamedImports(named)) {
        for (const el of named.elements) {
          imports.set(el.name.text, { absTarget: target, exportName: el.propertyName?.text ?? el.name.text });
        }
      }
    }
  }

  const classes: ClassInfo[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isClassDeclaration(node) && node.name) {
      const heritage = node.heritageClauses?.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword);
      const baseExpr = heritage?.types[0]?.expression;
      const extendsLocal = baseExpr && ts.isIdentifier(baseExpr) ? baseExpr.text : null;

      const info: ClassInfo = {
        key: keyOf(absFile, node.name.text),
        name: node.name.text,
        absFile,
        extendsLocal,
        id: null,
        category: null,
        bodyStart: node.members.pos,
        singleLine:
          sf.getLineAndCharacterOfPosition(node.getStart(sf)).line ===
          sf.getLineAndCharacterOfPosition(node.end).line,
        indent: "  ",
        anchorEnd: node.members.pos,
        getters: {},
      };
      let idPropEnd: number | null = null;
      let namePropEnd: number | null = null;

      for (const m of node.members) {
        if (ts.isPropertyDeclaration(m) && ts.isIdentifier(m.name)) {
          if (m.name.text === "id") {
            idPropEnd = m.end;
            if (m.initializer && ts.isStringLiteral(m.initializer)) info.id = m.initializer.text;
            const line = text.split("\n")[sf.getLineAndCharacterOfPosition(m.getStart(sf)).line];
            const lead = line.match(/^\s*/);
            if (lead) info.indent = lead[0];
          }
          if (m.name.text === "name") namePropEnd = m.end;
        }
        if (ts.isGetAccessorDeclaration(m) && ts.isIdentifier(m.name)) {
          const gk = m.name.text;
          const ret = m.body?.statements[0];
          if (gk === "category" && ret && ts.isReturnStatement(ret) && ret.expression) {
            const s = ts.isStringLiteral(ret.expression)
              ? ret.expression
              : ts.isAsExpression(ret.expression) && ts.isStringLiteral(ret.expression.expression)
                ? ret.expression.expression
                : null;
            if (s) info.category = s.text;
          }
          if (!statKeys.has(gk)) continue;
          let value: number | null = null;
          let exprStart = m.getStart(sf);
          let exprEnd = m.end;
          if (ret && ts.isReturnStatement(ret) && ret.expression) {
            value = numericFromExpr(ret.expression, consts);
            exprStart = ret.expression.getStart(sf);
            exprEnd = ret.expression.end;
          }
          info.getters[gk] = { fullStart: m.getFullStart(), fullEnd: m.end, exprStart, exprEnd, value };
        }
      }
      info.anchorEnd = namePropEnd ?? idPropEnd ?? info.bodyStart;
      classes.push(info);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { classes, imports };
}

interface Index {
  byKey: Map<string, ClassInfo>;
  imports: Map<string, ImportMap>;
  byFile: Map<string, ClassInfo[]>;
}
function buildIndex(cfg: SheetConfig): Index {
  const statKeys = new Set(cfg.stats.map((s) => s.key));
  const byKey = new Map<string, ClassInfo>();
  const imports = new Map<string, ImportMap>();
  const byFile = new Map<string, ClassInfo[]>();
  for (const file of classFiles(cfg.dir)) {
    const pf = parseFile(file, statKeys);
    imports.set(file, pf.imports);
    byFile.set(file, pf.classes);
    for (const c of pf.classes) byKey.set(c.key, c);
  }
  return { byKey, imports, byFile };
}

function parentKey(ci: ClassInfo, idx: Index): string | null {
  if (!ci.extendsLocal) return null;
  const imp = idx.imports.get(ci.absFile)?.get(ci.extendsLocal);
  if (imp) {
    const target = idx.byFile.get(imp.absTarget)?.find((c) => c.name === imp.exportName);
    return target ? target.key : null;
  }
  const same = idx.byFile.get(ci.absFile)?.find((c) => c.name === ci.extendsLocal);
  return same ? same.key : null;
}

// ── Public model ──────────────────────────────────────────────────────────────
export interface StatCell {
  value: number | null;
  declaredIn: string | null;
  inherited: boolean;
  canReset: boolean; // an override here could be removed and still resolve upstream
}
export interface Row {
  key: string;
  className: string;
  id: string; // concrete id, or class name for base rows
  group: string; // category, noCategoryGroup, or "base"
  file: string;
  stats: Record<string, StatCell>;
}
export interface Sheet {
  domain: string;
  title: string;
  stats: StatMeta[];
  rows: Row[];
}
export interface EditRequest {
  key: string;
  stat: string;
  value: number | null;
}

function walkFrom(startKey: string | null, stat: string, idx: Index): { value: number | null; key: string; name: string } | null {
  let cur: ClassInfo | undefined = startKey ? idx.byKey.get(startKey) : undefined;
  while (cur) {
    const g = cur.getters[stat];
    if (g) return { value: g.value, key: cur.key, name: cur.name };
    const pk = parentKey(cur, idx);
    cur = pk ? idx.byKey.get(pk) : undefined;
  }
  return null;
}
function resolveStat(leafKey: string, stat: string, idx: Index): StatCell {
  const full = walkFrom(leafKey, stat, idx);
  if (!full) return { value: null, declaredIn: null, inherited: true, canReset: false };
  const inherited = full.key !== leafKey;
  let canReset = false;
  if (!inherited) {
    const pk = parentKey(idx.byKey.get(leafKey)!, idx);
    canReset = walkFrom(pk, stat, idx) !== null;
  }
  return { value: full.value, declaredIn: full.name, inherited, canReset };
}
function resolveCategory(leafKey: string, idx: Index, fallback: string): string {
  let cur: ClassInfo | undefined = idx.byKey.get(leafKey);
  while (cur) {
    if (cur.category) return cur.category;
    const pk = parentKey(cur, idx);
    cur = pk ? idx.byKey.get(pk) : undefined;
  }
  return fallback;
}

export function loadSheet(cfg: SheetConfig): Sheet {
  const idx = buildIndex(cfg);

  // Base classes = anything another class extends (roots + category bases).
  const baseKeys = new Set<string>();
  const isRoot = new Set<string>();
  for (const ci of idx.byKey.values()) {
    const pk = parentKey(ci, idx);
    if (pk) baseKeys.add(pk);
  }
  for (const bk of baseKeys) {
    const ci = idx.byKey.get(bk)!;
    if (!parentKey(ci, idx)) isRoot.add(bk); // a base with no parent = the family root
  }

  const rows: Row[] = [];
  const addRow = (ci: ClassInfo, id: string, group: string) => {
    const stats: Record<string, StatCell> = {};
    for (const s of cfg.stats) stats[s.key] = resolveStat(ci.key, s.key, idx);
    rows.push({ key: ci.key, className: ci.name, id, group, file: rel(ci.absFile), stats });
  };
  for (const bk of baseKeys) addRow(idx.byKey.get(bk)!, idx.byKey.get(bk)!.name, "base");
  for (const ci of idx.byKey.values()) {
    if (!ci.id) continue; // concrete only
    addRow(ci, ci.id, resolveCategory(ci.key, idx, cfg.noCategoryGroup));
  }

  // base first (roots ahead of category bases), then categories, noCategoryGroup last.
  const groupRank = (g: string) => (g === "base" ? 0 : g === cfg.noCategoryGroup ? 2 : 1);
  rows.sort((a, b) => {
    if (groupRank(a.group) !== groupRank(b.group)) return groupRank(a.group) - groupRank(b.group);
    if (a.group === "base") {
      const ra = isRoot.has(a.key) ? 0 : 1;
      const rb = isRoot.has(b.key) ? 0 : 1;
      return ra - rb || a.className.localeCompare(b.className);
    }
    if (a.group !== b.group) return a.group.localeCompare(b.group);
    return a.id.localeCompare(b.id);
  });
  return { domain: cfg.domain, title: cfg.title, stats: cfg.stats, rows };
}

export function applyEdit(cfg: SheetConfig, req: EditRequest): { ok: true; file: string } {
  if (!cfg.stats.some((s) => s.key === req.stat)) throw new Error(`unknown stat ${req.stat}`);
  const idx = buildIndex(cfg);
  const ci = idx.byKey.get(req.key);
  if (!ci) throw new Error(`unknown class ${req.key}`);

  let text = fs.readFileSync(ci.absFile, "utf8");
  const own = ci.getters[req.stat];

  if (req.value === null) {
    if (own) text = text.slice(0, own.fullStart) + text.slice(own.fullEnd);
  } else if (own) {
    text = text.slice(0, own.exprStart) + String(req.value) + text.slice(own.exprEnd);
  } else {
    const getter = `get ${req.stat}() { return ${req.value}; }`;
    const at = ci.anchorEnd;
    text = ci.singleLine
      ? text.slice(0, at) + ` ${getter}` + text.slice(at)
      : text.slice(0, at) + `\n${ci.indent}${getter}` + text.slice(at);
  }
  fs.writeFileSync(ci.absFile, text);
  return { ok: true, file: rel(ci.absFile) };
}
