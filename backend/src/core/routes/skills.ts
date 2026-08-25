import db from "../../utils/database/scoped-keyv";

const INDEX_KEY = "skills";

export type SkillRecord = {
  id: string;
  name: string;
  prompt: string;
  created: number;
};

async function loadSkills(): Promise<SkillRecord[]> {
  const rows = (await db.get(INDEX_KEY)) as SkillRecord[] | undefined;
  return Array.isArray(rows) ? rows : [];
}

async function saveSkills(skills: SkillRecord[]): Promise<void> {
  await db.set(INDEX_KEY, skills);
}

export function skillRoutes(app: any) {
  app.get("/skills", async (_req: any, res: any) => {
    try {
      const skills = await loadSkills();
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

      const skills = await loadSkills();
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

      const skills = await loadSkills();
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
      const skills = (await loadSkills()).filter((s) => s.id !== id);
      await saveSkills(skills);
      res.send({ ok: true });
    } catch (e: any) {
      res.status(500).send({ ok: false, error: e?.message || "failed" });
    }
  });
}
