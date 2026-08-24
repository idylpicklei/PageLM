export const SESSION_COOKIE = "pagelm_session";
export const SESSION_DAYS = 30;

export type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
};

export type SessionUser = {
  id: string;
  email: string;
};

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function uuid(): string {
  return crypto.randomUUID();
}

function sessionExpiryIso(): string {
  return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validPassword(password: string): boolean {
  return typeof password === "string" && password.length >= 8;
}

export function getCookie(request: Request, name: string): string | null {
  const raw = request.headers.get("Cookie") || "";
  const parts = raw.split(";").map((p) => p.trim());
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx);
    if (key === name) return decodeURIComponent(part.slice(idx + 1));
  }
  return null;
}

export function sessionCookie(token: string, request: Request): string {
  const secure = new URL(request.url).protocol === "https:";
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_DAYS * 24 * 60 * 60}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(request: Request): string {
  const secure = new URL(request.url).protocol === "https:";
  const parts = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
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

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return `pbkdf2$100000$${bytesToB64(salt)}$${bytesToB64(new Uint8Array(derived))}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;
  const salt = b64ToBytes(parts[2]);
  const expected = b64ToBytes(parts[3]);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    expected.length * 8
  );
  const actual = new Uint8Array(derived);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

async function createSession(db: D1Database, userId: string): Promise<string> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const token = bytesToB64(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  await db
    .prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(token, userId, sessionExpiryIso())
    .run();
  return token;
}

export async function getSessionUser(request: Request, db: D1Database): Promise<SessionUser | null> {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const row = await db
    .prepare(
      `SELECT u.id, u.email, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`
    )
    .bind(token)
    .first<{ id: string; email: string; expires_at: string }>();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await db.prepare("DELETE FROM sessions WHERE id = ?").bind(token).run();
    return null;
  }
  return { id: row.id, email: row.email };
}

async function migrateLegacyKvToUser(db: D1Database, userId: string): Promise<void> {
  const rows = await db
    .prepare("SELECT key, value FROM kv WHERE key NOT LIKE 'keyv:user:%'")
    .all<{ key: string; value: string }>();
  if (!rows.results?.length) return;

  for (const row of rows.results) {
    const rawKey = row.key.startsWith("keyv:") ? row.key.slice(5) : row.key;
    if (rawKey.startsWith(`user:${userId}:`)) continue;
    const scoped = `keyv:user:${userId}:${rawKey}`;
    const exists = await db.prepare("SELECT 1 FROM kv WHERE key = ?").bind(scoped).first();
    if (exists) continue;
    await db.prepare("INSERT INTO kv (key, value) VALUES (?, ?)").bind(scoped, row.value).run();
  }
}

export async function handleAuthRoutes(
  request: Request,
  db: D1Database,
  pathname: string,
  options: { allowSignup?: boolean } = {}
): Promise<Response | null> {
  if (pathname === "/auth/me" && request.method === "GET") {
    const user = await getSessionUser(request, db);
    if (!user) return json({ error: "unauthorized" }, { status: 401 });
    return json({ ok: true, user });
  }

  if (pathname === "/auth/logout" && request.method === "POST") {
    const token = getCookie(request, SESSION_COOKIE);
    if (token) {
      await db.prepare("DELETE FROM sessions WHERE id = ?").bind(token).run();
    }
    return json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie(request) } });
  }

  if (pathname === "/auth/register" && request.method === "POST") {
    if (!options.allowSignup) {
      return json({ error: "account creation is disabled" }, { status: 403 });
    }

    let body: { email?: string; password?: string };
    try {
      body = (await request.json()) as { email?: string; password?: string };
    } catch {
      return json({ error: "invalid json" }, { status: 400 });
    }
    const email = normalizeEmail(String(body.email || ""));
    const password = String(body.password || "");
    if (!validEmail(email)) return json({ error: "invalid email" }, { status: 400 });
    if (!validPassword(password)) return json({ error: "password must be at least 8 characters" }, { status: 400 });

    const existing = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    if (existing) return json({ error: "email already registered" }, { status: 409 });

    const userCount = await db.prepare("SELECT COUNT(*) AS c FROM users").first<{ c: number }>();
    const isFirstUser = (userCount?.c ?? 0) === 0;

    const id = uuid();
    const passwordHash = await hashPassword(password);
    await db
      .prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)")
      .bind(id, email, passwordHash)
      .run();

    if (isFirstUser) {
      await migrateLegacyKvToUser(db, id);
    }

    const token = await createSession(db, id);
    return json(
      { ok: true, user: { id, email } },
      { status: 201, headers: { "Set-Cookie": sessionCookie(token, request) } }
    );
  }

  if (pathname === "/auth/login" && request.method === "POST") {
    let body: { email?: string; password?: string };
    try {
      body = (await request.json()) as { email?: string; password?: string };
    } catch {
      return json({ error: "invalid json" }, { status: 400 });
    }
    const email = normalizeEmail(String(body.email || ""));
    const password = String(body.password || "");
    if (!validEmail(email) || !password) return json({ error: "invalid credentials" }, { status: 401 });

    const row = await db
      .prepare("SELECT id, email, password_hash FROM users WHERE email = ?")
      .bind(email)
      .first<UserRow>();
    if (!row || !(await verifyPassword(password, row.password_hash))) {
      return json({ error: "invalid credentials" }, { status: 401 });
    }

    const token = await createSession(db, row.id);
    return json(
      { ok: true, user: { id: row.id, email: row.email } },
      { headers: { "Set-Cookie": sessionCookie(token, request) } }
    );
  }

  return null;
}

export function injectUserHeaders(request: Request, user: SessionUser): Request {
  const headers = new Headers(request.headers);
  headers.delete("X-User-Id");
  headers.delete("X-User-Email");
  headers.set("X-User-Id", user.id);
  headers.set("X-User-Email", user.email);
  return new Request(request, { headers });
}
