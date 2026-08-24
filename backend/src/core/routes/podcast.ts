import path from "path"
import fs from "fs"
import { makeScript, makeAudio } from "../../services/podcast"
import { emitToAll } from "../../utils/chat/ws"
import { config } from "../../config/env"
import {
  hydrateFromR2,
  isCloudStorage,
  resolveStorage,
  r2List,
  storageRel,
  writeStorage,
} from "../../utils/storage/store"

const sockets = new Map<string, Set<any>>()
const pendingJobs = new Map<string, () => Promise<void>>()
const completed = new Map<string, { file: string; filename: string; title?: string }>()

function emit(id: string, msg: any) {
  emitToAll(sockets.get(id), msg)
}

function publicFileUrl(pid: string, filename: string) {
  return `/podcast/download/${encodeURIComponent(pid)}/${encodeURIComponent(filename)}`
}

function isFinalMp3(filename: string) {
  return /\.mp3$/i.test(filename) && !/\.\d+\.mp3$/i.test(filename)
}

function titleFromFilename(filename: string) {
  return filename.replace(/\.mp3$/i, "").replace(/_/g, " ").trim() || "Podcast"
}

async function startJobIfReady(pid: string) {
  const job = pendingJobs.get(pid)
  const hasSockets = sockets.has(pid) && sockets.get(pid)!.size > 0

  if (job && hasSockets) {
    pendingJobs.delete(pid)
    try {
      await job()
    } catch (err) {
      emit(pid, { type: "error", error: String(err) })
    }
  }
}

async function listUserPodcasts() {
  const items = new Map<string, { pid: string; filename: string; title: string; url: string; createdAt: number }>()
  const root = resolveStorage("podcasts")

  const add = (pid: string, filename: string, createdAt: number, title?: string) => {
    if (!pid || !isFinalMp3(filename)) return
    const key = `${pid}/${filename}`
    const prev = items.get(key)
    items.set(key, {
      pid,
      filename,
      title: title || prev?.title || titleFromFilename(filename),
      url: publicFileUrl(pid, filename),
      createdAt: Math.max(createdAt, prev?.createdAt || 0),
    })
  }

  if (fs.existsSync(root)) {
    for (const pid of fs.readdirSync(root)) {
      const dir = path.join(root, pid)
      if (!fs.statSync(dir).isDirectory()) continue
      let metaTitle = ""
      const metaPath = path.join(dir, "meta.json")
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"))
          metaTitle = String(meta.title || meta.topic || "")
        } catch {}
      }
      for (const filename of fs.readdirSync(dir)) {
        const full = path.join(dir, filename)
        const st = fs.statSync(full)
        if (st.isFile()) add(pid, filename, st.mtimeMs, metaTitle)
      }
    }
  }

  if (isCloudStorage()) {
    const prefix = storageRel(root).replace(/\\/g, "/")
    const keys = await r2List(prefix ? `${prefix.replace(/\/$/, "")}/` : "podcasts/")
    for (const key of keys) {
      const parts = key.replace(/\\/g, "/").split("/").filter(Boolean)
      const filename = parts[parts.length - 1]
      const pid = parts[parts.length - 2]
      if (filename && pid) add(pid, filename, 0)
    }
  }

  return [...items.values()].sort((a, b) => b.createdAt - a.createdAt)
}

export function podcastRoutes(app: any) {
  app.ws("/ws/podcast", (ws: any, req: any) => {
    const u = new URL(req.url, config.baseUrl || "http://dummy")
    const pid = u.searchParams.get("pid")

    if (!pid) {
      return ws.close(1008, "pid required")
    }

    let set = sockets.get(pid)
    if (!set) {
      set = new Set()
      sockets.set(pid, set)
    }
    set.add(ws)

    const ping = setInterval(() => {
      try {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: "ping", t: Date.now() }))
      } catch {}
    }, 15000)

    ws.on("close", () => {
      clearInterval(ping)
      set!.delete(ws)
      if (set!.size === 0) sockets.delete(pid)
    })

    ws.send(JSON.stringify({ type: "ready", pid }))

    const done = completed.get(pid)
    if (done) {
      ws.send(JSON.stringify({ type: "audio", file: done.file, filename: done.filename, pid }))
      ws.send(JSON.stringify({ type: "done", file: done.file, filename: done.filename, pid }))
    }

    setTimeout(() => {
      startJobIfReady(pid).catch((err) => {
        console.error(`[Podcast WS] Error starting job:`, err)
      })
    }, 100)
  })

  app.get("/podcast", async (_req: any, res: any, next: any) => {
    try {
      res.send({ ok: true, podcasts: await listUserPodcasts() })
    } catch (e) {
      next(e)
    }
  })

  app.post("/podcast", async (req: any, res: any, next: any) => {
    try {
      const topic = String(req.body?.topic || req.body?.title || "").trim()

      if (!topic) {
        return res.status(400).send({ error: "topic required" })
      }

      const pid = cryptoRandom()
      const dir = resolveStorage("podcasts", pid)
      const base = topic.replace(/[^a-z0-9]/gi, "_").slice(0, 50) || "podcast"

      res.status(202).send({ ok: true, pid, stream: `/ws/podcast?pid=${pid}` })

      const job = async () => {
        try {
          emit(pid, { type: "phase", value: "Writing script…" })
          const script = await makeScript(topic, topic)
          emit(pid, { type: "script", data: script })
          emit(pid, { type: "phase", value: "Creating audio…" })

          const outPath = await makeAudio(script, dir, base, (m) => {
            if (m?.type === "audio_progress") {
              emit(pid, { type: "phase", value: `Creating audio… ${Number(m.i) + 1}/${m.len}` })
              return
            }
            emit(pid, m)
          })
          if (!fs.existsSync(outPath)) {
            throw new Error(`Audio file not created at ${outPath}`)
          }
          await writeStorage(storageRel(outPath), fs.readFileSync(outPath))
          const filename = path.basename(outPath)
          const title = String(script.title || topic || titleFromFilename(filename))
          await writeStorage(
            storageRel(path.join(dir, "meta.json")),
            JSON.stringify({ topic, title, filename, createdAt: Date.now() })
          )
          const file = publicFileUrl(pid, filename)
          const audioMessage = { type: "audio", file, filename, pid, title }
          completed.set(pid, { file, filename, title })
          emit(pid, audioMessage)
          emit(pid, { type: "done", file, filename, pid, title })
        } catch (e: any) {
          emit(pid, { type: "error", error: e?.message || "failed" })
        }
      }

      pendingJobs.set(pid, job)

      startJobIfReady(pid).catch((err) => {
        console.error(`[Podcast POST] Error starting job:`, err)
      })
    } catch (e) {
      next(e)
    }
  })

  app.get("/podcast/download/:pid/:filename", async (req: any, res: any, next: any) => {
    try {
      const pid = path.basename(String(req.params.pid || ""))
      const filename = path.basename(decodeURIComponent(String(req.params.filename || "")))
      if (!pid || !filename || filename.includes("..")) {
        return res.status(400).send({ error: "invalid filename" })
      }

      const dirPath = resolveStorage("podcasts", pid)
      const wanted = path.join(dirPath, filename)
      await hydrateFromR2(storageRel(wanted))

      let filePath = wanted
      if (!fs.existsSync(filePath) && fs.existsSync(dirPath)) {
        const match = fs.readdirSync(dirPath).find((f) => f.toLowerCase() === filename.toLowerCase())
        if (match) filePath = path.join(dirPath, match)
      }
      if (!fs.existsSync(filePath)) {
        return res.status(404).send({ error: "File not found" })
      }

      const actualFilename = path.basename(filePath)
      const fileStats = fs.statSync(filePath)
      res.setHeader("Content-Type", "audio/mpeg")
      res.setHeader("Content-Disposition", `attachment; filename="${actualFilename}"`)
      res.setHeader("Content-Length", fileStats.size)
      fs.createReadStream(filePath).pipe(res)
    } catch (e) {
      next(e)
    }
  })
}

function cryptoRandom() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
