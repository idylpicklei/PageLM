import { clearLibraryFiles, deleteLibraryFile, listLibraryFiles } from "../../utils/library/files";

export function fileRoutes(app: any) {
  app.get("/files", async (_req: any, res: any) => {
    try {
      res.send({ ok: true, files: await listLibraryFiles() });
    } catch (e: any) {
      res.status(500).send({ ok: false, error: e?.message || "failed" });
    }
  });

  app.delete("/files", async (_req: any, res: any) => {
    try {
      await clearLibraryFiles();
      res.send({ ok: true });
    } catch (e: any) {
      res.status(500).send({ ok: false, error: e?.message || "failed" });
    }
  });

  app.delete("/files/:id", async (req: any, res: any) => {
    try {
      const id = String(req.params.id || "");
      if (!id) return res.status(400).send({ error: "id required" });
      await deleteLibraryFile(id);
      res.send({ ok: true });
    } catch (e: any) {
      res.status(500).send({ ok: false, error: e?.message || "failed" });
    }
  });
}
