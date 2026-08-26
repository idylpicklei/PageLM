import fs from "fs";
import { handleChatAsk, type ResponseLength } from "../../lib/ai/ask";
import { saveFlashcardsToGroup } from "./flashcards";
import { parseMultipart, parseImportMultipart, handleUpload, resolveLibrarySource } from "../../lib/parser/upload";
import {
  mkChat,
  getChat,
  addMsg,
  listChats,
  getMsgs,
} from "../../utils/chat/chat";
import { emitToAll } from "../../utils/chat/ws";
import { addLibraryFiles, type LibraryFile } from "../../utils/library/files";
import { storageRel } from "../../utils/storage/store";
import { userContext } from "../../utils/user-context";

type UpFile = { path: string; filename: string; mimeType: string };
type LiveChat = { events: any[]; finalAnswer?: any };

const chatSockets = new Map<string, Set<any>>();
const chatLive = new Map<string, LiveChat>();

function fileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function importSource(title?: string): LibraryFile["source"] {
  return String(title || "").toLowerCase().startsWith("canvas") ? "canvas" : "upload";
}

function parseLength(value: unknown): ResponseLength | undefined {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "short" || raw === "medium" || raw === "long") return raw;
  return undefined;
}

function friendlyChatError(msg: string): string {
  const raw = String(msg || "failed");
  if (/no valid content/i.test(raw)) return "Could not extract text from that file. Try a text-based PDF or another document.";
  if (/not found on disk|file data is missing/i.test(raw)) return "That file is in your bag index but the file data is missing. Re-import it from Canvas or upload it again.";
  if (/timed out/i.test(raw)) return "That took too long. Try a shorter skill prompt or a smaller file.";
  return raw;
}

function emitChat(id: string, payload: any) {
  let live = chatLive.get(id);
  if (!live) {
    live = { events: [] };
    chatLive.set(id, live);
  }
  if (payload?.type === "answer" || payload?.type === "error") {
    live.finalAnswer = payload;
    live.events = [];
  } else if (!live.finalAnswer) {
    if (payload?.type === "delta" && typeof payload.text === "string") {
      const last = live.events[live.events.length - 1];
      if (last?.type === "delta") last.text += payload.text;
      else live.events.push({ type: "delta", text: payload.text });
    } else {
      live.events.push(payload);
    }
  }
  emitToAll(chatSockets.get(id), payload);
}

export function chatRoutes(app: any) {
  app.ws("/ws/chat", (ws: any, req: any) => {
    const url = new URL(req.url, "http://localhost");
    const chatId = url.searchParams.get("chatId");
    if (!chatId) {
      return ws.close(1008, "chatId required");
    }

    let set = chatSockets.get(chatId);
    if (!set) {
      set = new Set();
      chatSockets.set(chatId, set);
    }
    set.add(ws);

    ws.on("close", (code: number, reason: string) => {
      set!.delete(ws);
      if (set!.size === 0) chatSockets.delete(chatId);
    });

    ws.send(JSON.stringify({ type: "ready", chatId }));
    const live = chatLive.get(chatId);
    if (live?.finalAnswer) {
      ws.send(JSON.stringify(live.finalAnswer));
    } else if (live?.events?.length) {
      for (const ev of live.events) ws.send(JSON.stringify(ev));
    }
  });

  app.post("/chat/import", async (req: any, res: any, next: any) => {
    try {
      const ct = String(req.headers["content-type"] || "");
      if (!ct.includes("multipart/form-data")) {
        return res.status(400).send({ error: "multipart/form-data required" });
      }

      const { chatId: existingChatId, title, files } = await parseImportMultipart(req);
      if (!files.length) return res.status(400).send({ error: "at least one file required" });

      let chat = existingChatId ? await getChat(existingChatId) : undefined;
      if (!chat) chat = await mkChat(title || files[0]?.filename || "Canvas import");
      const id = chat.id;
      const ns = `chat:${id}`;

      const imported: Array<Omit<LibraryFile, "id" | "created"> & { id?: string }> = [];
      for (const f of files) {
        imported.push({
          id: storageRel(f.path),
          filename: f.filename,
          mimeType: f.mimeType,
          size: fileSize(f.path),
          chatId: id,
          source: importSource(title),
        });
      }
      const saved = await addLibraryFiles(imported);

      for (const f of files) {
        try {
          await handleUpload({
            filePath: f.path,
            filename: f.filename,
            contentType: f.mimeType,
            namespace: ns,
          });
        } catch (err: any) {
          console.error("[chat/import] process", f.filename, err?.message || err);
        }
      }
      const names = saved.map((f) => `- ${f.filename}`).join("\n");
      await addMsg(id, {
        role: "user",
        content: `Imported ${saved.length} file${saved.length === 1 ? "" : "s"}:\n${names}`,
        at: Date.now(),
      });
      await addMsg(id, {
        role: "assistant",
        content:
          saved.length === 1
            ? `I've added **${saved[0].filename}** to this chat and your learning bag. Ask me anything about it.`
            : `I've added **${saved.length} files** to this chat and your learning bag. Ask me anything about them.`,
        at: Date.now(),
      });

      res.send({ ok: true, chatId: id, imported: saved.length, files: saved });
    } catch (e: any) {
      console.error("[chat/import]", e?.message || e);
      const msg = String(e?.message || "import failed");
      if (/unsupported file type/i.test(msg)) {
        return res.status(400).send({ error: msg });
      }
      if (/no valid content/i.test(msg)) {
        return res.status(400).send({ error: "Could not extract text from this file. Try a different PDF or document." });
      }
      res.status(500).send({ error: msg });
    }
  });

  app.post("/chat", async (req: any, res: any, next: any) => {
    const t0 = Date.now();
    try {
      const ct = String(req.headers["content-type"] || "");
      const isMp = ct.includes("multipart/form-data");

      let q = "";
      let chatId: string | undefined;
      let files: UpFile[] = [];
      let fileIds: string[] = [];
      let length: ResponseLength | undefined;

      if (isMp) {
        const { q: mq, chatId: mcid, files: mf, length: ml, fileIds: mid } = await parseMultipart(req);
        q = mq;
        chatId = mcid;
        files = mf || [];
        fileIds = mid || [];
        length = parseLength(ml);
        if (!q)
          return res.status(400).send({ error: "q required for file uploads" });
      } else {
        q = req.body?.q || "";
        chatId = req.body?.chatId;
        length = parseLength(req.body?.length);
        fileIds = Array.isArray(req.body?.fileIds)
          ? req.body.fileIds.map((id: unknown) => String(id || "").trim()).filter(Boolean)
          : (req.body?.fileId ? [String(req.body.fileId)] : []);
        if (!q) return res.status(400).send({ error: "q required" });
      }

      let chat = chatId ? await getChat(chatId) : undefined;
      if (!chat) chat = await mkChat(q);
      const id = chat.id;
      const ns = `chat:${id}`;
      const ctx = userContext.getStore();
      const msgHistory = await getMsgs(id);
      const relevantHistory = msgHistory.slice(-20);
      await addMsg(id, { role: "user", content: q, at: Date.now() });

      res
        .status(202)
        .send({ ok: true, chatId: id, stream: `/ws/chat?chatId=${id}` });

      const failChat = async (raw: string) => {
        const msg = friendlyChatError(raw);
        console.error("[chat] err inner", { chatId: id, msg: raw });
        await addMsg(id, { role: "assistant", content: msg, at: Date.now() });
        emitChat(id, { type: "error", error: msg });
        emitChat(id, { type: "done" });
      };

      const runJob = async () => {
        try {
          const existing: UpFile[] = [];
          for (const fileId of fileIds) {
            const found = await resolveLibrarySource(fileId);
            if (!found) throw new Error(`That file is in your bag index but the file data is missing. Re-import it from Canvas or upload it again. (${fileId})`);
            existing.push(found);
          }
          const toIndex = [...existing, ...files];
          if (toIndex.length) {
            emitChat(id, { type: "phase", value: "upload_start" });
            const uploaded: Array<Omit<LibraryFile, "id" | "created"> & { id?: string }> = [];
            for (const f of toIndex) {
              emitChat(id, { type: "file", filename: f.filename, mime: f.mimeType });
              await handleUpload({
                filePath: f.path,
                filename: f.filename,
                contentType: f.mimeType,
                namespace: ns,
              });
              if (!fileIds.length) {
                uploaded.push({
                  id: storageRel(f.path),
                  filename: f.filename,
                  mimeType: f.mimeType,
                  size: fileSize(f.path),
                  chatId: id,
                  source: "upload" as const,
                });
              }
            }
            if (uploaded.length) await addLibraryFiles(uploaded);
            emitChat(id, { type: "phase", value: "upload_done" });
          }

          emitChat(id, { type: "phase", value: "generating" });
          const answer = await handleChatAsk({
            question: q,
            namespace: ns,
            history: relevantHistory,
            length,
            onDelta: (text) => emitChat(id, { type: "delta", text }),
          });

          await addMsg(id, {
            role: "assistant",
            content: answer,
            at: Date.now(),
          });
          if (answer.flashcards?.length && toIndex.length) {
            const group = toIndex.map((f) => f.filename).filter(Boolean).join(" + ");
            try {
              await saveFlashcardsToGroup(group, answer.flashcards);
            } catch (err: any) {
              console.warn("[chat] flashcard save skipped", err?.message || err);
            }
          }
          emitChat(id, { type: "answer", answer });
          emitChat(id, { type: "done" });
        } catch (err: any) {
          await failChat(err?.message || "failed");
        }
      };

      void (async () => {
        if (ctx) userContext.enterWith(ctx);
        await runJob();
      })().catch((e: any) => {
        console.error("[chat] err runner", e?.message || e);
      });
    } catch (e: any) {
      console.error("[chat] err outer", e?.message || e);
      next(e);
    }
  });

  app.get("/chats", async (_: any, res: any) => {
    const t = Date.now();
    const chats = await listChats();
    res.send({ ok: true, chats });
  });

  app.get("/chats/:id", async (req: any, res: any) => {
    const t = Date.now();
    const id = req.params.id;
    const chat = await getChat(id);
    if (!chat) {
      return res.status(404).send({ error: "not found" });
    }
    const messages = await getMsgs(id);
    res.send({ ok: true, chat, messages });
  });
}
