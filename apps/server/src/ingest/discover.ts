import fs from 'node:fs/promises';
import path from 'node:path';
import { IGNORE_DIRS, IGNORE_FILES, detectLanguage } from './languages';

export interface DiscoveredFile { rel: string; abs: string; language: string; size: number }

export async function discoverFiles(root: string, maxBytes: number, maxFiles: number): Promise<DiscoveredFile[]> {
  const out: DiscoveredFile[] = [];
  async function walk(dir: string) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (out.length >= maxFiles) return;
      const abs = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (!IGNORE_DIRS.has(e.name)) await walk(abs);
        continue;
      }
      const rel = path.relative(root, abs).split(path.sep).join('/');
      const language = detectLanguage(rel);
      if (!language || IGNORE_FILES.test(rel)) {
        // keep lockfiles/manifests reachable for dependency analysis only
        continue;
      }
      const st = await fs.stat(abs);
      if (st.size > maxBytes || st.size === 0) continue;
      out.push({ rel, abs, language, size: st.size });
    }
  }
  await walk(root);
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

export function looksBinary(buf: Buffer): boolean {
  return buf.subarray(0, 1024).includes(0);
}

/** Resolve a relative JS/TS import specifier to a known repo file path. */
export function resolveRelativeImport(fromPath: string, spec: string, known: Set<string>): string | null {
  if (!spec.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), spec));
  const candidates = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '/index.ts', '/index.tsx', '/index.js'];
  for (const c of candidates) if (known.has(base + c)) return base + c;
  // ESM style "./foo.js" that points at foo.ts
  const noExt = base.replace(/\.(js|jsx|mjs)$/, '');
  for (const c of ['.ts', '.tsx']) if (known.has(noExt + c)) return noExt + c;
  return null;
}
