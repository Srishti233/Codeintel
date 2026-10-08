import Parser from 'web-tree-sitter';
import path from 'node:path';
import { PARSEABLE, extractImports } from './languages';

export interface Chunk {
  symbolName: string;
  symbolKind: string;
  parent: string | null;
  startLine: number; // 1-based, inclusive
  endLine: number;
  content: string;
}
export interface SymbolInfo { name: string; kind: string; parent: string | null; startLine: number; endLine: number }
export interface ChunkResult { chunks: Chunk[]; symbols: SymbolInfo[]; imports: string[]; parsed: boolean }

type Node = Parser.SyntaxNode;

let ready: Promise<void> | null = null;
const langs = new Map<string, Promise<Parser.Language>>();

function loadLang(name: string): Promise<Parser.Language> {
  ready ??= Parser.init();
  let p = langs.get(name);
  if (!p) {
    p = ready.then(() =>
      Parser.Language.load(require.resolve(`tree-sitter-wasms/out/tree-sitter-${name}.wasm`)),
    );
    langs.set(name, p);
  }
  return p;
}

const NODE_KIND: Record<string, string> = {
  function_declaration: 'function', generator_function_declaration: 'function',
  function_definition: 'function', function_item: 'function', method_declaration: 'method',
  method_definition: 'method', class_declaration: 'class', abstract_class_declaration: 'class',
  class_definition: 'class', interface_declaration: 'interface', type_alias_declaration: 'type',
  enum_declaration: 'enum', enum_item: 'enum', struct_item: 'struct', trait_item: 'trait',
  impl_item: 'impl', type_declaration: 'type', constructor_declaration: 'method',
};
const CONTAINERS = new Set(['class', 'impl', 'trait']);
const FN_VALUES = new Set(['arrow_function', 'function_expression', 'function', 'generator_function']);

const SMALL_CLASS_LINES = 80;
const LARGE_SYMBOL_LINES = 300;
const PART_LINES = 120;

function nameOf(n: Node): string | null {
  const f = n.childForFieldName('name');
  if (f) return f.text;
  if (n.type === 'impl_item') return 'impl ' + (n.childForFieldName('type')?.text ?? '');
  if (n.type === 'type_declaration') {
    const spec = n.namedChildren.find((c) => c.type === 'type_spec');
    return spec?.childForFieldName('name')?.text ?? null;
  }
  return null;
}

function classify(n: Node): { kind: string; name: string } | null {
  if (n.type === 'lexical_declaration' || n.type === 'variable_declaration') {
    for (const d of n.namedChildren) {
      if (d.type !== 'variable_declarator') continue;
      const v = d.childForFieldName('value');
      if (v && FN_VALUES.has(v.type)) return { kind: 'function', name: d.childForFieldName('name')?.text ?? 'anonymous' };
    }
    return null;
  }
  const kind = NODE_KIND[n.type];
  if (!kind) return null;
  return { kind, name: nameOf(n) ?? '(anonymous)' };
}

const startLine = (n: Node) => n.startPosition.row + 1;
const endLine = (n: Node) => n.endPosition.row + 1;

function parseWithTree(root: Node, lines: string[], filePath: string): { chunks: Chunk[]; symbols: SymbolInfo[] } {
  const chunks: Chunk[] = [];
  const symbols: SymbolInfo[] = [];
  const covered = new Array<boolean>(lines.length + 2).fill(false);
  const slice = (a: number, b: number) => lines.slice(a - 1, b).join('\n');

  const emit = (name: string, kind: string, parent: string | null, a: number, b: number) => {
    chunks.push({ symbolName: name, symbolKind: kind, parent, startLine: a, endLine: b, content: slice(a, b) });
    for (let i = a; i <= b; i++) covered[i] = true;
  };

  const visit = (container: Node, parent: string | null, emitChunks: boolean) => {
    for (const child of container.namedChildren) {
      let n = child;
      if (n.type === 'export_statement' || n.type === 'decorated_definition') {
        const inner = n.childForFieldName('declaration') ?? n.childForFieldName('definition');
        if (inner) n = inner;
      }
      const c = classify(n);
      if (!c) continue;
      const kind = parent && c.kind === 'function' ? 'method' : c.kind;
      const a = startLine(child), b = endLine(child);
      symbols.push({ name: c.name, kind, parent, startLine: a, endLine: b });
      const body = n.childForFieldName('body');

      if (CONTAINERS.has(kind)) {
        if (b - a + 1 <= SMALL_CLASS_LINES) {
          if (emitChunks) emit(c.name, kind, parent, a, b);
          if (body) visit(body, c.name, false);
        } else {
          // Large container: header chunk (up to first member) + one chunk per member.
          const first = body?.namedChildren[0];
          if (emitChunks && first && startLine(first) > a) emit(c.name, kind, parent, a, startLine(first) - 1);
          visit(body ?? n, c.name, emitChunks);
        }
        continue;
      }
      if (!emitChunks) continue;

      if (b - a + 1 > LARGE_SYMBOL_LINES && body && body.namedChildren.length > 1) {
        // Split oversized symbol at statement boundaries.
        const parts: [number, number][] = [];
        let ps = a;
        for (const st of body.namedChildren) {
          if (endLine(st) - ps + 1 > PART_LINES && startLine(st) > ps) {
            parts.push([ps, startLine(st) - 1]);
            ps = startLine(st);
          }
        }
        parts.push([ps, b]);
        parts.forEach(([x, y], i) => emit(`${c.name} (part ${i + 1}/${parts.length})`, kind, parent, x, y));
      } else {
        emit(c.name, kind, parent, a, b);
      }
    }
  };
  visit(root, null, true);

  // Uncovered top-level code (imports, constants, scripts) → module chunks.
  const base = path.basename(filePath);
  let i = 1;
  while (i <= lines.length) {
    if (covered[i]) { i++; continue; }
    let j = i;
    while (j + 1 <= lines.length && !covered[j + 1]) j++;
    const text = slice(i, j);
    if (text.split('\n').filter((l) => l.trim()).length >= 2) {
      chunks.push({ symbolName: base, symbolKind: 'module', parent: null, startLine: i, endLine: j, content: text });
    }
    i = j + 1;
  }
  chunks.sort((x, y) => x.startLine - y.startLine);
  return { chunks, symbols };
}

/** Fallback for non-parseable files: pack whole paragraphs / markdown sections up to ~150 lines. */
function paragraphChunks(lines: string[], filePath: string): Chunk[] {
  const base = path.basename(filePath);
  const out: Chunk[] = [];
  const isMd = filePath.endsWith('.md');
  let start = 0;
  const flush = (end: number) => {
    const content = lines.slice(start, end).join('\n');
    if (content.trim()) {
      out.push({ symbolName: base, symbolKind: 'module', parent: null, startLine: start + 1, endLine: end, content });
    }
    start = end;
  };
  for (let i = 0; i < lines.length; i++) {
    const breakHere =
      (isMd && /^#{1,3}\s/.test(lines[i]) && i > start) ||
      (i - start >= 150 && lines[i].trim() === '');
    if (breakHere) flush(i);
  }
  flush(lines.length);
  return out;
}

export async function chunkFile(language: string, text: string, filePath: string): Promise<ChunkResult> {
  const lines = text.split('\n');
  const imports = extractImports(language, text);
  if (PARSEABLE.has(language)) {
    try {
      const lang = await loadLang(language); // also awaits Parser.init()
      const parser = new Parser();
      parser.setLanguage(lang);
      const tree = parser.parse(text);
      const { chunks, symbols } = parseWithTree(tree.rootNode, lines, filePath);
      tree.delete();
      parser.delete();
      if (chunks.length) return { chunks, symbols, imports, parsed: true };
    } catch (e) {
      if (process.env.CHUNKER_DEBUG) console.error('chunker parse failed', e);
    }
  }
  return { chunks: paragraphChunks(lines, filePath), symbols: [], imports, parsed: false };
}
