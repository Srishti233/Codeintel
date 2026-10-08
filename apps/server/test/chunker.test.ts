import { describe, it, expect } from 'vitest';
import { chunkFile } from '../src/ingest/chunker';
import { resolveRelativeImport } from '../src/ingest/discover';

const TS = `import { db } from './db';
import fs from 'node:fs';

export const API_VERSION = 'v1';

export async function login(user: string): Promise<string> {
  return db.find(user);
}

export const hash = (s: string) => {
  return s.split('').reverse().join('');
};

export interface User { id: string }

export class Auth {
  verify(t: string) { return t.length > 3; }
  sign(u: User) { return u.id; }
}
`;

describe('chunker (tree-sitter)', () => {
  it('chunks TypeScript by symbols, not fixed sizes', async () => {
    const r = await chunkFile('typescript', TS, 'src/auth.ts');
    expect(r.parsed).toBe(true);
    const names = r.chunks.map((c) => c.symbolName);
    expect(names).toContain('login');
    expect(names).toContain('hash');
    expect(names).toContain('User');
    expect(names).toContain('Auth');
    const login = r.chunks.find((c) => c.symbolName === 'login')!;
    expect(login.startLine).toBe(6);
    expect(login.endLine).toBe(8);
    expect(login.content).toContain('db.find');
    expect(r.symbols.map((s) => s.name)).toEqual(expect.arrayContaining(['verify', 'sign']));
    expect(r.symbols.find((s) => s.name === 'verify')!.parent).toBe('Auth');
    expect(r.imports).toEqual(['./db', 'node:fs']);
  });

  it('chunks Python functions, classes and decorated defs', async () => {
    const py = `import os\nfrom .util import helper\n\ndef a():\n    return 1\n\nclass B:\n    def m(self):\n        return 2\n\n@deco\ndef c():\n    pass\n`;
    const r = await chunkFile('python', py, 'm.py');
    expect(r.chunks.map((c) => c.symbolName)).toEqual(expect.arrayContaining(['a', 'B', 'c']));
    expect(r.imports).toEqual(['os', '.util']);
  });

  it('splits oversized classes into header + member chunks', async () => {
    const methods = Array.from({ length: 30 }, (_, i) => `  m${i}() {\n    return ${i};\n    // pad\n  }`).join('\n');
    const r = await chunkFile('typescript', `class Big {\n${methods}\n}\n`, 'big.ts');
    const names = r.chunks.map((c) => c.symbolName);
    expect(names).toContain('m0');
    expect(r.chunks.find((c) => c.symbolName === 'm5')!.parent).toBe('Big');
  });

  it('falls back to paragraph chunks for non-code files', async () => {
    const r = await chunkFile('markdown', '# A\ntext\n\n# B\nmore', 'README.md');
    expect(r.parsed).toBe(false);
    expect(r.chunks.length).toBe(2);
  });

  it('resolves relative imports', () => {
    const known = new Set(['src/db.ts', 'src/lib/index.ts']);
    expect(resolveRelativeImport('src/auth.ts', './db', known)).toBe('src/db.ts');
    expect(resolveRelativeImport('src/auth.ts', './lib', known)).toBe('src/lib/index.ts');
    expect(resolveRelativeImport('src/auth.ts', './db.js', known)).toBe('src/db.ts');
    expect(resolveRelativeImport('src/auth.ts', 'react', known)).toBeNull();
  });
});
