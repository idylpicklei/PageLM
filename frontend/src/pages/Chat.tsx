import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { env } from "../config/env";
import { adaptiveToast } from "@cognicatch/react";
import { chatJSON, getChatDetail, getResponseLength, type FlashCard, createFlashcard, listFlashcards, deleteFlashcard, getChats, type ChatMessage, type LibraryFile, type BagSkill, podcastStart, listLibraryFiles, clearLibraryFiles, listSkills } from "../lib/api";
import MarkdownView from "../components/Chat/MarkdownView";
import ActionRow from "../components/Chat/ActionRow";
import FlashCards from "../components/Chat/FlashCards";
import SelectionPopup from "../components/Chat/SelectionPopup";
import Composer from "../components/Chat/Composer";
import BagFab from "../components/Chat/BagFab";
import BagDrawer from "../components/Chat/BagDrawer";
import LoadingIndicator from "../components/Chat/LoadingIndicator";
import { useCompanion } from "../components/Companion/CompanionProvider";

type BagItem = { id: string; kind: "flashcard" | "note"; title: string; content: string; group?: string };

function extractFirstJsonObject(s: string): string {
  let depth = 0, start = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "{") { if (depth === 0) start = i; depth++; }
    else if (ch === "}") { depth--; if (depth === 0 && start !== -1) return s.slice(start, i + 1); }
  }
  return "";
}

function asCardText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try { return JSON.stringify(value); } catch { return ""; }
}

function sanitizeCards(cards: unknown): FlashCard[] {
  if (!Array.isArray(cards)) return [];
  return cards.flatMap((card) => {
    if (!card || typeof card !== "object") return [];
    const raw = card as Record<string, unknown>;
    const q = asCardText(raw.q ?? raw.question);
    const a = asCardText(raw.a ?? raw.answer);
    if (!q && !a) return [];
    return [{
      q,
      a,
      tags: Array.isArray(raw.tags) ? raw.tags.map(asCardText) : [],
    }];
  });
}

function normalizePayload(payload: unknown): { md: string; flashcards: FlashCard[]; topic?: string } {
  if (typeof payload === "string") {
    const s = payload.trim();
    if (s.startsWith("{") && s.endsWith("}")) {
      try { const obj = JSON.parse(s); return { md: String(obj?.answer || ""), flashcards: sanitizeCards(obj?.flashcards), topic: typeof obj?.topic === "string" ? obj.topic : undefined }; } catch { }
    }
    const inner = extractFirstJsonObject(s);
    if (inner) {
      try { const obj = JSON.parse(inner); return { md: String(obj?.answer || ""), flashcards: sanitizeCards(obj?.flashcards), topic: typeof obj?.topic === "string" ? obj.topic : undefined }; } catch { }
    }
    return { md: s, flashcards: [] };
  }
  if (payload && typeof payload === "object") {
    const o = payload as any;
    return { md: String(o?.answer || o?.html || ""), flashcards: sanitizeCards(o?.flashcards), topic: typeof o?.topic === "string" ? o.topic : undefined };
  }
  return { md: "", flashcards: [] };
}

function deriveTopicFromMarkdown(md: string): string {
  const m = md.match(/^\s*#{1,6}\s+(.+?)\s*$/m);
  return m ? m[1].trim() : "";
}

const ANSWER_WAIT_MS = 180_000;
const POLL_MS = 2500;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) =>
    m.role === "assistant" ? { ...m, content: normalizePayload((m as any).content).md } : m
  );
}

function lastAssistantText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") return String(messages[i].content || "");
  }
  return "";
}

function isRicher(remote: ChatMessage[], local: ChatMessage[]): boolean {
  if (!remote.length) return false;
  if (!local.length) return true;
  if (remote.length > local.length) return true;
  if (remote.length < local.length) return false;
  return lastAssistantText(remote).length > lastAssistantText(local).length;
}

export default function Chat() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation() as any;
  const state = (location?.state || {}) as {
    chatId?: string;
    q?: string;
    answer?: string | { html?: string; answer?: string; flashcards?: FlashCard[]; topic?: string };
    flashcards?: FlashCard[];
  };

  const initialChatId = search.get("chatId") || state.chatId || "";
  const initialQuestion = search.get("q") || state.q || "";

  const [chatId, setChatId] = useState(initialChatId);
  const [messages, setMessages] = useState<ChatMessage[] | undefined>([]);
  const [cards, setCards] = useState<FlashCard[]>([]);
  const [bagOpen, setBagOpen] = useState(false);
  const [bag, setBag] = useState<BagItem[]>([]);
  const [bagFiles, setBagFiles] = useState<LibraryFile[]>([]);
  const [bagSkills, setBagSkills] = useState<BagSkill[]>([]);
  const [selected, setSelected] = useState<{ text: string; x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState<boolean>(!!(initialChatId || initialQuestion));
  const [awaitingAnswer, setAwaitingAnswer] = useState<boolean>(false);
  const [topic, setTopic] = useState<string>("");
  const { setDocument } = useCompanion();

  const selPopupRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const generatingRef = useRef(false);
  const bootRef = useRef(false);
  const pollGenRef = useRef(0);
  const waitingSinceRef = useRef(0);
  const skipHydrateRef = useRef(false);
  const seededRef = useRef(false);
  const keyFor = (kind: BagItem["kind"], title: string, content: string) =>
    `${kind}:${title.trim().toLowerCase()}|${content.trim().toLowerCase()}`;

  const finishWaiting = () => {
    generatingRef.current = false;
    setAwaitingAnswer(false);
    setConnecting(false);
  };

  const applyChatMessages = (raw: ChatMessage[], force = false) => {
    const normalized = normalizeMessages(raw);
    let applied = force;
    setMessages((prev) => {
      const local = Array.isArray(prev) ? prev : [];
      if (!force && !isRicher(normalized, local)) return local;
      applied = true;
      return normalized;
    });
    if (!applied && !force) return normalized;
    for (let i = normalized.length - 1; i >= 0; i--) {
      if (normalized[i].role !== "assistant") continue;
      const n = normalizePayload((raw[i] as any).content);
      if (n.flashcards.length) setCards(n.flashcards);
      if (n.topic) setTopic(n.topic);
      else if (n.md) setTopic((t) => t || deriveTopicFromMarkdown(n.md));
      break;
    }
    return normalized;
  };

  const pollForAnswer = async (id: string, startedAt: number) => {
    const gen = ++pollGenRef.current;
    const deadline = startedAt + ANSWER_WAIT_MS;
    while (Date.now() < deadline && generatingRef.current && gen === pollGenRef.current) {
      await sleep(POLL_MS);
      if (!generatingRef.current || gen !== pollGenRef.current) return;
      try {
        const res = await getChatDetail(id);
        if (!res?.ok || !Array.isArray(res.messages)) continue;
        applyChatMessages(res.messages);
        const latest = [...res.messages].reverse().find((m) => m.role === "assistant");
        if (latest && (latest.at || 0) >= startedAt - 2000) {
          finishWaiting();
          return;
        }
      } catch {
        // Container may still be coming back up.
      }
    }
    if (generatingRef.current && gen === pollGenRef.current) {
      finishWaiting();
      adaptiveToast.error("Reply timed out", "The chat connection dropped. Please send your question again.");
    }
  };

  useEffect(() => {
    if (!initialChatId && !initialQuestion) {
      (async () => {
        try {
          setConnecting(true);
          const res = await getChats();
          const list = Array.isArray(res?.chats) ? res.chats : [];
          if (list.length) {
            const latest = [...list].sort((a: any, b: any) => (b.at || 0) - (a.at || 0))[0];
            if (latest?.id) {
              setChatId(latest.id);
              navigate(`/chat?chatId=${encodeURIComponent(latest.id)}`, { replace: true, state: { chatId: latest.id } });
            } else {
              navigate("/", { replace: true });
            }
          } else {
            navigate("/", { replace: true });
          }
        } catch {
          navigate("/", { replace: true });
        }
      })();
    }
  }, [initialChatId, initialQuestion, navigate]);

  useEffect(() => {
    const cid = search.get("chatId") || state.chatId || "";
    if (cid && cid !== chatId) {
      setChatId(cid);
      setMessages([]);
      setCards([]);
      setTopic("");
      seededRef.current = false;
      generatingRef.current = true;
      setAwaitingAnswer(true);
      setConnecting(true);
    }
    if (seededRef.current) return;
    if (state.answer) {
      const init = normalizePayload(state.answer);
      const seed: ChatMessage[] = [];
      if (initialQuestion) seed.push({ role: "user", content: initialQuestion, at: Date.now() });
      if (init.md) seed.push({ role: "assistant", content: init.md, at: Date.now() });
      if (seed.length) setMessages(seed);
      if ((init.flashcards?.length || state.flashcards?.length)) setCards(init.flashcards?.length ? init.flashcards : (state.flashcards || []));
      if (init.topic) setTopic(init.topic || "");
      else if (init.md) setTopic(deriveTopicFromMarkdown(init.md));
      seededRef.current = true;
      return;
    }
    if (initialQuestion) {
      setMessages((prev) => (Array.isArray(prev) && prev.length ? prev : [{ role: "user", content: initialQuestion, at: Date.now() }]));
      setAwaitingAnswer(true);
      seededRef.current = true;
    }
  }, [search, state.chatId, state.answer, state.flashcards, initialQuestion]);

  useEffect(() => {
    if (bootRef.current || !initialQuestion || initialChatId) return;
    bootRef.current = true;
    generatingRef.current = true;
    setAwaitingAnswer(true);
    const length = (search.get("length") as "short" | "medium" | "long" | null) || getResponseLength();
    const startedAt = Date.now();
    waitingSinceRef.current = startedAt;
    chatJSON({ q: initialQuestion, length })
      .then((r) => {
        if (!r?.chatId) return;
        skipHydrateRef.current = true;
        setChatId(r.chatId);
        navigate(`/chat?chatId=${encodeURIComponent(r.chatId)}`, {
          replace: true,
          state: { chatId: r.chatId, q: initialQuestion },
        });
        void pollForAnswer(r.chatId, startedAt);
      })
      .catch(() => {
        finishWaiting();
        adaptiveToast.error("Failed to start chat", "There was a problem reaching the AI. Please try sending your prompt again.");
      });
  }, [initialChatId, initialQuestion, navigate, search]);

  useEffect(() => {
    if (!chatId) return;
    if (skipHydrateRef.current) {
      skipHydrateRef.current = false;
      return;
    }
    getChatDetail(chatId)
      .then((res) => {
        const remote = res?.ok && Array.isArray(res.messages) ? res.messages : [];
        if (remote.length) applyChatMessages(remote);
        const latest = [...remote].reverse().find((m) => m.role === "assistant");
        if (latest && generatingRef.current && (latest.at || 0) >= waitingSinceRef.current - 2000) {
          finishWaiting();
          return;
        }
        if (!latest) {
          generatingRef.current = true;
          setAwaitingAnswer(true);
          waitingSinceRef.current = waitingSinceRef.current || Date.now();
          void pollForAnswer(chatId, waitingSinceRef.current);
        }
        setConnecting(false);
      })
      .catch(() => {
        generatingRef.current = true;
        setAwaitingAnswer(true);
        setConnecting(false);
      });
  }, [chatId]);

  useEffect(() => {
    if (!chatId) return;
    let disposed = false;
    let attempts = 0;
    let retryTimer: number | undefined;
    const wsUrl = (env.backend || window.location.origin).replace(/^http/, "ws") + `/ws/chat?chatId=${encodeURIComponent(chatId)}`;

    const handleEvent = (m: any) => {
      if (m?.type === "delta" && typeof m.text === "string") {
        setAwaitingAnswer(false);
        setConnecting(false);
        setMessages((prev) => {
          const arr = [...(Array.isArray(prev) ? prev : [])];
          const last = arr[arr.length - 1];
          if (last?.role === "assistant") {
            arr[arr.length - 1] = { ...last, content: `${last.content}${m.text}` };
            return arr;
          }
          arr.push({ role: "assistant", content: m.text, at: Date.now() });
          return arr;
        });
        return;
      }
      if (m?.type === "answer") {
        const norm = normalizePayload(m.answer);
        pollGenRef.current += 1;
        finishWaiting();
        setMessages((prev) => {
          const arr = [...(Array.isArray(prev) ? prev : [])];
          const last = arr[arr.length - 1];
          if (last?.role === "assistant") {
            arr[arr.length - 1] = { ...last, content: norm.md || last.content };
            return arr;
          }
          if (norm.md) arr.push({ role: "assistant", content: norm.md, at: Date.now() });
          return arr;
        });
        if (norm.flashcards.length) {
          setCards(norm.flashcards);
          void refreshBag();
        }
        if (norm.topic) setTopic(norm.topic);
        else if (norm.md) setTopic((t) => t || deriveTopicFromMarkdown(norm.md));
        setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 0);
      }
      if (m?.type === "error") {
        pollGenRef.current += 1;
        finishWaiting();
        const errText = m.error || "The AI could not finish that reply. Please try again.";
        setMessages((prev) => {
          const arr = [...(Array.isArray(prev) ? prev : [])];
          if (!arr.some((msg) => msg.role === "assistant")) {
            arr.push({ role: "assistant", content: errText, at: Date.now() });
          }
          return arr;
        });
        adaptiveToast.error("Chat failed", errText);
      }
    };

    const connect = () => {
      if (disposed) return;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.onopen = () => {
        attempts = 0;
        setConnecting(false);
      };
      ws.onmessage = (ev) => {
        try { handleEvent(JSON.parse(ev.data)); } catch { }
      };
      ws.onclose = () => {
        if (disposed || wsRef.current !== ws) return;
        if (!generatingRef.current) return;
        attempts += 1;
        retryTimer = window.setTimeout(connect, Math.min(8000, 700 * 2 ** Math.min(attempts, 4)));
      };
    };

    connect();
    return () => {
      disposed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      try { wsRef.current?.close(); } catch { }
      wsRef.current = null;
    };
  }, [chatId]);

  useEffect(() => {
    const onSel = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) { setSelected(null); return; }
      const r = sel.getRangeAt(0);
      const rect = r.getBoundingClientRect();
      if (!rect || !r.toString().trim()) return;
      setSelected({ text: r.toString().trim(), x: rect.left + rect.width / 2 - 60 + window.scrollX, y: rect.bottom + window.scrollY });
    };
    const onDocClick = (e: any) => {
      const n = e.target as Node;
      if (selPopupRef.current && !selPopupRef.current.contains(n) && !window.getSelection()?.toString().trim()) setSelected(null);
    };
    document.addEventListener("mouseup", onSel);
    document.addEventListener("keyup", onSel);
    document.addEventListener("click", onDocClick);
    return () => {
      document.removeEventListener("mouseup", onSel);
      document.removeEventListener("keyup", onSel);
      document.removeEventListener("click", onDocClick);
    };
  }, []);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 0);
  }, [Array.isArray(messages) ? messages.length : 0]);

  const addToBag = async (kind: BagItem["kind"], title: string, content: string) => {
    const k = keyFor(kind, title, content);
    if (seenRef.current.has(k)) return;
    try {
      const { flashcard } = await createFlashcard({
        question: title,
        answer: content,
        tag: kind === "note" ? "note" : "core",
      });
      setBag((b) => [
        { id: flashcard.id, kind, title: flashcard.question, content: flashcard.answer },
        ...b,
      ]);
      seenRef.current.add(k);
    } catch {
      const local = { id: `${Date.now()}-${Math.random()}`, kind, title, content };
      setBag((b) => [local, ...b]);
      seenRef.current.add(k);
    }
  };

  const clearBag = async () => {
    try {
      const res = await listFlashcards();
      const items = res.flashcards || [];
      await Promise.all([
        ...items.map((c) => deleteFlashcard(c.id).catch(() => { })),
        clearLibraryFiles().catch(() => {}),
      ]);
    } catch { }
    setBag([]);
    setBagFiles([]);
    seenRef.current.clear();
  };

  const refreshBag = async () => {
    try {
      const [res, fileRes, skillList] = await Promise.all([
        listFlashcards(),
        listLibraryFiles(),
        listSkills().catch(() => ({ skills: [] as BagSkill[] })),
      ]);
      const items = (res.flashcards || []).map<BagItem>((c) => ({
        id: c.id,
        kind: c.tag === "note" ? "note" : "flashcard",
        title: c.question,
        content: c.answer,
        group: c.group,
      }));
      setBag(items.sort((a, b) => (a.id > b.id ? -1 : 1)));
      setBagFiles(fileRes.files || []);
      setBagSkills(skillList.skills || []);
      const s = new Set<string>();
      for (const it of items) s.add(keyFor(it.kind, it.title, it.content));
      seenRef.current = s;
    } catch { }
  };

  useEffect(() => {
    void refreshBag();
  }, []);

  const sendFollowup = async (q: string) => {
    const text = q.trim();
    if (!text || busy) return;
    setMessages((prev) => ([...(Array.isArray(prev) ? prev : []), { role: "user", content: text, at: Date.now() }]));
    setAwaitingAnswer(true);
    setBusy(true);
    generatingRef.current = true;
    const startedAt = Date.now();
    waitingSinceRef.current = startedAt;
    try {
      const r = await chatJSON({ q: text, chatId: chatId || undefined, length: getResponseLength() });
      const nextId = r?.chatId || chatId;
      if (r?.chatId && r.chatId !== chatId) {
        skipHydrateRef.current = true;
        setChatId(r.chatId);
      }
      if (nextId) void pollForAnswer(nextId, startedAt);
    } catch {
      finishWaiting();
      adaptiveToast.error("Failed to send", "There was a problem reaching the AI. Please try sending your prompt again.");
    } finally {
      setBusy(false);
      setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 0);
    }
  };

  const latestAssistantContent = useMemo(() => {
    const arr = Array.isArray(messages) ? messages : [];
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].role === "assistant") return arr[i].content;
    }
    return "";
  }, [messages]);

  useEffect(() => {
    if (latestAssistantContent) {
      const docTitle = topic || deriveTopicFromMarkdown(latestAssistantContent) || "Study Topic";
      const docId = chatId ? `chat:${chatId}` : "chat:current";
      setDocument({
        id: docId,
        title: docTitle,
        text: latestAssistantContent,
      });
    } else {
      setDocument(null);
    }
  }, [chatId, latestAssistantContent, setDocument, topic]);

  useEffect(() => {
    return () => {
      pollGenRef.current += 1;
      setDocument(null);
    };
  }, [setDocument]);

  const list = Array.isArray(messages) ? messages : [];

  return (
    <div className="flex flex-col min-h-screen w-full max-w-[100vw] overflow-x-hidden px-2 md:px-4 lg:pl-28 lg:pr-4">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 lg:gap-8 mt-6 md:mt-20 lg:mt-6 mb-16">
        <div className="min-w-0 flex-1 lg:pr-6">
          <div className="w-full max-w-5xl mx-auto px-0 md:p-4 pt-2 pb-28">
            <div className="space-y-4 md:space-y-6">
              {list.map((m, i) => {
                const userBubble = "inline-block max-w-[92%] md:max-w-[85%] bg-stone-900/70 border border-zinc-800 rounded-2xl px-3 py-2.5 md:px-4 md:py-3";
                if (m.role === "assistant") {
                  return (
                    <div key={i} className="w-full flex justify-start">
                      <div className="w-full mx-auto rounded-2xl md:rounded-3xl bg-stone-950/90 border border-zinc-900 shadow-[0_10px_30px_rgba(0,0,0,0.45)] ring-1 ring-black/10 backdrop-blur px-3 py-4 md:px-8 md:py-8 max-w-[min(100%,1000px)]">
                        <div className="animate-[fadeIn_300ms_ease-out] leading-7 md:leading-8">
                          <MarkdownView md={m.content} />
                        </div>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={i} className="w-full flex justify-start">
                    <div className={userBubble}>
                      <div className="text-stone-200 whitespace-pre-wrap leading-relaxed">{m.content}</div>
                    </div>
                  </div>
                );
              })}
              {((connecting && !list.length) || awaitingAnswer) && (
                <div className="w-full flex justify-start">
                  <LoadingIndicator label={connecting && !list.length ? "Connecting…" : "Thinking…"} />
                </div>
              )}
              <div ref={scrollRef} />
            </div>

            {latestAssistantContent && !awaitingAnswer && (
              <ActionRow
                disabled={busy}
                onSummarize={() => sendFollowup("Summarize the previous answer into 5–7 concise bullet points with bolded keywords.")}
                onLearnMore={() => sendFollowup("Go deeper into this topic with advanced details, real-world examples, and a short analogy.")}
                onStartQuiz={() => {
                  const t = topic || deriveTopicFromMarkdown(latestAssistantContent) || "General";
                  navigate(`/quiz?topic=${encodeURIComponent(t)}`, { state: { topic: t } });
                }}
                onCreatePodcast={async () => {
                  try {
                    const topicContent = latestAssistantContent || topic || "Generated from chat";
                    const response = await podcastStart({ topic: topicContent });
                    navigate("/tools", { state: { podcastPid: response.pid, podcastTopic: topicContent } });
                  } catch (error) {
                    console.error("Failed to create podcast:", error);
                  }
                }}
              />
            )}
          </div>
        </div>

        <FlashCards items={cards} onAdd={({ kind, title, content }) => addToBag(kind, title, content)} />
      </div>

      <SelectionPopup
        selected={selected}
        popupRef={selPopupRef}
        addNote={(text) => { addToBag("note", `Note: ${text.slice(0, 30)}${text.length > 30 ? "..." : ""}`, text); setSelected(null); }}
        askDoubt={(text) => { const v = text.trim(); if (v) sendFollowup(v); setSelected(null); }}
      />

      <Composer disabled={busy} onSend={sendFollowup} />
      <div className="hidden md:block">
        <BagFab count={bag.length + bagFiles.length} onClick={() => setBagOpen(true)} />
      </div>
      <BagDrawer
        open={bagOpen}
        items={bag}
        files={bagFiles}
        skills={bagSkills}
        onClose={() => setBagOpen(false)}
        onClear={clearBag}
        onOpenFile={(file) => {
          setBagOpen(false);
          if (file.chatId) navigate(`/chat?chatId=${encodeURIComponent(file.chatId)}`);
        }}
        onSkillChatStarted={(chatId, prompt) => navigate(`/chat?chatId=${encodeURIComponent(chatId)}&q=${encodeURIComponent(prompt || "Running skill")}`)}
      />
    </div>
  );
}
