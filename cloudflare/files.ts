import { getSessionUser } from "./auth";

export type FileEnv = {
  DB: D1Database;
  STORAGE: R2Bucket;
};

export type BagFile = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  chatId: string;
  source: "canvas" | "upload";
  created: number;
};

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function guessMime(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".odt")) return "application/vnd.oasis.opendocument.text";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "text/markdown";
  if (lower.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}

function displayName(key: string, prefix: string): string {
  const raw = key.startsWith(prefix) ? key.slice(prefix.length) : key.split("/").pop() || key;
  return raw.replace(/^\d+-/, "") || raw;
}

function isExtractSidecar(key: string): boolean {
  return /\.(pdf|docx?|odt|md|markdown)\.txt$/i.test(key);
}

export function userUploadsPrefix(userId: string): string {
  return `users/${userId}/uploads/`;
}

export function groupFilesPrefix(groupId: string): string {
  return `groups/${groupId}/files/`;
}

export function sanitizeFileName(filename: string): string {
  return filename.replace(/[<>:"/\\|?*\x00-\x1f]+/g, "_").trim().slice(0, 180) || "file";
}

export async function putUserUpload(
  env: FileEnv,
  userId: string,
  file: { filename: string; mimeType: string; bytes: ArrayBuffer },
  source: "canvas" | "upload" = "upload"
): Promise<BagFile> {
  const name = sanitizeFileName(file.filename);
  const key = `${userUploadsPrefix(userId)}${Date.now()}-${name}`;
  await env.STORAGE.put(key, file.bytes, {
    httpMetadata: { contentType: file.mimeType || guessMime(name) },
    customMetadata: { source, filename: name },
  });
  return {
    id: key,
    filename: name,
    mimeType: file.mimeType || guessMime(name),
    size: file.bytes.byteLength,
    chatId: "",
    source,
    created: Date.now(),
  };
}

function unwrapKeyv(raw: unknown): unknown {
  let cur = raw;
  for (let i = 0; i < 5; i++) {
    if (typeof cur === "string") {
      try {
        cur = JSON.parse(cur);
        continue;
      } catch {
        return cur;
      }
    }
    if (cur && typeof cur === "object" && !Array.isArray(cur) && "value" in cur) {
      cur = (cur as { value: unknown }).value;
      continue;
    }
    return cur;
  }
  return cur;
}

async function loadLibraryIndex(db: D1Database, userId: string): Promise<BagFile[]> {
  const keys = [`keyv:user:${userId}:library-files`, `user:${userId}:library-files`];
  for (const key of keys) {
    const row = await db.prepare("SELECT value FROM kv WHERE key = ?").bind(key).first<{ value: string }>();
    const parsed = unwrapKeyv(row?.value);
    if (!Array.isArray(parsed)) continue;
    return parsed
      .map((item) => {
        const file = item as Partial<BagFile>;
        const filename = String(file.filename || "").trim();
        if (!filename) return null;
        return {
          id: String(file.id || filename),
          filename,
          mimeType: String(file.mimeType || guessMime(filename)),
          size: Number(file.size || 0),
          chatId: String(file.chatId || ""),
          source: file.source === "canvas" ? "canvas" : "upload",
          created: Number(file.created || Date.now()),
        } satisfies BagFile;
      })
      .filter((file): file is BagFile => Boolean(file));
  }
  return [];
}

async function listR2Uploads(env: FileEnv, userId: string): Promise<BagFile[]> {
  const prefix = userUploadsPrefix(userId);
  const files: BagFile[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.STORAGE.list({ prefix, cursor, limit: 100 });
    for (const obj of page.objects) {
      if (!obj.key || obj.key.endsWith("/") || isExtractSidecar(obj.key)) continue;
      const meta = obj.customMetadata || {};
      const filename = meta.filename || displayName(obj.key, prefix);
      files.push({
        id: obj.key,
        filename,
        mimeType: obj.httpMetadata?.contentType || guessMime(filename),
        size: obj.size,
        chatId: meta.chatId || "",
        source: meta.source === "canvas" ? "canvas" : "upload",
        created: obj.uploaded?.getTime?.() || Date.now(),
      });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return files;
}

export async function listUserUploads(env: FileEnv, userId: string): Promise<BagFile[]> {
  const [fromR2, fromIndex] = await Promise.all([
    listR2Uploads(env, userId),
    loadLibraryIndex(env.DB, userId),
  ]);
  const byName = new Map<string, BagFile>();
  for (const file of fromIndex) byName.set(file.filename.toLowerCase(), file);
  for (const file of fromR2) {
    const name = file.filename.toLowerCase();
    const prev = byName.get(name);
    byName.set(name, prev ? { ...prev, ...file, chatId: file.chatId || prev.chatId } : file);
  }
  return [...byName.values()].sort((a, b) => b.created - a.created);
}

function candidateKeys(userId: string, rawKey: string): string[] {
  const clean = decodeURIComponent(rawKey).replace(/\\/g, "/").replace(/^\/+/, "");
  if (!clean || clean.includes("..")) return [];
  const prefix = userUploadsPrefix(userId);
  const keys: string[] = [];
  if (clean.startsWith(prefix) || clean.startsWith(`users/${userId}/`)) keys.push(clean);
  if (clean.startsWith("uploads/")) {
    keys.push(`${prefix}${clean.slice("uploads/".length)}`);
    keys.push(`users/${userId}/${clean}`);
    keys.push(clean);
  }
  if (!clean.includes("/")) keys.push(`${prefix}${clean}`);
  return [...new Set(keys)];
}

async function resolveOwnedKey(env: FileEnv, userId: string, rawKey: string): Promise<string | null> {
  const wanted = decodeURIComponent(rawKey || "");
  const files = await listUserUploads(env, userId);
  const match = files.find((file) => file.id === wanted || file.id.endsWith(`/${wanted}`) || file.filename === wanted);
  const tryKeys = [
    ...candidateKeys(userId, rawKey),
    ...(match ? candidateKeys(userId, match.id) : []),
    ...(match?.id && !match.id.includes("..") ? [match.id] : []),
  ];
  for (const key of [...new Set(tryKeys)]) {
    const obj = await env.STORAGE.head(key);
    if (obj) return key;
  }
  return null;
}

export async function handleFileLibraryRoutes(
  request: Request,
  env: FileEnv,
  pathname: string
): Promise<Response | null> {
  const isApi = pathname === "/api/files" || pathname.startsWith("/api/files/");
  const isLegacy = pathname === "/files" || pathname.startsWith("/files/");
  if (!isApi && !isLegacy) return null;

  const user = await getSessionUser(request, env.DB);
  if (!user) {
    return json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);

  if ((pathname === "/api/files" || pathname === "/files") && request.method === "GET") {
    const files = await listUserUploads(env, user.id);
    return json({ ok: true, files });
  }

  if ((pathname === "/api/files" || pathname === "/files") && request.method === "DELETE") {
    const files = await listUserUploads(env, user.id);
    await Promise.all(files.map((file) => env.STORAGE.delete(file.id)));
    return json({ ok: true });
  }

  if (pathname === "/api/files/object" || pathname === "/files/object") {
    const key = await resolveOwnedKey(env, user.id, url.searchParams.get("key") || "");
    if (!key) return json({ error: "not found" }, { status: 404 });
    if (request.method === "DELETE") {
      await env.STORAGE.delete(key);
      return json({ ok: true });
    }
    if (request.method === "GET") {
      const obj = await env.STORAGE.get(key);
      if (!obj) return json({ error: "not found" }, { status: 404 });
      const name = obj.customMetadata?.filename || displayName(key, userUploadsPrefix(user.id));
      const headers = new Headers();
      headers.set("Content-Type", obj.httpMetadata?.contentType || guessMime(name));
      headers.set("Content-Disposition", `attachment; filename="${name.replace(/"/g, "")}"`);
      return new Response(obj.body, { headers });
    }
  }

  return json({ error: "not found" }, { status: 404 });
}
