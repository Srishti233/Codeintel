export interface Dep { ecosystem: 'npm' | 'PyPI' | 'Go' | 'docker'; name: string; version: string | null; isDev: boolean; manifest: string }
export interface DepVuln { id: string }

const pin = (v: string | undefined): string | null => {
  const m = v?.match(/^[~^=]?\s*(\d+\.\d+\.\d+(?:[-+][\w.]+)?)$/);
  return m ? m[1] : null;
};

export function parseManifests(files: { path: string; text: string }[]): Dep[] {
  const deps: Dep[] = [];
  const lockVersions = new Map<string, Map<string, string>>(); // dir -> name -> version
  for (const f of files) {
    if (f.path.endsWith('package-lock.json')) {
      try {
        const j = JSON.parse(f.text) as { packages?: Record<string, { version?: string }> };
        const dir = f.path.replace(/package-lock\.json$/, '');
        const m = new Map<string, string>();
        for (const [k, v] of Object.entries(j.packages ?? {})) {
          if (k.startsWith('node_modules/') && v.version && !k.slice(13).includes('node_modules/')) m.set(k.slice(13), v.version);
        }
        lockVersions.set(dir, m);
      } catch { /* ignore malformed lockfile */ }
    }
  }
  for (const f of files) {
    const base = f.path.split('/').pop() ?? '';
    const dir = f.path.slice(0, f.path.length - base.length);
    if (base === 'package.json') {
      try {
        const j = JSON.parse(f.text) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
        for (const [isDev, group] of [[false, j.dependencies], [true, j.devDependencies]] as const) {
          for (const [name, range] of Object.entries(group ?? {})) {
            deps.push({ ecosystem: 'npm', name, version: lockVersions.get(dir)?.get(name) ?? pin(range), isDev, manifest: f.path });
          }
        }
      } catch { /* ignore */ }
    } else if (/^requirements.*\.txt$/.test(base)) {
      for (const line of f.text.split('\n')) {
        const m = line.trim().match(/^([A-Za-z0-9_.-]+)\s*(?:==|>=|~=)\s*([\w.]+)/);
        if (m) deps.push({ ecosystem: 'PyPI', name: m[1], version: m[2], isDev: false, manifest: f.path });
      }
    } else if (base === 'go.mod') {
      for (const m of f.text.matchAll(/^\s*(?:require\s+)?([\w.\-/]+\.[\w.\-/]+)\s+(v[\w.+-]+)/gm)) {
        deps.push({ ecosystem: 'Go', name: m[1], version: m[2], isDev: false, manifest: f.path });
      }
    } else if (base === 'Dockerfile' || base.startsWith('Dockerfile.')) {
      for (const m of f.text.matchAll(/^\s*FROM\s+(?:--platform=\S+\s+)?([^\s]+)/gim)) {
        const [name, tag] = m[1].split(':');
        if (name !== 'scratch') deps.push({ ecosystem: 'docker', name, version: tag ?? 'latest', isDev: false, manifest: f.path });
      }
    }
  }
  return deps;
}

/** Free vulnerability lookup via OSV.dev (no API key). Failures are non-fatal (e.g. offline). */
export async function lookupVulns(deps: Dep[]): Promise<Map<string, DepVuln[]>> {
  const result = new Map<string, DepVuln[]>();
  const queryable = deps.filter((d) => d.version && d.ecosystem !== 'docker');
  for (let i = 0; i < queryable.length; i += 500) {
    const batch = queryable.slice(i, i + 500);
    try {
      const res = await fetch('https://api.osv.dev/v1/querybatch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          queries: batch.map((d) => ({ package: { name: d.name, ecosystem: d.ecosystem }, version: d.version!.replace(/^v/, '') })),
        }),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as { results: { vulns?: { id: string }[] }[] };
      json.results.forEach((r, idx) => {
        if (r.vulns?.length) result.set(`${batch[idx].manifest}|${batch[idx].name}`, r.vulns.map((v) => ({ id: v.id })));
      });
    } catch { /* offline: skip */ }
  }
  return result;
}
