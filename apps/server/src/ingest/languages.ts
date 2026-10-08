import path from 'node:path';

/** tree-sitter grammars we can parse (bundled by `tree-sitter-wasms`). */
export const PARSEABLE = new Set(['typescript', 'tsx', 'javascript', 'python', 'go', 'java', 'rust']);

const EXT: Record<string, string> = {
  '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript', '.tsx': 'tsx',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python', '.go': 'go', '.java': 'java', '.rs': 'rust',
  '.md': 'markdown', '.json': 'json', '.yml': 'yaml', '.yaml': 'yaml', '.toml': 'toml',
  '.sql': 'sql', '.sh': 'shell', '.html': 'html', '.css': 'css', '.scss': 'css',
  '.rb': 'ruby', '.php': 'php', '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.cs': 'csharp',
  '.kt': 'kotlin', '.swift': 'swift', '.tf': 'terraform', '.proto': 'protobuf',
  '.txt': 'text',
};

export function detectLanguage(file: string): string | null {
  const base = path.basename(file);
  if (base === 'Dockerfile' || base.startsWith('Dockerfile.')) return 'dockerfile';
  return EXT[path.extname(file).toLowerCase()] ?? null;
}

export const IGNORE_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', '.next', '.nuxt', 'vendor', 'target',
  '__pycache__', '.venv', 'venv', 'coverage', '.idea', '.vscode', '.turbo', '.cache', 'bin', 'obj',
]);

export const IGNORE_FILES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|go\.sum)$|\.min\.(js|css)$|\.map$/;

/** Extract import specifiers (best-effort, regex based). */
export function extractImports(language: string, text: string): string[] {
  const out = new Set<string>();
  const add = (s?: string) => s && out.add(s);
  let m: RegExpExecArray | null;
  if (language === 'typescript' || language === 'tsx' || language === 'javascript') {
    const re = /(?:import\s[^'"`]*?from\s*|import\s*\(?\s*|require\(\s*|export\s[^'"`]*?from\s*)['"]([^'"]+)['"]/g;
    while ((m = re.exec(text))) add(m[1]);
  } else if (language === 'python') {
    const re = /^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm;
    while ((m = re.exec(text))) add(m[1] ?? m[2]);
  } else if (language === 'go') {
    const re = /^\s*(?:import\s+)?(?:\w+\s+)?"([\w./-]+)"\s*$/gm;
    while ((m = re.exec(text))) add(m[1]);
  } else if (language === 'java') {
    const re = /^import\s+(?:static\s+)?([\w.]+);/gm;
    while ((m = re.exec(text))) add(m[1]);
  } else if (language === 'rust') {
    const re = /^\s*use\s+([\w:]+)/gm;
    while ((m = re.exec(text))) add(m[1]);
  }
  return [...out];
}
