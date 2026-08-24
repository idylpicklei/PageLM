import { useEffect, useRef, useState } from "react"
import { useLocation } from "react-router-dom"
import {
  connectPodcastStream,
  listPodcasts,
  podcastDownloadUrl,
  podcastStart,
  type PodcastEvent,
  type PodcastItem,
} from "../../lib/api"
import { env } from "../../config/env"

const GENERATE_TIMEOUT_MS = 10 * 60 * 1000

function mediaUrl(file?: string, pid?: string, filename?: string) {
  if (pid && filename) return podcastDownloadUrl(pid, filename)
  if (!file) return ""
  if (file.startsWith("http://") || file.startsWith("https://")) {
    try {
      const u = new URL(file)
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
        return `${env.backend}${u.pathname}`
      }
    } catch {}
    return file
  }
  return `${env.backend}${file.startsWith("/") ? file : `/${file}`}`
}

export default function PodcastGenerator() {
  const location = useLocation()
  const [topic, setTopic] = useState("")
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState("")
  const [audioFile, setAudioFile] = useState<string | null>(null)
  const [audioFilename, setAudioFilename] = useState<string | null>(null)
  const [podcasts, setPodcasts] = useState<PodcastItem[]>([])
  const audioFileRef = useRef<string | null>(null)
  const closeRef = useRef<(() => void) | null>(null)

  const showAudio = (file?: string, filename?: string, pid?: string) => {
    const url = mediaUrl(file, pid, filename)
    if (!url) return
    audioFileRef.current = url
    setAudioFile(url)
    setAudioFilename(filename || "podcast.mp3")
  }

  const refreshList = async () => {
    try {
      const res = await listPodcasts()
      setPodcasts(res.podcasts || [])
    } catch {
      // listing is best-effort; generation still works without it
    }
  }

  const listen = (pid: string) => {
    closeRef.current?.()
    const { close } = connectPodcastStream(pid, async (ev: PodcastEvent) => {
      if (ev.type === "ready") setStatus("Connected, generating…")
      if (ev.type === "phase" && ev.value) setStatus(ev.value)
      if (ev.type === "script") setStatus("Script ready, creating audio…")
      if (ev.type === "audio") {
        showAudio(ev.file || ev.staticUrl, ev.filename, ev.pid || pid)
        setStatus("Podcast ready")
      }
      if (ev.type === "done") {
        showAudio(ev.file, ev.filename, ev.pid || pid)
        try {
          const res = await listPodcasts()
          const items = res.podcasts || []
          setPodcasts(items)
          if (!audioFileRef.current) {
            const mine = items.find((p) => p.pid === pid)
            if (mine) showAudio(mine.url, mine.filename, mine.pid)
          }
        } catch {}
        setStatus(audioFileRef.current ? "Podcast ready" : "Done")
        setBusy(false)
        setTimeout(close, 1000)
      }
      if (ev.type === "error") {
        setStatus(`Error: ${ev.error}`)
        close()
        setBusy(false)
      }
    })
    closeRef.current = close
    return close
  }

  useEffect(() => {
    void refreshList()
    return () => closeRef.current?.()
  }, [])

  useEffect(() => {
    const podcastPid = location.state?.podcastPid as string | undefined
    if (!podcastPid) return
    setTopic(location.state?.podcastTopic || "")
    setBusy(true)
    setStatus("Connecting to podcast generation…")
    const close = listen(podcastPid)
    const timeout = setTimeout(() => {
      setStatus("Error: Timeout — generation took too long. Check Saved podcasts below if the file finished.")
      setBusy(false)
      close()
      void refreshList()
    }, GENERATE_TIMEOUT_MS)
    return () => {
      clearTimeout(timeout)
      close()
    }
  }, [location.state?.podcastPid])

  const onGenerate = async () => {
    if (!topic.trim() || busy) return

    setBusy(true)
    setStatus("Starting…")
    audioFileRef.current = null
    setAudioFile(null)
    setAudioFilename(null)

    try {
      const { pid } = await podcastStart({ topic })
      const close = listen(pid)
      const timeout = setTimeout(() => {
        setStatus("Error: Timeout — generation took too long. Check Saved podcasts below if the file finished.")
        setBusy(false)
        close()
        void refreshList()
      }, GENERATE_TIMEOUT_MS)
      const prev = closeRef.current
      closeRef.current = () => {
        clearTimeout(timeout)
        prev?.()
      }
    } catch (e: unknown) {
      setStatus((e as Error).message || "Failed")
      setBusy(false)
    }
  }

  return (
    <div className="group rounded-2xl bg-stone-950 border border-zinc-800 p-4 hover:border-purple-500/50 transition-all duration-300 hover:shadow-lg hover:shadow-purple-500/10">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <div className="text-xs uppercase tracking-wide text-purple-400 font-semibold">podcast generator</div>
            <div className="w-2 h-2 rounded-full bg-gradient-to-r from-purple-400 to-pink-400 animate-pulse"></div>
          </div>
          <div className="text-white font-semibold text-xl mb-2">AI Podcast</div>
          <div className="text-stone-300 text-sm leading-relaxed">
            Generate engaging podcasts from any topic or notes. Perfect for learning on the go.
          </div>
        </div>
      </div>

      <div className="mt-6 space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Enter topic or paste notes..."
              className="w-full px-4 py-3 pr-16 rounded-xl bg-stone-900/70 border border-zinc-700 text-white placeholder-zinc-400 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 outline-none transition-all duration-300"
              onKeyDown={(e) => e.key === "Enter" && onGenerate()}
            />
          </div>
          <button
            onClick={onGenerate}
            disabled={busy || !topic.trim()}
            className="px-6 py-3 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium transition-all duration-300"
          >
            {busy ? "Generating…" : "Generate"}
          </button>
        </div>

        {status && (
          <div className="p-4 rounded-xl bg-purple-950/40 border border-purple-800/40 text-purple-200 font-medium">
            {status}
          </div>
        )}

        {audioFile && (
          <div className="space-y-3">
            <div className="p-4 rounded-xl bg-stone-900/70 border border-zinc-700">
              <div className="text-sm text-stone-400 mb-2">Preview</div>
              <audio controls className="w-full" src={audioFile}>
                Your browser does not support the audio element.
              </audio>
            </div>

            <a
              href={audioFile}
              download={audioFilename || "podcast.mp3"}
              className="block p-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-medium text-center transition-all duration-300 shadow-lg hover:shadow-emerald-500/20"
            >
              Download Podcast
            </a>
          </div>
        )}

        {podcasts.length > 0 && (
          <div className="rounded-xl border border-zinc-800 bg-stone-900/40 p-3 space-y-2">
            <div className="text-xs uppercase tracking-wide text-stone-400 font-semibold">Saved podcasts</div>
            {podcasts.map((item) => {
              const url = mediaUrl(item.url, item.pid, item.filename)
              return (
                <div key={`${item.pid}-${item.filename}`} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0 text-sm text-stone-200 truncate">{item.title}</div>
                  <button
                    type="button"
                    onClick={() => showAudio(item.url, item.filename, item.pid)}
                    className="text-xs text-purple-300 hover:text-white"
                  >
                    Play
                  </button>
                  <a
                    href={url}
                    download={item.filename}
                    className="text-xs text-emerald-300 hover:text-white"
                  >
                    Download
                  </a>
                </div>
              )
            })}
          </div>
        )}

        {!audioFile && !busy && podcasts.length === 0 && (
          <div className="text-xs text-stone-500 text-center p-2">
            Click Generate to create a podcast. When it finishes, a download button will appear here.
          </div>
        )}
      </div>
    </div>
  )
}
