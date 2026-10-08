import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';

const run = promisify(execFile);

/** Shallow clone. The token is passed only in the URL for the clone, then removed from .git/config. */
export async function cloneRepo(cloneUrl: string, branch: string, dest: string, token?: string): Promise<string> {
  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(dest, { recursive: true });
  const authed = token ? cloneUrl.replace('https://', `https://x-access-token:${token}@`) : cloneUrl;
  try {
    await run('git', ['clone', '--depth', '1', '--single-branch', '--branch', branch, authed, dest], {
      timeout: 10 * 60_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  } catch (e) {
    const msg = String((e as Error).message);
    throw new Error(token ? msg.split(token).join('***') : msg);
  }
  await run('git', ['-C', dest, 'remote', 'set-url', 'origin', cloneUrl]);
  const { stdout } = await run('git', ['-C', dest, 'rev-parse', 'HEAD']);
  return stdout.trim();
}
