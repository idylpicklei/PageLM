import { getContainer } from "@cloudflare/containers";
import { getSessionUser, type SessionUser } from "./auth";
import { canvasSearchFromRequest, courseFilesApiPath } from "./canvas-search";
import { consumeExternalQuota, externalRateLimitedResponse } from "./dap-rate-limit";
import { makeReplayableRequest } from "./replay-request";
import { listUserUploads, putUserUpload, userUploadsPrefix, type FileEnv } from "./files";

export type CanvasEnv = FileEnv & {
  CANVAS_TOKEN_KEY?: string;
  WORKER_PUBLIC_URL?: string;
  PAGELM_BACKEND: DurableObjectNamespace;
};

type StoredCanvasToken = {
  user_id: string;
  host: string;
  ciphertext: string;
  iv: string;
  last4: string;
};

type CanvasCredentials = {
  host: string;
  token: string;
  last4: string;
};

const MAX_IMPORT_FILES = 5;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_LIST_PAGES = 5;

const IMPORTABLE_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.oasis.opendocument.text",
]);

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function unauthorized(): Response {
  return json({ error: "unauthorized" }, { status: 401 });
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().replace(/\s+/g, "");
  if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length !== 64) {
    throw new Error("CANVAS_TOKEN_KEY must be 32 bytes as 64 hex characters");
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function b64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function importKey(env: CanvasEnv): Promise<CryptoKey> {
  const raw = hexToBytes(String(env.CANVAS_TOKEN_KEY || ""));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptToken(env: CanvasEnv, token: string): Promise<{ ciphertext: string; iv: string }> {
  const key = await importKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(token);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  return {
    ciphertext: bytesToB64(new Uint8Array(cipher)),
    iv: bytesToB64(iv),
  };
}

async function decryptToken(env: CanvasEnv, row: StoredCanvasToken): Promise<string> {
  const key = await importKey(env);
  const iv = b64ToBytes(row.iv);
  const cipher = b64ToBytes(row.ciphertext);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  return new TextDecoder().decode(plain);
}

export function normalizeCanvasHost(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = trimmed.includes("://") ? new URL(trimmed) : new URL(`https://${trimmed}`);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  if (url.search || url.hash) return null;

  const host = url.hostname.toLowerCase();
  if (!host || host.includes(" ")) return null;
  return `https://${host}`;
}

type CanvasFile = {
  id: number;
  display_name?: string;
  filename?: string;
  content_type?: string;
  "content-type"?: string;
  mime_class?: string;
  url?: string;
  size?: number;
  updated_at?: string;
};

function canvasFileName(file: CanvasFile): string {
  return file.display_name || file.filename || `File ${file.id}`;
}

function canvasFileContentType(file: CanvasFile): string {
  const fromApi = file["content-type"] || file.content_type || "";
  const ct = String(fromApi).split(";")[0].trim().toLowerCase();
  if (ct && ct !== "application/octet-stream" && ct !== "binary/octet-stream") return ct;

  const name = canvasFileName(file).toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (name.endsWith(".doc")) return "application/msword";
  if (name.endsWith(".odt")) return "application/vnd.oasis.opendocument.text";
  if (name.endsWith(".md") || name.endsWith(".markdown")) return "text/markdown";
  if (name.endsWith(".txt")) return "text/plain";

  const mimeClass = String(file.mime_class || "").toLowerCase();
  if (mimeClass === "pdf") return "application/pdf";
  if (mimeClass === "doc") return "application/msword";
  if (mimeClass === "text") return "text/plain";

  return ct || "application/octet-stream";
}

function isImportableFile(contentType: string, filename: string): boolean {
  const ct = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (IMPORTABLE_TYPES.has(ct)) return true;
  if (ct.endsWith(".document")) return true;

  const name = filename.toLowerCase();
  return (
    name.endsWith(".pdf") ||
    name.endsWith(".doc") ||
    name.endsWith(".docx") ||
    name.endsWith(".odt") ||
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".markdown")
  );
}

function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/i);
    if (match?.[1]) return match[1];
  }
  return null;
}

async function loadStoredToken(db: D1Database, userId: string): Promise<StoredCanvasToken | null> {
  return db
    .prepare("SELECT user_id, host, ciphertext, iv, last4 FROM canvas_tokens WHERE user_id = ?")
    .bind(userId)
    .first<StoredCanvasToken>();
}

async function getCredentials(env: CanvasEnv, userId: string): Promise<CanvasCredentials | null> {
  const row = await loadStoredToken(env.DB, userId);
  if (!row) return null;
  try {
    const token = await decryptToken(env, row);
    return { host: row.host, token, last4: row.last4 };
  } catch {
    await env.DB.prepare("DELETE FROM canvas_tokens WHERE user_id = ?").bind(userId).run();
    return null;
  }
}

async function clearStoredToken(db: D1Database, userId: string): Promise<void> {
  await db.prepare("DELETE FROM canvas_tokens WHERE user_id = ?").bind(userId).run();
}

function canvasHost(creds: CanvasCredentials): string {
  return new URL(creds.host).hostname;
}

async function canvasFetch(
  creds: CanvasCredentials,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const url = path.startsWith("http") ? path : `${creds.host}${path.startsWith("/") ? "" : "/"}${path}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${creds.token}`);
  return fetch(url, { ...init, headers });
}

async function canvasDownload(creds: CanvasCredentials, target: string): Promise<Response> {
  let parsed: URL;
  try {
    const url = target.startsWith("http") ? target : `${creds.host}${target.startsWith("/") ? "" : "/"}${target}`;
    parsed = new URL(url);
  } catch {
    return new Response(null, { status: 400 });
  }
  const headers = new Headers();
  if (parsed.hostname === canvasHost(creds)) {
    headers.set("Authorization", `Bearer ${creds.token}`);
  }
  return fetch(parsed.toString(), { headers, redirect: "follow" });
}

async function probeCanvasToken(
  db: D1Database,
  userId: string,
  host: string,
  token: string
): Promise<
  | { ok: true }
  | { ok: false; status: number; message: string; retryAfter?: number }
> {
  const quota = await consumeExternalQuota(db, userId, "canvas.lms.list");
  if (!quota.allowed) {
    return { ok: false, status: 429, message: quota.message, retryAfter: quota.retryAfter };
  }

  const res = await fetch(`${host}/api/v1/users/self`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.ok) return { ok: true };

  let message = "Invalid or expired Canvas token. Generate a new token in Canvas → Profile → Approved Integrations.";
  if (res.status === 401 || res.status === 403) {
    message = "Canvas rejected this token. Check your school URL and generate a new access token.";
  }
  try {
    const body = (await res.json()) as { errors?: Array<{ message?: string }>; message?: string };
    const errMsg = body?.errors?.[0]?.message || body?.message;
    if (errMsg) message = errMsg;
  } catch {
    // ignore parse errors
  }
  return { ok: false, status: res.status, message };
}

async function fetchPaginated<T>(
  creds: CanvasCredentials,
  initialPath: string
): Promise<{ items: T[]; authFailed: boolean; badResponse?: boolean }> {
  const items: T[] = [];
  let nextUrl: string | null = `${creds.host}${initialPath}`;
  let pages = 0;

  while (nextUrl && pages < MAX_LIST_PAGES) {
    const res = await canvasFetch(creds, nextUrl);
    if (res.status === 401 || res.status === 403) {
      return { items, authFailed: true };
    }
    if (!res.ok) break;

    let batch: unknown;
    try {
      batch = await res.json();
    } catch {
      return { items, authFailed: false, badResponse: true };
    }
    if (!Array.isArray(batch)) {
      return { items, authFailed: false, badResponse: true };
    }
    items.push(...(batch as T[]));
    nextUrl = parseNextLink(res.headers.get("Link"));
    pages += 1;
  }

  return { items, authFailed: false };
}

type CanvasCourse = {
  id: number;
  name?: string;
  course_code?: string;
};

async function downloadCanvasFile(
  creds: CanvasCredentials,
  fileId: string,
  courseId: string,
  meta: CanvasFile
): Promise<ArrayBuffer> {
  const name = canvasFileName(meta);
  const attempts = [
    `${creds.host}/api/v1/files/${fileId}/download`,
    `${creds.host}/api/v1/courses/${courseId}/files/${fileId}/download`,
    meta.url,
  ].filter(Boolean) as string[];

  let lastStatus = 0;
  for (const target of attempts) {
    const res = await canvasDownload(creds, target);
    lastStatus = res.status;
    if (res.status === 401 || res.status === 403) {
      throw new Error("auth");
    }
    if (!res.ok) continue;

    const bytes = await res.arrayBuffer();
    if (bytes.byteLength === 0) continue;
    if (bytes.byteLength > MAX_FILE_BYTES) {
      throw new Error(`size:${name}`);
    }
    return bytes;
  }

  throw new Error(`download:${lastStatus}:${name}`);
}

async function fetchContainerWithRetry(
  container: { fetch(request: Request): Promise<Response> },
  request: Request
): Promise<Response> {
  const replay = await makeReplayableRequest(request);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await container.fetch(replay());
      if (res.ok) return res;
      const text = await res.clone().text().catch(() => "");
      if (!/no Container instance available|currently provisioning|suddenly disconnected/i.test(text)) {
        return res;
      }
    } catch (err) {
      const text = String(err instanceof Error ? err.message : err);
      if (
        !/no Container instance available|currently provisioning|suddenly disconnected|used body/i.test(
          text
        )
      ) {
        throw err;
      }
    }
    if (attempt < 4) await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  return new Response(JSON.stringify({ error: "The app is still starting up. Please try again in a few seconds." }), {
    status: 503,
    headers: { "Content-Type": "application/json", "Retry-After": "8" },
  });
}

async function proxyImportToBackend(
  env: CanvasEnv,
  request: Request,
  user: SessionUser,
  files: Array<{ filename: string; mimeType: string; bytes: ArrayBuffer }>,
  chatId?: string,
  title?: string
): Promise<Response> {
  const origin = env.WORKER_PUBLIC_URL || new URL(request.url).origin;
  const form = new FormData();
  if (chatId) form.append("chatId", chatId);
  if (title) form.append("title", title);
  for (const file of files) {
    form.append("file", new Blob([file.bytes], { type: file.mimeType }), file.filename);
  }

  // Do not clone this request through injectUserHeaders — that breaks multipart bodies in Workers.
  const headers = new Headers();
  headers.set("X-User-Id", user.id);
  headers.set("X-User-Email", user.email);

  const importRequest = new Request(new URL("/chat/import", origin), {
    method: "POST",
    body: form,
    headers,
  });

  const container = getContainer(env.PAGELM_BACKEND, "pagelm");
  return fetchContainerWithRetry(container, importRequest);
}

function humanizeCanvasException(msg: string): string {
  if (msg.includes("CANVAS_TOKEN_KEY")) {
    return "Canvas encryption is misconfigured on the server.";
  }
  if (/container|provisioning|disconnected|starting up/i.test(msg)) {
    return "The app backend is still starting. Please wait a few seconds and try again.";
  }
  if (/invalid url|failed to parse url/i.test(msg)) {
    return "Canvas returned an invalid file download link.";
  }
  if (/used body|could not.*body|formdata|multipart|readablestream/i.test(msg)) {
    return "Import failed while sending files to the app. Please try again.";
  }
  if (/fetch|network|timed out|timeout|ECONNREFUSED/i.test(msg)) {
    return "Could not reach the app backend. Wait a few seconds and try again.";
  }
  if (msg && msg.length <= 180) return msg;
  return "Canvas request failed. Check your school URL and token, then try again.";
}

function canvasRouteError(message: string, status = 500): Response {
  return json({ error: message, canvasError: true }, { status });
}

export async function handleCanvasRoutes(
  request: Request,
  env: CanvasEnv,
  pathname: string
): Promise<Response | null> {
  try {
    return await handleCanvasRoutesInner(request, env, pathname);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[canvas]", err);
    if (msg.includes("CANVAS_TOKEN_KEY")) {
      return canvasRouteError("Canvas encryption is misconfigured on the server.", 503);
    }
    if (msg.includes("Container")) {
      return canvasRouteError("The app backend is still starting. Please wait a few seconds and try again.", 503);
    }
    return canvasRouteError(humanizeCanvasException(msg), 500);
  }
}

async function handleCanvasRoutesInner(
  request: Request,
  env: CanvasEnv,
  pathname: string
): Promise<Response | null> {
  if (!pathname.startsWith("/api/canvas")) return null;

  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();

  if (!env.CANVAS_TOKEN_KEY) {
    return json({ error: "Canvas integration is not configured on the server." }, { status: 503 });
  }

  if (pathname === "/api/canvas/status" && request.method === "GET") {
    const row = await loadStoredToken(env.DB, user.id);
    return json({
      ok: true,
      connected: Boolean(row),
      last4: row?.last4 || null,
      host: row?.host || null,
    });
  }

  if (pathname === "/api/canvas/token" && request.method === "PUT") {
    let body: { host?: string; token?: string };
    try {
      body = (await request.json()) as { host?: string; token?: string };
    } catch {
      return json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const host = normalizeCanvasHost(String(body?.host || ""));
    const token = String(body?.token || "").trim();
    if (!host) return json({ error: "Valid Canvas school URL required (e.g. yourschool.instructure.com)" }, { status: 400 });
    if (!token) return json({ error: "token required" }, { status: 400 });

    const probe = await probeCanvasToken(env.DB, user.id, host, token);
    if (!probe.ok) {
      if (probe.status === 429) {
        return externalRateLimitedResponse({
          allowed: false,
          retryAfter: probe.retryAfter || 60,
          message: probe.message,
          limit: 60,
          remaining: 0,
        });
      }
      return json({ error: probe.message, canvasAuth: true }, { status: 400 });
    }

    const last4 = token.slice(-4);
    const { ciphertext, iv } = await encryptToken(env, token);

    await env.DB.prepare(
      `INSERT INTO canvas_tokens (user_id, host, ciphertext, iv, last4)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         host = excluded.host,
         ciphertext = excluded.ciphertext,
         iv = excluded.iv,
         last4 = excluded.last4,
         created_at = datetime('now')`
    )
      .bind(user.id, host, ciphertext, iv, last4)
      .run();

    return json({ ok: true, connected: true, last4, host });
  }

  if (pathname === "/api/canvas/token" && request.method === "DELETE") {
    await clearStoredToken(env.DB, user.id);
    return json({ ok: true, connected: false });
  }

  const creds = await getCredentials(env, user.id);
  if (!creds) {
    if (pathname === "/api/canvas/courses" || pathname.startsWith("/api/canvas/courses/")) {
      return json({ error: "Canvas is not connected. Add your school URL and access token first.", canvasAuth: true }, { status: 404 });
    }
    if (pathname === "/api/canvas/import") {
      return json({ error: "Canvas is not connected. Add your school URL and access token first.", canvasAuth: true }, { status: 404 });
    }
  }

  if (pathname === "/api/canvas/courses" && request.method === "GET" && creds) {
    const quota = await consumeExternalQuota(env.DB, user.id, "canvas.lms.list");
    if (!quota.allowed) return externalRateLimitedResponse(quota);

    const { items, authFailed, badResponse } = await fetchPaginated<CanvasCourse>(
      creds,
      "/api/v1/courses?enrollment_state=active&per_page=50"
    );

    if (badResponse) {
      return json(
        {
          error: "Canvas returned an unexpected response. Double-check your school URL (e.g. yourschool.instructure.com).",
          canvasAuth: true,
        },
        { status: 400 }
      );
    }

    if (authFailed) {
      await clearStoredToken(env.DB, user.id);
      return json(
        { error: "Canvas token expired or revoked. Paste a new access token.", expired: true, canvasAuth: true },
        { status: 400 }
      );
    }

    const courses = items.map((course) => ({
      id: course.id,
      name: course.name || course.course_code || `Course ${course.id}`,
      code: course.course_code || null,
    }));

    return json({ ok: true, items: courses });
  }

  const filesMatch = pathname.match(/^\/api\/canvas\/courses\/(\d+)\/files$/);
  if (filesMatch && request.method === "GET" && creds) {
    const courseId = filesMatch[1];
    const quota = await consumeExternalQuota(env.DB, user.id, "canvas.lms.list");
    if (!quota.allowed) return externalRateLimitedResponse(quota);

    const searchTerm = canvasSearchFromRequest(request.url);
    const { items, authFailed, badResponse } = await fetchPaginated<CanvasFile>(
      creds,
      courseFilesApiPath(courseId, searchTerm)
    );

    if (badResponse) {
      return json(
        {
          error: "Canvas returned an unexpected response for this course. Check your token can access course files.",
          canvasAuth: true,
        },
        { status: 400 }
      );
    }

    if (authFailed) {
      await clearStoredToken(env.DB, user.id);
      return json(
        { error: "Canvas token expired or revoked. Paste a new access token.", expired: true, canvasAuth: true },
        { status: 400 }
      );
    }

    const files = items.map((file) => {
      const name = canvasFileName(file);
      const contentType = canvasFileContentType(file);
      return {
        id: file.id,
        name,
        contentType,
        size: file.size || 0,
        updatedAt: file.updated_at || null,
        importable: isImportableFile(contentType, name),
      };
    });

    return json({ ok: true, items: files, query: searchTerm || "" });
  }

  if (pathname === "/api/canvas/import" && request.method === "POST" && creds) {
    let body: { courseId?: number | string; fileIds?: Array<number | string>; chatId?: string; title?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const courseId = String(body?.courseId || "").trim();
    const fileIds = (body?.fileIds || []).map((id) => String(id)).filter(Boolean);
    if (!courseId) return json({ error: "courseId required" }, { status: 400 });
    if (fileIds.length === 0) return json({ error: "Select at least one file to import" }, { status: 400 });
    if (fileIds.length > MAX_IMPORT_FILES) {
      return json({ error: `Import up to ${MAX_IMPORT_FILES} files at a time` }, { status: 400 });
    }

    const downloaded: Array<{ filename: string; mimeType: string; bytes: ArrayBuffer }> = [];

    for (const fileId of fileIds) {
      const quota = await consumeExternalQuota(env.DB, user.id, "canvas.lms.download");
      if (!quota.allowed) return externalRateLimitedResponse(quota);

      const metaRes = await canvasFetch(creds, `/api/v1/files/${fileId}`);
      if (metaRes.status === 401 || metaRes.status === 403) {
        await clearStoredToken(env.DB, user.id);
        return json(
          { error: "Canvas token expired or revoked. Paste a new access token.", expired: true, canvasAuth: true },
          { status: 400 }
        );
      }
      if (!metaRes.ok) {
        return json({ error: `Could not load Canvas file ${fileId}` }, { status: metaRes.status });
      }

      let meta: CanvasFile;
      try {
        meta = (await metaRes.json()) as CanvasFile;
      } catch {
        return json({ error: `Could not read metadata for Canvas file ${fileId}.` }, { status: 502 });
      }
      const name = canvasFileName(meta);
      const contentType = canvasFileContentType(meta);
      if (!isImportableFile(contentType, name)) {
        return json({ error: `"${name}" is not a supported file type for import.` }, { status: 400 });
      }
      if ((meta.size || 0) > MAX_FILE_BYTES) {
        return json({ error: `"${name}" exceeds the 15 MB import limit.` }, { status: 400 });
      }

      let bytes: ArrayBuffer;
      try {
        bytes = await downloadCanvasFile(creds, fileId, courseId, meta);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "download_failed";
        if (msg === "auth") {
          await clearStoredToken(env.DB, user.id);
          return json(
            { error: "Canvas token expired or revoked. Paste a new access token.", expired: true, canvasAuth: true },
            { status: 400 }
          );
        }
        if (msg.startsWith("size:")) {
          return json({ error: `"${msg.slice(5)}" exceeds the 15 MB import limit.` }, { status: 400 });
        }
        return json({ error: `Could not download "${name}" from Canvas.` }, { status: 502 });
      }

      downloaded.push({
        filename: name,
        mimeType: contentType,
        bytes,
      });
    }

    const importTitle = String(body?.title || "").trim() || `Canvas course ${courseId}`;
    let backendRes: Response | null = null;
    try {
      backendRes = await proxyImportToBackend(
        env,
        request,
        user,
        downloaded,
        body?.chatId ? String(body.chatId) : undefined,
        importTitle
      );
    } catch (err) {
      console.error("[canvas/import] proxy failed", err);
    }

    let chatId = String(body?.chatId || "");
    if (backendRes?.ok) {
      try {
        const parsed = JSON.parse(await backendRes.text()) as { chatId?: string };
        if (parsed.chatId) chatId = parsed.chatId;
      } catch {
        // listing from R2 still shows the files
      }
    }

    const wanted = new Set(downloaded.map((file) => file.filename.toLowerCase()));
    const stored: Awaited<ReturnType<typeof listUserUploads>> = [];
    const existing = await listUserUploads(env, user.id);
    const have = new Set(
      existing
        .filter((file) => wanted.has(file.filename.toLowerCase()) && file.id.startsWith(userUploadsPrefix(user.id)))
        .map((file) => {
          stored.push(file);
          return file.filename.toLowerCase();
        })
    );
    for (const file of downloaded) {
      if (have.has(file.filename.toLowerCase())) continue;
      stored.push(await putUserUpload(env, user.id, file, "canvas"));
    }

    return json({
      ok: true,
      chatId,
      imported: stored.length || downloaded.length,
      files: stored,
      warning: backendRes?.ok
        ? undefined
        : "Files are in your learning bag. Chat processing is still catching up — try asking about them in a minute.",
    });
  }

  return json({ error: "not found" }, { status: 404 });
}
