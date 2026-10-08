export const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const getToken = () => (typeof window === 'undefined' ? null : localStorage.getItem('jwt'));

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(getToken() ? { authorization: `Bearer ${getToken()}` } : {}), ...init.headers },
  });
  if (res.status === 401 && path !== '/auth/token') { localStorage.removeItem('jwt'); location.href = '/'; }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  return res.status === 204 ? (undefined as T) : res.json();
}

export interface Source { path: string; startLine: number; endLine: number; symbol: string; kind: string; via: string[]; snippet: string }

/** POST + parse a Server-Sent Events stream (EventSource can't POST or send auth headers). */
export async function streamChat(
  repoId: string, message: string, conversationId: string | undefined,
  on: (event: string, data: any) => void, signal: AbortSignal,
) {
  const res = await fetch(`${API}/api/repos/${repoId}/chat`, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${getToken()}` },
    body: JSON.stringify({ message, conversationId }),
  });
  if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const ev = /^event: (.+)$/m.exec(block)?.[1]; const data = /^data: (.+)$/m.exec(block)?.[1];
      if (ev && data) on(ev, JSON.parse(data));
    }
  }
}
