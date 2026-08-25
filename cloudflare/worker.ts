import { Container, getContainer } from "@cloudflare/containers";
import {
  getSessionUser,
  handleAuthRoutes,
  injectUserHeaders,
} from "./auth";
import {
  applyRateLimitHeaders,
  consumePromptQuota,
  isPromptRequest,
  rateLimitedResponse,
} from "./rate-limit";
import { handleCanvasRoutes } from "./canvas";
import { handleFileLibraryRoutes } from "./files";
import { handleSkillRoutes } from "./skills";
import { handleGroupRoutes } from "./groups";
import { makeReplayableRequest } from "./replay-request";

export interface Env {
  PAGELM_BACKEND: DurableObjectNamespace<PageLMContainer>;
  DB: D1Database;
  ASSETS: Fetcher;
  STORAGE: R2Bucket;
  CF_STORE_TOKEN: string;
  CANVAS_TOKEN_KEY?: string;
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
  "/files",
  "/skills",
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

const SPA_GET_PATHS = new Set(["/chat", "/quiz", "/planner", "/debate", "/exam", "/login", "/signup", "/canvas", "/groups", "/groups/join"]);

function isBackendRoute(pathname: string, method = "GET"): boolean {
  if (method === "GET" && SPA_GET_PATHS.has(pathname)) return false;
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
    TTS_PROVIDER: String(env.TTS_PROVIDER || "gemini"),
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
    "GEMINI_TTS_MODEL",
    "TTS_VOICE_GEMINI",
    "TTS_VOICE_ALT_GEMINI",
    "TTS_PROVIDER",
    "TRANSCRIPTION_PROVIDER",
    "ELEVEN_VOICE_A",
    "ELEVEN_VOICE_B",
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

  override async fetch(request: Request): Promise<Response> {
    this.envVars = buildContainerEnv(request, this.env);
    const running = Boolean((this as { container?: { running?: boolean } }).container?.running);
    if (!running) {
      try {
        await this.startAndWaitForPorts({
          ports: [5000],
          startOptions: { envVars: this.envVars, enableInternet: true },
          cancellationOptions: {
            instanceGetTimeoutMS: 60_000,
            portReadyTimeoutMS: 90_000,
          },
        });
      } catch (err) {
        console.error("[container] start wait failed", err);
      }
    }
    return super.fetch(request);
  }
}

function isContainerWarmupError(text: string): boolean {
  return /no Container instance available|currently provisioning|suddenly disconnected/i.test(text);
}

function containerWarmupResponse(): Response {
  return new Response(
    JSON.stringify({
      error: "The app is still starting up. Please wait a few seconds and try again.",
    }),
    {
      status: 503,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": "8",
      },
    }
  );
}

async function fetchContainer(container: { fetch(request: Request): Promise<Response> }, request: Request): Promise<Response> {
  const replay = await makeReplayableRequest(request);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const last = await container.fetch(replay());
      if (last.ok) return last;
      const text = await last.clone().text().catch(() => "");
      if (!isContainerWarmupError(text)) return last;
    } catch (err) {
      const text = String(err instanceof Error ? err.message : err);
      if (!isContainerWarmupError(text) && !/used body/i.test(text)) throw err;
    }
    if (attempt < 4) await scheduler.wait(2000 * (attempt + 1));
  }
  return containerWarmupResponse();
}

async function proxyToBackend(request: Request, env: Env, pathname: string): Promise<Response> {
  const container = getContainer(env.PAGELM_BACKEND, "pagelm");
  if (pathname === "/health") {
    return fetchContainer(container, request);
  }

  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();

  if (request.method === "POST" && pathname === "/transcriber") {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "YouTube transcription is temporarily unavailable. Upload an audio or video file instead.",
        }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  const forwarded = injectUserHeaders(request, user);
  if (!isPromptRequest(request.method, pathname)) {
    return fetchContainer(container, forwarded);
  }

  const quota = await consumePromptQuota(env.DB, user.id, env);
  if (!quota.allowed) return rateLimitedResponse(quota);

  const response = await fetchContainer(container, forwarded);
  if (!quota.warning) return response;

  const headers = new Headers(response.headers);
  applyRateLimitHeaders(headers, quota);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/_cf/kv")) {
      return handleKvRoutes(request, env);
    }

    if (url.pathname.startsWith("/auth")) {
      try {
        const allowSignup = String(env.ALLOW_SIGNUP || "").toLowerCase() === "true";
        const authResponse = await handleAuthRoutes(request, env.DB, url.pathname, { allowSignup });
        if (authResponse) return authResponse;
      } catch (err) {
        console.error("[auth]", err);
        return new Response(JSON.stringify({ error: "auth_failed" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/canva") {
      return Response.redirect(new URL("/canvas", request.url), 302);
    }

    if (url.pathname === "/files" || url.pathname.startsWith("/files/") || url.pathname.startsWith("/api/files")) {
      try {
        const filesResponse = await handleFileLibraryRoutes(request, env, url.pathname);
        if (filesResponse) return filesResponse;
      } catch (err) {
        console.error("[files]", err);
        return new Response(JSON.stringify({ error: "Could not load files from storage." }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    if (url.pathname === "/skills" || url.pathname.startsWith("/skills/")) {
      try {
        const skillsResponse = await handleSkillRoutes(request, env, url.pathname);
        if (skillsResponse) return skillsResponse;
      } catch (err) {
        console.error("[skills]", err);
        return new Response(JSON.stringify({ error: "Could not load skills." }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    if (url.pathname === "/api/groups" || url.pathname.startsWith("/api/groups/")) {
      try {
        const groupsResponse = await handleGroupRoutes(request, env, url.pathname);
        if (groupsResponse) return groupsResponse;
      } catch (err) {
        console.error("[groups]", err);
        return new Response(JSON.stringify({ error: "Could not load study groups." }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    if (url.pathname.startsWith("/api/canvas")) {
      try {
        const canvasResponse = await handleCanvasRoutes(request, env, url.pathname);
        if (canvasResponse) return canvasResponse;
      } catch (err) {
        console.error("[canvas]", err);
        const msg = err instanceof Error ? err.message : "canvas_failed";
        return new Response(JSON.stringify({ error: msg, canvasError: true }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const upgrade = request.headers.get("Upgrade");
    if (upgrade?.toLowerCase() === "websocket" || isBackendRoute(url.pathname, request.method)) {
      return proxyToBackend(request, env, url.pathname);
    }

    if (request.method === "GET" && SPA_GET_PATHS.has(url.pathname)) {
      return env.ASSETS.fetch(new URL("/", request.url));
    }

    return env.ASSETS.fetch(request);
  },
};
