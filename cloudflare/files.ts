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

export async function listUserUploads(env: FileEnv, userId: string): Promise<BagFile[]> {
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
  files.sort((a, b) => b.created - a.created);
  const seen = new Set<string>();
  return files.filter((file) => {
    const name = file.filename.toLowerCase();
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

function assertOwnKey(userId: string, key: string): string | null {
  const clean = decodeURIComponent(key);
  if (clean.includes("..") || !clean.startsWith(userUploadsPrefix(userId))) return null;
  return clean;
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
    const key = assertOwnKey(user.id, url.searchParams.get("key") || "");
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
