type KeyvLike = {
  get: (key: string) => Promise<any>;
  set: (key: string, value: any) => Promise<boolean>;
  delete: (key: string) => Promise<boolean>;
};

function baseUrl(): string {
  const url = process.env.CF_KV_BASE_URL;
  if (!url) throw new Error("CF_KV_BASE_URL is required when STORAGE_BACKEND=cloudflare");
  return url.replace(/\/$/, "");
}

function authHeaders(): Record<string, string> {
  const token = process.env.CF_STORE_TOKEN;
  if (!token) throw new Error("CF_STORE_TOKEN is required when STORAGE_BACKEND=cloudflare");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export function createCloudflareKeyvStore(): KeyvLike {
  return {
    async get(key: string) {
      const r = await fetch(`${baseUrl()}/_cf/kv/${encodeURIComponent(key)}`, {
        headers: authHeaders(),
      });
      if (!r.ok) throw new Error(`KV get failed: ${r.status}`);
      const data = (await r.json()) as { value?: string };
      if (data.value === undefined) return undefined;
      try {
        return JSON.parse(data.value);
      } catch {
        return data.value;
      }
    },

    async set(key: string, value: any) {
      const payload = JSON.stringify(value);
      const r = await fetch(`${baseUrl()}/_cf/kv/${encodeURIComponent(key)}`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ value: payload }),
      });
      if (!r.ok) throw new Error(`KV set failed: ${r.status}`);
      return true;
    },

    async delete(key: string) {
      const r = await fetch(`${baseUrl()}/_cf/kv/${encodeURIComponent(key)}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!r.ok && r.status !== 404) throw new Error(`KV delete failed: ${r.status}`);
      return true;
    },
  };
}
