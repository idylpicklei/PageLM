/**
 * Outbound rate limits for Instructure Canvas DAP Query API and Canvas LMS REST API.
 * DAP limits: https://developerdocs.instructure.com/services/dap/limits-policies
 */

export type DapEndpoint =
  | "dap.get.query.table"
  | "dap.get.query.table.schema"
  | "dap.get.job"
  | "dap.post.query.canvas.data"
  | "dap.post.query.canvas_logs.data"
  | "dap.post.object.url"
  | "canvas.lms.list"
  | "canvas.lms.download";

export type ExternalRateDecision = {
  allowed: boolean;
  retryAfter: number;
  message: string;
  limit: number;
  remaining: number;
};

type LimitRule = {
  limit: number;
  windowMs: number;
  /** Minimum spacing between consecutive calls (job status polling). */
  minIntervalMs?: number;
  message: string;
};

const RULES: Record<DapEndpoint, LimitRule> = {
  "dap.get.query.table": {
    limit: 5,
    windowMs: 60_000,
    message: "Table listing is limited to 5 requests per minute. Please wait before trying again.",
  },
  "dap.get.query.table.schema": {
    limit: 500,
    windowMs: 60_000,
    message: "Schema requests are limited to 500 per minute. Please slow down.",
  },
  "dap.get.job": {
    limit: 500,
    windowMs: 60_000,
    minIntervalMs: 5_000,
    message: "Job status checks are limited. Wait at least 5 seconds between polls.",
  },
  "dap.post.query.canvas.data": {
    limit: 500,
    windowMs: 60_000,
    message: "Canvas data queries are limited to 500 per minute. Please slow down.",
  },
  "dap.post.query.canvas_logs.data": {
    limit: 5,
    windowMs: 60_000,
    message: "Canvas logs queries are limited to 5 per minute. Please wait before retrying.",
  },
  "dap.post.object.url": {
    limit: 200,
    windowMs: 60_000,
    message: "Pre-signed URL requests are limited to 200 per minute. Please slow down.",
  },
  "canvas.lms.list": {
    limit: 60,
    windowMs: 60_000,
    message: "Canvas listing requests are limited to 60 per minute. Please wait before trying again.",
  },
  "canvas.lms.download": {
    limit: 30,
    windowMs: 60_000,
    message: "Canvas file downloads are limited to 30 per minute. Please wait before importing more.",
  },
};

type WindowState = {
  key: string;
  count: number;
  limit: number;
  resetAt: number;
};

function secondsUntil(resetAt: number, now: number): number {
  return Math.max(1, Math.ceil((resetAt - now) / 1000));
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
    return { key, count: 0, limit, resetAt: now + windowMs };
  }
  return { key, count: row.count, limit, resetAt: row.reset_at };
}

async function saveWindow(db: D1Database, window: WindowState): Promise<void> {
  await db
    .prepare(
      "INSERT INTO rate_limits (key, count, reset_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET count = excluded.count, reset_at = excluded.reset_at"
    )
    .bind(window.key, window.count, window.resetAt)
    .run();
}

/** Classify a DAP Query API path + method into a rate-limit bucket. */
export function classifyDapRequest(method: string, pathname: string): DapEndpoint | null {
  const m = method.toUpperCase();
  const p = pathname.replace(/^\/dap/, "").replace(/\/+/g, "/");

  if (m === "GET" && /\/query\/[^/]+\/table\/[^/]+\/schema\/?$/.test(p)) {
    return "dap.get.query.table.schema";
  }
  if (m === "GET" && /\/query\/[^/]+\/table\/?$/.test(p)) {
    return "dap.get.query.table";
  }
  if (m === "GET" && /^\/job\/?/.test(p)) {
    return "dap.get.job";
  }
  if (m === "POST" && /\/query\/canvas\/table\/[^/]+\/data\/?$/.test(p)) {
    return "dap.post.query.canvas.data";
  }
  if (m === "POST" && /\/query\/canvas_logs\/table\/[^/]+\/data\/?$/.test(p)) {
    return "dap.post.query.canvas_logs.data";
  }
  if (m === "POST" && /^\/object\/url\/?$/.test(p)) {
    return "dap.post.object.url";
  }
  return null;
}

export async function consumeExternalQuota(
  db: D1Database,
  userId: string,
  endpoint: DapEndpoint
): Promise<ExternalRateDecision> {
  const rule = RULES[endpoint];
  const now = Date.now();
  const minuteBucket = Math.floor(now / 60_000);
  const windowKey = `ext:${userId}:${endpoint}:m:${minuteBucket}`;

  if (rule.minIntervalMs) {
    const spacingKey = `ext:${userId}:${endpoint}:last`;
    const lastRow = await db
      .prepare("SELECT reset_at FROM rate_limits WHERE key = ?")
      .bind(spacingKey)
      .first<{ reset_at: number }>();
    if (lastRow && lastRow.reset_at > now) {
      const retryAfter = secondsUntil(lastRow.reset_at, now);
      return {
        allowed: false,
        retryAfter,
        message: rule.message,
        limit: rule.limit,
        remaining: 0,
      };
    }
  }

  const window = await loadWindow(db, windowKey, rule.limit, rule.windowMs, now);
  if (window.count >= window.limit) {
    return {
      allowed: false,
      retryAfter: secondsUntil(window.resetAt, now),
      message: rule.message,
      limit: rule.limit,
      remaining: 0,
    };
  }

  window.count += 1;
  await saveWindow(db, window);

  if (rule.minIntervalMs) {
    const spacingKey = `ext:${userId}:${endpoint}:last`;
    await saveWindow(db, {
      key: spacingKey,
      count: 1,
      limit: 1,
      resetAt: now + rule.minIntervalMs,
    });
  }

  return {
    allowed: true,
    retryAfter: 0,
    message: "",
    limit: rule.limit,
    remaining: Math.max(0, rule.limit - window.count),
  };
}

export function externalRateLimitedResponse(decision: ExternalRateDecision): Response {
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

/** Call before any outbound DAP HTTP request. Returns null when allowed. */
export async function guardDapRequest(
  db: D1Database,
  userId: string,
  method: string,
  pathname: string
): Promise<Response | null> {
  const endpoint = classifyDapRequest(method, pathname);
  if (!endpoint) return null;
  const decision = await consumeExternalQuota(db, userId, endpoint);
  if (!decision.allowed) return externalRateLimitedResponse(decision);
  return null;
}
