import db from "../../utils/database/scoped-keyv";

const INDEX_KEY = "skills";

export type SkillRecord = {
  id: string;
  name: string;
  prompt: string;
  created: number;
};

const EXAMPLE_SKILLS = [
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

function isExampleSkill(skill: SkillRecord): boolean {
  const name = String(skill.name || "").trim();
  const prompt = String(skill.prompt || "").trim();
  return EXAMPLE_SKILLS.some((example) => example.name === name && example.prompt === prompt);
}

async function loadSkills(): Promise<SkillRecord[]> {
  const rows = (await db.get(INDEX_KEY)) as SkillRecord[] | undefined;
  return Array.isArray(rows) ? rows : [];
}

async function loadUserSkills(): Promise<SkillRecord[]> {
  const stored = await loadSkills();
  const skills = stored.filter((skill) => !isExampleSkill(skill));
  if (skills.length !== stored.length) {
    await saveSkills(skills);
    for (const skill of stored.filter(isExampleSkill)) {
      await db.delete(`skill:${skill.id}`);
    }
  }
  return skills;
}

async function saveSkills(skills: SkillRecord[]): Promise<void> {
  await db.set(INDEX_KEY, skills);
}

export function skillRoutes(app: any) {
  app.get("/skills", async (_req: any, res: any) => {
    try {
      const skills = await loadUserSkills();
      res.send({ ok: true, skills });
    } catch (e: any) {
      res.status(500).send({ ok: false, error: e?.message || "failed" });
    }
  });

  app.post("/skills", async (req: any, res: any) => {
    try {
      const name = String(req.body?.name || "").trim();
      const prompt = String(req.body?.prompt || "").trim();
      if (!name) return res.status(400).send({ error: "name required" });
      if (!prompt) return res.status(400).send({ error: "prompt required" });

      const skill: SkillRecord = {
        id: crypto.randomUUID(),
        name,
        prompt,
        created: Date.now(),
      };

      const skills = await loadUserSkills();
      skills.unshift(skill);
      await db.set(`skill:${skill.id}`, skill);
      await saveSkills(skills);
      res.send({ ok: true, skill });
    } catch (e: any) {
      res.status(500).send({ ok: false, error: e?.message || "failed" });
    }
  });

  app.put("/skills/:id", async (req: any, res: any) => {
    try {
      const id = String(req.params.id || "").trim();
      if (!id) return res.status(400).send({ error: "id required" });

      const name = String(req.body?.name || "").trim();
      const prompt = String(req.body?.prompt || "").trim();
      if (!name) return res.status(400).send({ error: "name required" });
      if (!prompt) return res.status(400).send({ error: "prompt required" });

      const skills = await loadUserSkills();
      const idx = skills.findIndex((s) => s.id === id);
      if (idx < 0) return res.status(404).send({ error: "not found" });

      const updated: SkillRecord = { ...skills[idx], name, prompt };
      skills[idx] = updated;
      await db.set(`skill:${id}`, updated);
      await saveSkills(skills);
      res.send({ ok: true, skill: updated });
    } catch (e: any) {
      res.status(500).send({ ok: false, error: e?.message || "failed" });
    }
  });

  app.delete("/skills/:id", async (req: any, res: any) => {
    try {
      const id = String(req.params.id || "").trim();
      if (!id) return res.status(400).send({ error: "id required" });

      await db.delete(`skill:${id}`);
      const skills = (await loadUserSkills()).filter((s) => s.id !== id);
      await saveSkills(skills);
      res.send({ ok: true });
    } catch (e: any) {
      res.status(500).send({ ok: false, error: e?.message || "failed" });
    }
  });
}
