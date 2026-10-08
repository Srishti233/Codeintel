export interface GhRepo {
  full_name: string;
  clone_url: string;
  default_branch: string;
  private: boolean;
  description?: string | null;
  updated_at?: string;
}

export async function gh<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'codeintel',
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}
