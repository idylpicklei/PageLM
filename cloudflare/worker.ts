import { Container, getContainer } from "@cloudflare/containers";

export interface Env {
  PAGELM_BACKEND: DurableObjectNamespace<PageLMContainer>;
  DB: D1Database;
  ASSETS: Fetcher;
  CF_STORE_TOKEN: string;
  WORKER_PUBLIC_URL?: string;
  R2_BUCKET_NAME?: string;
  [key: string]: unknown;
}

const BACKEND_PREFIXES = [
  "/_cf/",
  "/api/",
  "/ws/",
  "/chat",
  "/chats",
  "/quiz",
  "/flashcards",
  "/podcast",
  "/smartnotes",
  "/exam",
  "/exams",
  "/debate",
  "/debates",
  "/tasks",
  "/planner",
  "/sessions",
  "/reminders",
  "/slots",
  "/transcriber",
  "/storage/",
  "/health",
];

function isBackendRoute(pathname: string): boolean {
  return BACKEND_PREFIXES.some((p) =>
    p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(p + "/")
  );
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

function checkStoreAuth(request: Request, env: Env): boolean {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return Boolean(env.CF_STORE_TOKEN && token === env.CF_STORE_TOKEN);
}

async function handleKvRoutes(request: Request, env: Env): Promise<Response> {
  if (!checkStoreAuth(request, env)) return unauthorized();

  const url = new URL(request.url);
  const sub = url.pathname.slice("/_cf/kv/".length);

  if (request.method === "GET" && sub && !sub.includes("/")) {
    const row = await env.DB.prepare("SELECT value FROM kv WHERE key = ?")
      .bind(decodeURIComponent(sub))
      .first<{ value: string }>();
    if (!row) {
      return new Response(JSON.stringify({ value: undefined }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ value: row.value }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (request.method === "PUT" && sub && !sub.includes("/")) {
    const body = (await request.json()) as { value?: string };
    if (body.value === undefined) {
      return new Response(JSON.stringify({ error: "value required" }), { status: 400 });
    }
    await env.DB.prepare(
      "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
      .bind(decodeURIComponent(sub), body.value)
      .run();
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (request.method === "DELETE" && sub && !sub.includes("/")) {
    await env.DB.prepare("DELETE FROM kv WHERE key = ?")
      .bind(decodeURIComponent(sub))
      .run();
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
}

function buildContainerEnv(request: Request, env: Env): Record<string, string> {
  const origin = env.WORKER_PUBLIC_URL || new URL(request.url).origin;
  const vars: Record<string, string> = {
    STORAGE_BACKEND: "cloudflare",
    HOST: "0.0.0.0",
    PORT: "5000",
    CF_KV_BASE_URL: origin,
    CF_STORE_TOKEN: String(env.CF_STORE_TOKEN || ""),
    VITE_BACKEND_URL: origin,
    VITE_FRONTEND_URL: origin,
    db_mode: String(env.db_mode || "json"),
    LLM_PROVIDER: String(env.LLM_PROVIDER || "gemini"),
    EMB_PROVIDER: String(env.EMB_PROVIDER || "gemini"),
  };
  if (env.R2_BUCKET_NAME) vars.R2_BUCKET_NAME = String(env.R2_BUCKET_NAME);

  const secretKeys = [
    "gemini",
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "OPENAI_API_KEY",
    "OPENAI_EMBED_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENROUTER_API_KEY",
    "XAI_API_KEY",
    "MINIMAX_API_KEY",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "CLOUDFLARE_ACCOUNT_ID",
    "ELEVEN_API_KEY",
    "ASSEMBLYAI_API_KEY",
    "gemini_model",
    "gemini_embed_model",
  ];

  for (const key of secretKeys) {
    const val = env[key];
    if (typeof val === "string" && val.length > 0) vars[key] = val;
  }

  return vars;
}

export class PageLMContainer extends Container {
  defaultPort = 5000;
  sleepAfter = "1h";
  enableInternet = true;
  pingEndpoint = "/health";
}

async function proxyToBackend(request: Request, env: Env): Promise<Response> {
  const container = getContainer(env.PAGELM_BACKEND, "pagelm") as PageLMContainer;
  container.envVars = buildContainerEnv(request, env);
  await container.startAndWaitForPorts();
  return container.fetch(request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/_cf/kv")) {
      return handleKvRoutes(request, env);
    }

    const upgrade = request.headers.get("Upgrade");
    if (upgrade?.toLowerCase() === "websocket" || isBackendRoute(url.pathname)) {
      return proxyToBackend(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
