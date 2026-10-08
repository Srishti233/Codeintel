import { describe, it, expect } from 'vitest';
import { scanFile, maskSecrets, securityScore } from '../src/security/scanner';
import { parseManifests } from '../src/security/deps';

describe('scanner', () => {
  it('finds and masks secrets', () => {
    const key = 'AKIAIOSFODNN7EXAMPLE';
    const f = scanFile('src/cfg.ts', `const k = "${key}";`);
    expect(f[0].ruleId).toBe('aws-access-key');
    expect(f[0].confidence).toBe('confirmed-static');
    expect(f[0].evidence).not.toContain(key);
    expect(maskSecrets(`x ${key} y`)).not.toContain(key);
  });
  it('flags injection / crypto patterns with honest confidence', () => {
    const f = scanFile('a.ts', 'db.query(`SELECT * FROM u WHERE id=${id}`)\ncreateHash("md5")\nel.innerHTML = x');
    const by = Object.fromEntries(f.map((x) => [x.ruleId, x.confidence]));
    expect(by['sql-concat']).toBe('probable');
    expect(by['weak-hash']).toBe('confirmed-static');
    expect(by['xss-sink']).toBe('probable');
  });
  it('ignores placeholders, env reads and test files', () => {
    expect(scanFile('a.ts', 'const password = process.env.PASSWORD_VALUE')).toHaveLength(0);
    expect(scanFile('a.ts', 'api_key = "your-api-key-here"')).toHaveLength(0);
    expect(scanFile('src/a.test.ts', 'eval("1")')).toHaveLength(0);
  });
  it('scores', () => {
    expect(securityScore([])).toBe(100);
    expect(securityScore([{ severity: 'critical' }, { severity: 'high' }])).toBe(72);
  });
});

describe('dependency parsing', () => {
  it('parses npm, pip, docker and prefers lockfile versions', () => {
    const deps = parseManifests([
      { path: 'package.json', text: JSON.stringify({ dependencies: { express: '^4.18.0' }, devDependencies: { vitest: '~2.0.1' } }) },
      { path: 'package-lock.json', text: JSON.stringify({ packages: { 'node_modules/express': { version: '4.19.2' } } }) },
      { path: 'requirements.txt', text: 'flask==2.0.1\n# c\nrequests>=2.31.0' },
      { path: 'Dockerfile', text: 'FROM node:20-slim AS b\nFROM scratch' },
    ]);
    expect(deps.find((d) => d.name === 'express')!.version).toBe('4.19.2');
    expect(deps.find((d) => d.name === 'vitest')).toMatchObject({ version: '2.0.1', isDev: true });
    expect(deps.find((d) => d.name === 'flask')!.version).toBe('2.0.1');
    expect(deps.find((d) => d.ecosystem === 'docker')).toMatchObject({ name: 'node', version: '20-slim' });
    expect(deps.filter((d) => d.ecosystem === 'docker')).toHaveLength(1);
  });
});
