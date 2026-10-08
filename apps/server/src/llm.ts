import crypto from 'node:crypto';
import { config } from './config';
import { redis } from './redis';

/** Local-only LLM provider (Ollama). Swap models via CHAT_MODEL / EMBED_MODEL. */
export async function embed(texts: string[]): Promise<number[][]> {
  const res = await fetch(`${config.OLLAMA_URL}/api/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: config.EMBED_MODEL, input: texts.map((t) => t.slice(0, 6000)) }),
  });
  if (!res.ok) {
    throw new Error(
      `Ollama embed failed (${res.status}). Is the model pulled? ` +
        `Run: docker compose exec ollama ollama pull ${config.EMBED_MODEL}. ${(await res.text()).slice(0, 200)}`,
    );
  }
  const json = (await res.json()) as { embeddings: number[][] };
  for (const e of json.embeddings) {
    if (e.length !== config.EMBED_DIM) {
      throw new Error(`Embedding dim ${e.length} != EMBED_DIM ${config.EMBED_DIM}. Fix EMBED_DIM and recreate the DB volume.`);
    }
  }
  return json.embeddings;
}

/** Query embeddings are cached in Redis. */
export async function embedQuery(q: string): Promise<number[]> {
  const key = 'qemb:' + crypto.createHash('sha1').update(config.EMBED_MODEL + '\n' + q).digest('hex');
  const hit = await redis.get(key);
  if (hit) return JSON.parse(hit);
  const [v] = await embed([q]);
  await redis.set(key, JSON.stringify(v), 'EX', 3600);
  return v;
}

export interface ChatMsg { role: 'system' | 'user' | 'assistant'; content: string }

export async function* chatStream(messages: ChatMsg[], signal?: AbortSignal): AsyncGenerator<string> {
  const res = await fetch(`${config.OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: config.CHAT_MODEL, messages, stream: true, options: { temperature: 0.1 } }),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`Ollama chat failed (${res.status}). Pull the model: ollama pull ${config.CHAT_MODEL}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const j = JSON.parse(line) as { message?: { content?: string }; error?: string };
      if (j.error) throw new Error(j.error);
      if (j.message?.content) yield j.message.content;
    }
  }
}
