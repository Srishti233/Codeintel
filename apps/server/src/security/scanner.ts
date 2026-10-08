export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
/** confirmed-static: unambiguous pattern match. probable: risky pattern that needs data-flow confirmation. */
export type Confidence = 'confirmed-static' | 'probable' | 'ai-suspicion';

export interface Finding {
  ruleId: string; category: string; severity: Severity; confidence: Confidence;
  path: string; line: number; evidence: string; impact: string; fix: string;
}

interface Rule {
  id: string; category: string; severity: Severity; confidence: Confidence; re: RegExp;
  impact: string; fix: string; secret?: boolean;
}

const rules: Rule[] = [
  { id: 'aws-access-key', category: 'secrets', severity: 'critical', confidence: 'confirmed-static', secret: true,
    re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, impact: 'AWS credentials in source can be used to access your cloud account.', fix: 'Revoke the key, rotate it, and load it from a secret manager / environment.' },
  { id: 'github-token', category: 'secrets', severity: 'critical', confidence: 'confirmed-static', secret: true,
    re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, impact: 'GitHub token grants repository access.', fix: 'Revoke the token on GitHub and use environment variables.' },
  { id: 'private-key', category: 'secrets', severity: 'critical', confidence: 'confirmed-static', secret: true,
    re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g, impact: 'Private key committed to the repository.', fix: 'Remove from history, rotate the key pair, and store it outside git.' },
  { id: 'slack-token', category: 'secrets', severity: 'high', confidence: 'confirmed-static', secret: true,
    re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, impact: 'Slack token allows workspace API access.', fix: 'Revoke and rotate the token.' },
  { id: 'hardcoded-secret', category: 'secrets', severity: 'high', confidence: 'probable', secret: true,
    re: /(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*['"]([^'"\s]{8,})['"]/gi,
    impact: 'Hardcoded credential-like value.', fix: 'Move the value to environment/secret storage; rotate if real.' },
  { id: 'eval', category: 'injection', severity: 'high', confidence: 'probable', re: /\beval\s*\(|new\s+Function\s*\(/g,
    impact: 'Dynamic code execution can lead to remote code execution if input is attacker-controlled.', fix: 'Remove eval; use JSON.parse or explicit dispatch tables.' },
  { id: 'cmd-injection-js', category: 'injection', severity: 'high', confidence: 'probable',
    re: /\b(?:exec|execSync)\s*\(\s*(?:`[^`]*\$\{|[^)'"`\n]*\+)/g,
    impact: 'Shell command built from interpolated strings may allow command injection.', fix: 'Use execFile/spawn with an argument array and validate inputs.' },
  { id: 'cmd-injection-py', category: 'injection', severity: 'high', confidence: 'probable',
    re: /subprocess\.\w+\([^)\n]*shell\s*=\s*True|\bos\.system\s*\(/g,
    impact: 'Shell invocation may allow command injection.', fix: 'Pass an argument list without shell=True.' },
  { id: 'sql-concat', category: 'injection', severity: 'high', confidence: 'probable',
    re: /\b(?:query|execute|raw)\s*\(\s*(?:`[^`\n]*\$\{|f['"][^'"\n]*(?:SELECT|INSERT|UPDATE|DELETE)|['"][^'"\n]*(?:SELECT|INSERT|UPDATE|DELETE)[^'"\n]*['"]\s*\+)/gi,
    impact: 'String-built SQL may allow SQL injection.', fix: 'Use parameterized queries / prepared statements.' },
  { id: 'xss-sink', category: 'xss', severity: 'medium', confidence: 'probable',
    re: /\.innerHTML\s*=|dangerouslySetInnerHTML|document\.write\s*\(/g,
    impact: 'Unescaped HTML sink may enable XSS if content is user-controlled.', fix: 'Render text via textContent / framework escaping or sanitize with DOMPurify.' },
  { id: 'weak-hash', category: 'crypto', severity: 'medium', confidence: 'confirmed-static',
    re: /createHash\(\s*['"](?:md5|sha1)['"]\s*\)|hashlib\.(?:md5|sha1)\(/g,
    impact: 'MD5/SHA-1 are broken for security purposes (passwords, signatures).', fix: 'Use SHA-256+ and a password KDF (argon2/bcrypt/scrypt) for passwords.' },
  { id: 'insecure-random', category: 'crypto', severity: 'medium', confidence: 'probable',
    re: /(?:token|secret|password|session|nonce)[^\n]{0,40}Math\.random\(\)/gi,
    impact: 'Math.random is predictable and unsuitable for security tokens.', fix: 'Use crypto.randomBytes / secrets.token_urlsafe.' },
  { id: 'tls-verify-off', category: 'crypto', severity: 'high', confidence: 'confirmed-static',
    re: /rejectUnauthorized\s*:\s*false|verify\s*=\s*False|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/g,
    impact: 'Disabling TLS verification enables man-in-the-middle attacks.', fix: 'Enable certificate verification; trust a custom CA if needed.' },
  { id: 'ssrf', category: 'ssrf', severity: 'high', confidence: 'probable',
    re: /\b(?:fetch|axios\.(?:get|post)|requests\.(?:get|post)|http\.get)\(\s*(?:req\.|request\.|params|query|body|input)/g,
    impact: 'Outbound request to a user-controlled URL may allow SSRF.', fix: 'Allow-list hosts, block private IP ranges, and resolve DNS before connecting.' },
  { id: 'cors-wildcard', category: 'auth', severity: 'low', confidence: 'confirmed-static',
    re: /origin\s*:\s*['"]\*['"]|Access-Control-Allow-Origin['"]?\s*[:,]\s*['"]\*/g,
    impact: 'Wildcard CORS lets any origin read responses.', fix: 'Restrict to known origins, especially with credentials.' },
  { id: 'prompt-injection', category: 'prompt-injection', severity: 'low', confidence: 'probable',
    re: /(?:messages|prompt|system)[^\n]{0,60}\$\{[^}]*(?:req|user|input|body)[^}]*\}/gi,
    impact: 'User input interpolated into an LLM prompt may enable prompt injection.', fix: 'Delimit untrusted text, never place it in the system role, and validate model output.' },
];

const PLACEHOLDER = /(example|placeholder|changeme|your[_-]|xxxx|<[^>]+>|\$\{|process\.env|os\.environ|getenv|\*{4,}|dummy)/i;
const TEST_PATH = /(^|\/)(tests?|__tests__|spec|fixtures|examples?)\/|\.(test|spec)\.[a-z]+$|\.example$/i;

export function mask(s: string): string {
  return s.length <= 8 ? '••••' : s.slice(0, 4) + '••••[masked]';
}

/** Mask anything that looks like a secret. Applied before repo content is displayed or sent to a model. */
export function maskSecrets(text: string): string {
  let out = text;
  for (const r of rules.filter((r) => r.secret)) {
    out = out.replace(new RegExp(r.re.source, r.re.flags), (m: string, g1?: unknown) => {
      if (typeof g1 === 'string' && PLACEHOLDER.test(g1)) return m;
      return typeof g1 === 'string' ? m.replace(g1, mask(g1)) : mask(m);
    });
  }
  return out;
}

export function scanFile(path: string, text: string): Finding[] {
  const out: Finding[] = [];
  const isTest = TEST_PATH.test(path);
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 2000) continue;
    for (const r of rules) {
      if (isTest && !r.secret) continue;
      if (isTest && r.id === 'hardcoded-secret') continue;
      const m = new RegExp(r.re.source, r.re.flags).exec(line);
      if (!m) continue;
      if (r.id === 'hardcoded-secret' && PLACEHOLDER.test(m[1])) continue;
      out.push({
        ruleId: r.id, category: r.category, severity: r.severity, confidence: r.confidence,
        path, line: i + 1, evidence: maskSecrets(line.trim()).slice(0, 180), impact: r.impact, fix: r.fix,
      });
    }
  }
  return out;
}

const WEIGHT: Record<Severity, number> = { critical: 20, high: 8, medium: 3, low: 1, info: 0 };
export function securityScore(findings: Pick<Finding, 'severity'>[]): number {
  const penalty = findings.reduce((a, f) => a + WEIGHT[f.severity], 0);
  return Math.max(0, Math.round(100 - Math.min(100, penalty)));
}
