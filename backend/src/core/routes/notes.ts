import { handleSmartNotes } from "../../services/smartnotes";
import { emitToAll } from "../../utils/chat/ws";
import { withTimeout } from "../../utils/quiz/promise";
import { hydrateFromR2, resolveStorage, storageRel } from "../../utils/storage/store";
import crypto from "crypto";
import fs from "fs";
import path from "path";

const ns = new Map<string, Set<any>>();
const nlog = (...a: any) => console.log("[smartnotes]", ...a);

export function smartnotesRoutes(app: any) {
  app.ws("/ws/smartnotes", (ws: any, req: any) => {
    const u = new URL(req.url, "http://localhost");
    const id = u.searchParams.get("noteId");
    if (!id) return ws.close(1008, "noteId required");

    let s = ns.get(id);
    if (!s) {
      s = new Set();
      ns.set(id, s);
    }
    s.add(ws);

    nlog("ws open", id, "clients:", s.size);
    ws.send(JSON.stringify({ type: "ready", noteId: id }));

    ws.on("error", (e: any) => nlog("ws err", id, e?.message || e));
    ws.on("close", () => {
      s!.delete(ws);
      if (s!.size === 0) ns.delete(id);
      nlog("ws close", id, "left:", s!.size);
    });

    const iv = setInterval(() => {
      try {
        if (ws.readyState === 1)
          ws.send(JSON.stringify({ type: "ping", t: Date.now() }));
      } catch {}
    }, 15000);
    ws.on("close", () => clearInterval(iv));
  });

  app.post("/smartnotes", async (req: any, res: any) => {
    try {
      const { topic, notes, filePath } = req.body || {};
      if (!topic && !notes && !filePath) {
        return res
          .status(400)
          .send({ ok: false, error: "Provide topic, notes, or filePath" });
      }

      const noteId = crypto.randomUUID();
      nlog("start", noteId, "input:", { topic, notes, filePath });

      res
        .status(202)
        .send({ ok: true, noteId, stream: `/ws/smartnotes?noteId=${noteId}` });

      setImmediate(async () => {
        try {
          emitToAll(ns.get(noteId), { type: "phase", value: "generating" });
          const result = await withTimeout(
            handleSmartNotes({ topic, notes, filePath }),
            120000,
            "handleSmartNotes"
          );
          nlog("generated", noteId, result.file);
          emitToAll(ns.get(noteId), {
            type: "file",
            file: `/smartnotes/download/${encodeURIComponent(path.basename(result.file))}`,
          });
          emitToAll(ns.get(noteId), { type: "done" });
          nlog("done", noteId);
        } catch (e: any) {
          nlog("error", noteId, e?.message || e);
          emitToAll(ns.get(noteId), {
            type: "error",
            error: e?.message || "failed",
          });
        }
      });
    } catch (e: any) {
      nlog("500 route err", e?.message || e);
      res.status(500).send({ ok: false, error: e?.message || "internal" });
    }
  });

  app.get("/smartnotes/download/:filename", async (req: any, res: any) => {
    try {
      const filename = path.basename(decodeURIComponent(String(req.params.filename || "")));
      if (!filename || filename.includes("..")) {
        return res.status(400).send({ error: "invalid filename" });
      }

      const dirPath = resolveStorage("smartnotes");
      const wanted = path.join(dirPath, filename);
      await hydrateFromR2(storageRel(wanted));

      let filePath = wanted;
      if (!fs.existsSync(filePath) && fs.existsSync(dirPath)) {
        const match = fs.readdirSync(dirPath).find((f) => f.toLowerCase() === filename.toLowerCase());
        if (match) filePath = path.join(dirPath, match);
      }
      if (!fs.existsSync(filePath)) {
        return res.status(404).send({ error: "File not found" });
      }

      const ext = path.extname(filePath).toLowerCase();
      const type = ext === ".pdf" ? "application/pdf" : ext === ".docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/octet-stream";
      res.setHeader("Content-Type", type);
      res.setHeader("Content-Disposition", `attachment; filename="${path.basename(filePath)}"`);
      res.setHeader("Content-Length", fs.statSync(filePath).size);
      fs.createReadStream(filePath).pipe(res);
    } catch (e: any) {
      res.status(500).send({ error: e?.message || "Download failed" });
    }
  });
}
