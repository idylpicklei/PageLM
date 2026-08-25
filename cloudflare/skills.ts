import { getSessionUser } from "./auth";

export type SkillRecord = {
  id: string;
  name: string;
  prompt: string;
  created: number;
};

type SkillEnv = {
  DB: D1Database;
};

const DEFAULT_SKILLS: Array<{ name: string; prompt: string }> = [
  {
    name: "Make flashcards",
    prompt:
      "Using the attached file, create 12 numbered flashcards. For each card, give a clear question and a concise answer. Format as Q/A pairs I can study from.",
  },
  {
    name: "Quiz me",
    prompt:
      "Using the attached file, write a short multiple-choice quiz with 8 questions. Include 4 options per question, mark the correct answer, and add a one-sentence explanation for each.",
  },
  {
    name: "Summarize",
    prompt:
      "Using the attached file, write a study-guide summary with key concepts, definitions, and a short list of things to review before an exam.",
  },
];

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function skillsKey(userId: string): string {
  return `keyv:user:${userId}:skills`;
}

export async function loadSkills(db: D1Database, userId: string): Promise<SkillRecord[]> {
  const row = await db.prepare("SELECT value FROM kv WHERE key = ?").bind(skillsKey(userId)).first<{ value: string }>();
  if (!row?.value) return [];
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveSkills(db: D1Database, userId: string, skills: SkillRecord[]): Promise<void> {
  await db
    .prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(skillsKey(userId), JSON.stringify(skills))
    .run();
}

function parseSkillBody(body: unknown): { name: string; prompt: string } | Response {
  const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const name = String(rec.name || "").trim();
  const prompt = String(rec.prompt || "").trim();
  if (!name) return json({ error: "name required" }, { status: 400 });
  if (!prompt) return json({ error: "prompt required" }, { status: 400 });
  return { name, prompt };
}

export async function handleSkillRoutes(
  request: Request,
  env: SkillEnv,
  pathname: string
): Promise<Response | null> {
  if (pathname !== "/skills" && !pathname.startsWith("/skills/")) return null;

  const user = await getSessionUser(request, env.DB);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });

  if (pathname === "/skills" && request.method === "GET") {
    let skills = await loadSkills(env.DB, user.id);
    if (!skills.length) {
      skills = DEFAULT_SKILLS.map((starter) => ({
        id: crypto.randomUUID(),
        name: starter.name,
        prompt: starter.prompt,
        created: Date.now(),
      }));
      await saveSkills(env.DB, user.id, skills);
    }
    return json({ ok: true, skills });
  }

  if (pathname === "/skills" && request.method === "POST") {
    const parsed = parseSkillBody(await request.json().catch(() => ({})));
    if (parsed instanceof Response) return parsed;
    const skill: SkillRecord = {
      id: crypto.randomUUID(),
      name: parsed.name,
      prompt: parsed.prompt,
      created: Date.now(),
    };
    const skills = await loadSkills(env.DB, user.id);
    skills.unshift(skill);
    await saveSkills(env.DB, user.id, skills);
    return json({ ok: true, skill });
  }

  const id = decodeURIComponent(pathname.slice("/skills/".length)).trim();
  if (!id || id.includes("/")) return json({ error: "not found" }, { status: 404 });

  if (request.method === "PUT") {
    const parsed = parseSkillBody(await request.json().catch(() => ({})));
    if (parsed instanceof Response) return parsed;
    const skills = await loadSkills(env.DB, user.id);
    const idx = skills.findIndex((s) => s.id === id);
    if (idx < 0) return json({ error: "not found" }, { status: 404 });
    const updated: SkillRecord = { ...skills[idx], name: parsed.name, prompt: parsed.prompt };
    skills[idx] = updated;
    await saveSkills(env.DB, user.id, skills);
    return json({ ok: true, skill: updated });
  }

  if (request.method === "DELETE") {
    const skills = (await loadSkills(env.DB, user.id)).filter((s) => s.id !== id);
    await saveSkills(env.DB, user.id, skills);
    return json({ ok: true });
  }

  return json({ error: "not found" }, { status: 404 });
}
