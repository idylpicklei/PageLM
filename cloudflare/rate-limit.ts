export type RateLimitDecision = {
  allowed: boolean;
  warning: boolean;
  retryAfter: number;
  message: string;
  limit: number;
  remaining: number;
};

type WindowState = {
  key: string;
  count: number;
  limit: number;
  resetAt: number;
  windowMs: number;
};

function envInt(env: Record<string, unknown>, name: string, fallback: number): number {
  const raw = env[name];
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function isPromptRequest(method: string, pathname: string): boolean {
  if (method !== "POST") return false;
  if (
    pathname === "/chat" ||
    pathname === "/quiz" ||
    pathname === "/podcast" ||
    pathname === "/smartnotes" ||
    pathname === "/exam" ||
    pathname === "/transcriber" ||
    pathname === "/api/companion/ask" ||
    pathname === "/tasks" ||
    pathname === "/tasks/ingest" ||
    pathname === "/planner/weekly" ||
    pathname === "/debate/start"
  ) {
    return true;
  }
  if (/^\/debate\/[^/]+\/(argue|analyze)$/.test(pathname)) return true;
  if (/^\/tasks\/[^/]+\/(plan|replan|materials)$/.test(pathname)) return true;
  return false;
}

async function loadWindow(
  db: D1Database,
  key: string,
  limit: number,
  windowMs: number,
  now: number
): Promise<WindowState> {
  const row = await db
    .prepare("SELECT count, reset_at FROM rate_limits WHERE key = ?")
    .bind(key)
    .first<{ count: number; reset_at: number }>();

  if (!row || row.reset_at <= now) {
    return { key, count: 0, limit, resetAt: now + windowMs, windowMs };
  }
  return { key, count: row.count, limit, resetAt: row.reset_at, windowMs };
}

async function saveWindow(db: D1Database, window: WindowState): Promise<void> {
  await db
    .prepare(
      "INSERT INTO rate_limits (key, count, reset_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET count = excluded.count, reset_at = excluded.reset_at"
    )
    .bind(window.key, window.count, window.resetAt)
    .run();
}

function secondsUntil(resetAt: number, now: number): number {
  return Math.max(1, Math.ceil((resetAt - now) / 1000));
}

export async function consumePromptQuota(
  db: D1Database,
  userId: string,
  env: Record<string, unknown>
): Promise<RateLimitDecision> {
  const now = Date.now();
  const userMinute = envInt(env, "RATE_LIMIT_USER_MINUTE", 5);
  const userQuarter = envInt(env, "RATE_LIMIT_USER_QUARTER", 15);
  const userHour = envInt(env, "RATE_LIMIT_USER_HOUR", 40);
  const globalMinute = envInt(env, "RATE_LIMIT_GLOBAL_MINUTE", 20);
  const globalHour = envInt(env, "RATE_LIMIT_GLOBAL_HOUR", 120);

  await db.prepare("DELETE FROM rate_limits WHERE reset_at <= ?").bind(now).run();

  const minuteBucket = Math.floor(now / 60_000);
  const quarterBucket = Math.floor(now / 900_000);
  const hourBucket = Math.floor(now / 3_600_000);

  const windows = await Promise.all([
    loadWindow(db, `user:${userId}:m:${minuteBucket}`, userMinute, 60_000, now),
    loadWindow(db, `user:${userId}:q:${quarterBucket}`, userQuarter, 900_000, now),
    loadWindow(db, `user:${userId}:h:${hourBucket}`, userHour, 3_600_000, now),
    loadWindow(db, `global:m:${minuteBucket}`, globalMinute, 60_000, now),
    loadWindow(db, `global:h:${hourBucket}`, globalHour, 3_600_000, now),
  ]);

  const blocked = windows.find((w) => w.count >= w.limit);
  if (blocked) {
    const globalHit = blocked.key.startsWith("global:");
    return {
      allowed: false,
      warning: false,
      retryAfter: secondsUntil(blocked.resetAt, now),
      limit: blocked.limit,
      remaining: 0,
      message: globalHit
        ? "The service is handling a lot of requests right now. Please slow down and try again shortly."
        : "You're sending prompts too quickly. Please slow down and try again in a moment.",
    };
  }

  for (const window of windows) window.count += 1;
  await Promise.all(windows.map((window) => saveWindow(db, window)));

  const userWindows = windows.slice(0, 3);
  const tightest = userWindows.reduce((best, next) =>
    next.limit - next.count < best.limit - best.count ? next : best
  );
  const remaining = Math.min(...userWindows.map((w) => w.limit - w.count));
  const warning = userWindows.some((w) => w.count / w.limit >= 0.7);

  return {
    allowed: true,
    warning,
    retryAfter: 0,
    limit: tightest.limit,
    remaining,
    message: warning
      ? "You're sending a lot of prompts. Please slow down so we don't run out of AI usage."
      : "",
  };
}

export function rateLimitedResponse(decision: RateLimitDecision): Response {
  return new Response(
    JSON.stringify({
      error: "rate_limited",
      message: decision.message,
      retryAfter: decision.retryAfter,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(decision.retryAfter),
        "X-RateLimit-Limit": String(decision.limit),
        "X-RateLimit-Remaining": "0",
      },
    }
  );
}

export function applyRateLimitHeaders(headers: Headers, decision: RateLimitDecision): void {
  headers.set("X-RateLimit-Limit", String(decision.limit));
  headers.set("X-RateLimit-Remaining", String(decision.remaining));
  if (decision.warning) headers.set("X-RateLimit-Warning", "slow_down");
}
