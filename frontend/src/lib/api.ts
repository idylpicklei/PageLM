import { adaptiveToast } from "@cognicatch/react";
import { env } from "../config/env";

export type ChatStartResponse = { ok: true; chatId: string; stream: string };
export type ChatMessage = { role: "user" | "assistant"; content: string; at: number };
export type ChatInfo = { id: string; title?: string; createdAt?: number };
export type ChatsList = { ok: true; chats: ChatInfo[] };
export type ChatDetail = { ok: true; chat: ChatInfo; messages: ChatMessage[] };
export type ResponseLength = "short" | "medium" | "long";
export type ChatJSONBody = { q: string; chatId?: string; length?: ResponseLength; fileIds?: string[]; fileId?: string };
export type ChatPhase = "upload_start" | "upload_done" | "generating";
export type FlashCard = { q: string; a: string; tags?: string[] };
export type Question = { id: number; question: string; options: string[]; correct: number; hint: string; explanation: string; imageHtml?: string; };
export type QuizStartResponse = { ok: true; quizId: string; stream: string }
export type QuizEvent = { type: "ready" | "phase" | "quiz" | "done" | "error" | "ping"; quizId?: string; value?: string; quiz?: unknown; error?: string; t?: number }
export type SmartNotesStart = { ok: true; noteId: string; stream: string }
export type CompanionHistoryEntry = { role: "user" | "assistant"; content: string }
export type CompanionAnswer = { topic: string; answer: string; flashcards: FlashCard[] }
export type CompanionAskResponse = { ok: boolean; companion: CompanionAnswer }
export type SavedFlashcard = {
  id: string;
  question: string;
  answer: string;
  tag: string;
  group?: string;
  created: number;
  due?: number;
  interval?: number;
  ease?: number;
  reps?: number;
  lapses?: number;
};
export type LibraryFile = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  chatId: string;
  source: "canvas" | "upload";
  created: number;
};
export type BagSkill = {
  id: string;
  name: string;
  prompt: string;
  created: number;
};
export type ExamEvent =
  | { type: "ready"; runId: string }
  | { type: "phase"; value: string; examId?: string }
  | { type: "exam"; examId: string; payload: Question[] }
  | { type: "done" }
  | { type: "error"; examId?: string; error: string };
export type PodcastItem = {
  pid: string
  filename: string
  title: string
  url: string
  createdAt?: number
}
export type PodcastEvent =
  | { type: "ready"; pid: string }
  | { type: "phase"; value: string }
  | { type: "file"; filename: string; mime: string }
  | { type: "warn"; message: string }
  | { type: "script"; data: any }
  | { type: "audio"; file: string; filename?: string; staticUrl?: string; pid?: string; title?: string }
  | { type: "done"; file?: string; filename?: string; pid?: string; title?: string }
  | { type: "ping"; t?: number }
  | { type: "error"; error: string }
export type SmartNotesEvent =
  | { type: "ready"; noteId: string }
  | { type: "phase"; value: string }
  | { type: "file"; file: string }
  | { type: "done" }
  | { type: "error"; error: string }
  | { type: "ping"; t: number }
export type StudyMaterials = {
  summary: string;
  keyPoints: string[];
  topics: string[];
  categories: string[];
  searchableKeywords: string[];
  studyGuide: {
    mainConcepts: string[];
    importantTerms: { term: string; definition: string; }[];
    questions: string[];
    takeaways: string[];
  };
  timestamps?: { time: number; content: string; topic: string; }[];
};

export type TranscriptionResponse = {
  ok: boolean;
  jobId?: string;
  status?: "pending" | "done" | "error";
  phase?: string;
  transcription?: string;
  provider?: string;
  confidence?: number;
  error?: string;
  studyMaterials?: StudyMaterials;
}
export type ChatEvent =
  | { type: "ready"; chatId: string }
  | { type: "phase"; value: ChatPhase }
  | { type: "file"; filename: string; mime: string }
  | { type: "delta"; text: string }
  | { type: "answer"; answer: AnswerPayload }
  | { type: "done" }
  | { type: "error"; error: string };

type O<T> = Promise<T>;
type AnswerPayload = string | { answer: string; flashcards?: FlashCard[] };

export class ApiError extends Error {
  status: number;
  retryAfter?: number;

  constructor(message: string, status: number, retryAfter?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export function isSlowDownError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 429;
}

function formatRetryWait(seconds?: number): string {
  if (!seconds || seconds < 1) return "Try again in a moment.";
  if (seconds < 60) return `Try again in about ${seconds} second${seconds === 1 ? "" : "s"}.`;
  const minutes = Math.ceil(seconds / 60);
  return `Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

function parseErrorBody(txt: string): { message?: string; retryAfter?: number } {
  try {
    const data = JSON.parse(txt) as { message?: string; error?: string; retryAfter?: number };
    return {
      message: data.message || (data.error && data.error !== "rate_limited" ? data.error : undefined),
      retryAfter: typeof data.retryAfter === "number" ? data.retryAfter : undefined,
    };
  } catch {
    return {};
  }
}

function notifySlowDown(message: string, retryAfter?: number) {
  adaptiveToast.error("Please slow down", `${message} ${formatRetryWait(retryAfter)}`.trim());
}

function notifyUsageWarning(message: string) {
  const key = "pagelm.rateLimit.warnAt";
  const last = Number(sessionStorage.getItem(key) || "0");
  if (Date.now() - last < 60_000) return;
  sessionStorage.setItem(key, String(Date.now()));
  adaptiveToast.error("Please slow down", message);
}

const timeoutCtl = (ms: number) => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
};

async function req<T = unknown>(
  url: string,
  init: RequestInit & { timeout?: number; skipAuthRedirect?: boolean } = {}
): O<T> {
  const { timeout = env.timeout, skipAuthRedirect = false, ...rest } = init;
  const { signal, done } = timeoutCtl(timeout);
  try {
    const r = await fetch(url, { signal, credentials: "include", ...rest });
    if (r.status === 401 && !skipAuthRedirect) {
      const txt = await r.text().catch(() => "");
      const parsed = parseErrorBody(txt);
      const sessionExpired =
        parsed.message === "unauthorized" ||
        txt.includes('"error":"unauthorized"');
      if (sessionExpired) {
        const path = window.location.pathname;
        if (!path.startsWith("/login") && !path.startsWith("/signup")) {
          window.location.href = "/login";
        }
        throw new ApiError("unauthorized", 401);
      }
      throw new ApiError(parsed.message || r.statusText || "Request failed", 401);
    }
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      const parsed = parseErrorBody(txt);
      const retryAfterHeader = Number.parseInt(r.headers.get("Retry-After") || "", 10);
      const retryAfter = parsed.retryAfter ?? (Number.isFinite(retryAfterHeader) ? retryAfterHeader : undefined);
      const message =
        parsed.message ||
        (r.status === 429
          ? "You're sending prompts too quickly. Please slow down and try again in a moment."
          : txt || r.statusText);
      if (r.status === 429) notifySlowDown(message, retryAfter);
      throw new ApiError(message, r.status, retryAfter);
    }
    const warning = r.headers.get("X-RateLimit-Warning");
    if (warning) {
      notifyUsageWarning("You're sending a lot of prompts. Please slow down so we don't run out of AI usage.");
    }
    const ct = r.headers.get("content-type") || "";
    if (ct.includes("application/json")) return (await r.json()) as T;
    return (await r.text()) as unknown as T;
  } finally {
    done();
  }
}

const jsonHeaders = (_?: unknown) => {
  const h = new Headers();
  h.set("content-type", "application/json");
  return h;
};

function wsURL(path: string) {
  const u = new URL(env.backend);
  const proto = u.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${u.host}${path}`;
}

export { wsURL };

export type AuthUser = { id: string; email: string };

export async function authMe() {
  return req<{ ok: true; user: AuthUser }>(`${env.backend}/auth/me`, {
    method: "GET",
    skipAuthRedirect: true,
  });
}

export async function authLogin(email: string, password: string) {
  return req<{ ok: true; user: AuthUser }>(`${env.backend}/auth/login`, {
    method: "POST",
    headers: jsonHeaders({}),
    body: JSON.stringify({ email, password }),
    skipAuthRedirect: true,
  });
}

export async function authRegister(email: string, password: string) {
  return req<{ ok: true; user: AuthUser }>(`${env.backend}/auth/register`, {
    method: "POST",
    headers: jsonHeaders({}),
    body: JSON.stringify({ email, password }),
    skipAuthRedirect: true,
  });
}

export async function authLogout() {
  return req<{ ok: true }>(`${env.backend}/auth/logout`, {
    method: "POST",
    skipAuthRedirect: true,
  });
}

export type CanvasCourse = {
  id: number;
  name: string;
  code: string | null;
};

export type CanvasFile = {
  id: number;
  name: string;
  contentType: string;
  size: number;
  updatedAt: string | null;
  importable: boolean;
};

export type CanvasStatusResponse = {
  ok: true;
  connected: boolean;
  last4: string | null;
  host: string | null;
};

export async function canvasStatus() {
  return req<CanvasStatusResponse>(`${env.backend}/api/canvas/status`, { method: "GET", skipAuthRedirect: true });
}

export async function canvasSaveToken(host: string, token: string) {
  return req<{ ok: true; connected: boolean; last4: string; host: string }>(`${env.backend}/api/canvas/token`, {
    method: "PUT",
    headers: jsonHeaders({}),
    body: JSON.stringify({ host, token }),
    skipAuthRedirect: true,
  });
}

export async function canvasDisconnect() {
  return req<{ ok: true; connected: boolean }>(`${env.backend}/api/canvas/token`, {
    method: "DELETE",
    skipAuthRedirect: true,
  });
}

export async function canvasListCourses() {
  return req<{ ok: true; items: CanvasCourse[] }>(`${env.backend}/api/canvas/courses`, {
    method: "GET",
    skipAuthRedirect: true,
  });
}

export async function canvasListFiles(courseId: number | string) {
  return req<{ ok: true; items: CanvasFile[] }>(`${env.backend}/api/canvas/courses/${encodeURIComponent(String(courseId))}/files`, {
    method: "GET",
    skipAuthRedirect: true,
  });
}

export async function canvasImportFiles(body: {
  courseId: number | string;
  fileIds: Array<number | string>;
  chatId?: string;
  title?: string;
}) {
  return req<{ ok: true; chatId?: string; imported: number; warning?: string }>(`${env.backend}/api/canvas/import`, {
    method: "POST",
    headers: jsonHeaders({}),
    body: JSON.stringify(body),
    skipAuthRedirect: true,
    timeout: Math.max(env.timeout, 300000),
  });
}

const LENGTH_KEY = "pagelm.responseLength";

export function getResponseLength(): ResponseLength {
  try {
    const value = sessionStorage.getItem(LENGTH_KEY);
    if (value === "short" || value === "medium" || value === "long") return value;
  } catch {}
  return "medium";
}

export function setResponseLength(value: ResponseLength) {
  try {
    sessionStorage.setItem(LENGTH_KEY, value);
  } catch {}
}

export async function chatJSON(body: ChatJSONBody) {
  return req<ChatStartResponse>(`${env.backend}/chat`, {
    method: "POST",
    headers: jsonHeaders({}),
    body: JSON.stringify({ length: getResponseLength(), ...body }),
  });
}

export const startChat = chatJSON;

export async function chatMultipart(q: string, files: File[], chatId?: string) {
  const f = new FormData();
  f.append("q", q);
  f.append("length", getResponseLength());
  if (chatId) f.append("chatId", chatId);
  for (const file of files) f.append("file", file, file.name);
  return req<ChatStartResponse>(`${env.backend}/chat`, {
    method: "POST",
    body: f,
    timeout: Math.max(env.timeout, 300000),
  });
}

export function connectChatStream(chatId: string, onEvent: (ev: ChatEvent) => void) {
  const url = wsURL(`/ws/chat?chatId=${encodeURIComponent(chatId)}`);
  const ws = new WebSocket(url);
  ws.onmessage = (m) => {
    try {
      const data = JSON.parse(m.data as string) as ChatEvent;
      onEvent(data);
    } catch { }
  };
  ws.onerror = () => {
    onEvent({ type: "error", error: "stream_error" });
  };
  return { ws, close: () => { try { ws.close(); } catch { } } };
}

export async function chatAskOnce(opts: {
  q: string;
  files?: File[];
  chatId?: string;
  onEvent?: (ev: ChatEvent) => void;
}) {
  const { q, files = [], chatId, onEvent } = opts;
  const start = files.length ? await chatMultipart(q, files, chatId) : await chatJSON({ q, chatId });
  let answer = "";
  let flashcards: FlashCard[] | undefined;

  await new Promise<void>((resolve, reject) => {
    const { close } = connectChatStream(start.chatId, (ev) => {
      onEvent?.(ev);
      if (ev.type === "answer") {
        const p = ev.answer;
        if (typeof p === "string") {
          answer = p;
        } else if (p && typeof p === "object") {
          answer = p.answer ?? "";
          if (Array.isArray(p.flashcards)) flashcards = p.flashcards;
        }
      }
      if (ev.type === "done") { close(); resolve(); }
      if (ev.type === "error") { close(); reject(new Error(ev.error || "chat failed")); }
    });
  });

  return { chatId: start.chatId, answer, flashcards };
}

export async function companionAsk(input: {
  question: string;
  filePath?: string;
  documentText?: string;
  documentTitle?: string;
  topic?: string;
  history?: CompanionHistoryEntry[];
}) {
  const question = (input.question || "").trim();
  if (!question) throw new Error("Question is required");

  const payload: Record<string, unknown> = { question };
  if (input.filePath) payload.filePath = input.filePath;
  if (input.documentText) payload.documentText = input.documentText;
  if (input.documentTitle) payload.documentTitle = input.documentTitle;
  if (input.topic) payload.topic = input.topic;
  if (input.history && input.history.length) {
    payload.history = input.history.map((h) => ({ role: h.role, content: h.content }));
  }

  return req<CompanionAskResponse>(`${env.backend}/api/companion/ask`, {
    method: "POST",
    headers: jsonHeaders({}),
    body: JSON.stringify(payload),
    timeout: Math.max(env.timeout, 120000),
  });
}

export function getChats() {
  return req<ChatsList>(`${env.backend}/chats`, { method: "GET" });
}

export function getChatDetail(id: string) {
  return req<ChatDetail>(`${env.backend}/chats/${encodeURIComponent(id)}`, { method: "GET" });
}

export async function createFlashcard(input: {
  question: string;
  answer: string;
  tag: string;
  group?: string;
}) {
  return req<{ ok: true; flashcard: SavedFlashcard }>(`${env.backend}/flashcards`, {
    method: "POST",
    headers: jsonHeaders({}),
    body: JSON.stringify(input),
  });
}

export async function listFlashcards() {
  return req<{ ok: true; flashcards: SavedFlashcard[] }>(`${env.backend}/flashcards`, {
    method: "GET",
  });
}

export async function deleteFlashcard(id: string) {
  return req<{ ok: true }>(`${env.backend}/flashcards/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function deleteFlashcardGroup(group: string) {
  return req<{ ok: true }>(`${env.backend}/flashcards/group/${encodeURIComponent(group)}`, {
    method: "DELETE",
  });
}

export async function reviewFlashcard(id: string, rating: "again" | "good") {
  return req<{ ok: true; flashcard: SavedFlashcard }>(`${env.backend}/flashcards/review`, {
    method: "POST",
    headers: jsonHeaders({}),
    body: JSON.stringify({ id, rating }),
  });
}

export function isFlashcardDue(card: SavedFlashcard, now = Date.now()): boolean {
  return card.due == null || card.due <= now;
}

export function countDueFlashcards(cards: SavedFlashcard[], now = Date.now()): number {
  return cards.filter((c) => c.tag !== "note" && isFlashcardDue(c, now)).length;
}

export function countDueTomorrow(cards: SavedFlashcard[], now = Date.now()): number {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + 1);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const lo = start.getTime();
  const hi = end.getTime();
  return cards.filter((c) => c.due != null && c.due >= lo && c.due < hi).length;
}

export async function listLibraryFiles() {
  return req<{ ok: true; files: LibraryFile[] }>(`${env.backend}/api/files`, {
    method: "GET",
  });
}

export async function deleteLibraryFile(id: string) {
  return req<{ ok: true }>(`${env.backend}/api/files/object?key=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function clearLibraryFiles() {
  return req<{ ok: true }>(`${env.backend}/api/files`, {
    method: "DELETE",
  });
}

export function libraryFileDownloadUrl(id: string): string {
  return `${env.backend}/api/files/object?key=${encodeURIComponent(id)}`;
}

const EXAMPLE_BAG_SKILLS = [
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

function isExampleBagSkill(skill: { name?: string; prompt?: string }) {
  const name = String(skill.name || "").trim();
  const prompt = String(skill.prompt || "").trim();
  return EXAMPLE_BAG_SKILLS.some((example) => example.name === name && example.prompt === prompt);
}

export async function listSkills() {
  const res = await req<{ ok: true; skills: BagSkill[] }>(`${env.backend}/skills`, {
    method: "GET",
  });
  return { ...res, skills: (res.skills || []).filter((skill) => !isExampleBagSkill(skill)) };
}

export async function createSkill(input: { name: string; prompt: string }) {
  return req<{ ok: true; skill: BagSkill }>(`${env.backend}/skills`, {
    method: "POST",
    headers: jsonHeaders({}),
    body: JSON.stringify(input),
  });
}

export async function updateSkill(id: string, input: { name: string; prompt: string }) {
  return req<{ ok: true; skill: BagSkill }>(`${env.backend}/skills/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: jsonHeaders({}),
    body: JSON.stringify(input),
  });
}

export async function deleteSkill(id: string) {
  return req<{ ok: true }>(`${env.backend}/skills/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function libraryFileToUpload(item: LibraryFile): Promise<File> {
  const res = await fetch(libraryFileDownloadUrl(item.id), { credentials: "include" });
  if (!res.ok) throw new Error("Could not load that file from your bag.");
  const blob = await res.blob();
  return new File([blob], item.filename, {
    type: item.mimeType || blob.type || "application/octet-stream",
  });
}

export async function runSkillWithFile(skill: BagSkill, file: LibraryFile): Promise<string> {
  const started = await chatJSON({ q: skill.prompt, fileIds: [file.id] });
  if (!started?.chatId) throw new Error("Chat did not start.");
  return started.chatId;
}

export type StudyGroupRole = "owner" | "member";
export type StudyGroupItemKind = "skill" | "file" | "note" | "deck";

export type StudyGroupSummary = {
  id: string;
  name: string;
  joinCode: string;
  ownerId: string;
  createdAt: string;
  role: StudyGroupRole;
};

export type StudyGroupMember = {
  id: string;
  role: StudyGroupRole;
  email: string;
  joined_at: string;
};

export type StudyGroupItem = {
  id: string;
  kind: StudyGroupItemKind;
  title: string;
  payload: Record<string, unknown>;
  r2Key: string | null;
  sharedBy: string;
  sharedByEmail: string;
  created: number;
};

export type StudyGroupDetail = {
  ok: true;
  group: {
    id: string;
    name: string;
    joinCode: string;
    ownerId: string;
    createdAt: string;
  };
  members: StudyGroupMember[];
  items: StudyGroupItem[];
};

export async function listStudyGroups() {
  return req<{ ok: true; groups: StudyGroupSummary[] }>(`${env.backend}/api/groups`, {
    method: "GET",
  });
}

export async function createStudyGroup(name: string) {
  return req<{ ok: true; group: { id: string; name: string; joinCode: string; ownerId: string; role: StudyGroupRole } }>(`${env.backend}/api/groups`, {
    method: "POST",
    headers: jsonHeaders({}),
    body: JSON.stringify({ name }),
  });
}

export async function joinStudyGroup(code: string) {
  return req<{ ok: true; groupId: string }>(`${env.backend}/api/groups/join`, {
    method: "POST",
    headers: jsonHeaders({}),
    body: JSON.stringify({ code }),
  });
}

export async function getStudyGroup(id: string) {
  return req<StudyGroupDetail>(`${env.backend}/api/groups/${encodeURIComponent(id)}`, {
    method: "GET",
  });
}

export async function deleteStudyGroup(id: string) {
  return req<{ ok: true }>(`${env.backend}/api/groups/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function leaveStudyGroup(id: string) {
  return req<{ ok: true }>(`${env.backend}/api/groups/${encodeURIComponent(id)}/leave`, {
    method: "POST",
  });
}

export async function removeStudyGroupMember(groupId: string, userId: string) {
  return req<{ ok: true }>(
    `${env.backend}/api/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`,
    { method: "DELETE" }
  );
}

export async function shareToStudyGroup(
  groupId: string,
  kind: StudyGroupItemKind,
  sourceId: string,
  extra?: { cards?: Array<{ question: string; answer: string; tag?: string }> }
) {
  return req<{ ok: true; itemId: string }>(`${env.backend}/api/groups/${encodeURIComponent(groupId)}/items`, {
    method: "POST",
    headers: jsonHeaders({}),
    body: JSON.stringify({ kind, sourceId, cards: extra?.cards }),
  });
}

export function isSharedDeck(item: { kind?: string; payload?: Record<string, unknown> }): boolean {
  return item.kind === "deck" || item.payload?.type === "deck" || Array.isArray(item.payload?.cards);
}

export function deckCardsFromPayload(payload: Record<string, unknown> | undefined, title = ""): SavedFlashcard[] {
  const cards = Array.isArray(payload?.cards) ? payload.cards : [];
  const group = String(payload?.group || title || "Shared").trim() || "Shared";
  return cards
    .map((raw, i) => {
      const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      return {
        id: `shared-${i}`,
        question: String(row.question || "").trim(),
        answer: String(row.answer || "").trim(),
        tag: String(row.tag || "core"),
        group,
        created: Date.now(),
      } satisfies SavedFlashcard;
    })
    .filter((card) => card.question && card.answer);
}

export async function getSharedDeck(groupId: string, itemId: string) {
  const detail = await getStudyGroup(groupId);
  const item = detail.items.find((entry) => entry.id === itemId && isSharedDeck(entry));
  if (!item) throw new Error("Shared folder not found.");
  const cards = deckCardsFromPayload(item.payload, item.title);
  if (!cards.length) throw new Error("That shared folder has no flashcards.");
  return { name: String(item.payload.group || item.title), cards };
}

export async function removeStudyGroupItem(groupId: string, itemId: string) {
  return req<{ ok: true }>(
    `${env.backend}/api/groups/${encodeURIComponent(groupId)}/items/${encodeURIComponent(itemId)}`,
    { method: "DELETE" }
  );
}

export async function saveStudyGroupItemToBag(groupId: string, itemId: string) {
  return req<{ ok: true; kind: StudyGroupItemKind; id: string }>(
    `${env.backend}/api/groups/${encodeURIComponent(groupId)}/items/${encodeURIComponent(itemId)}/save`,
    { method: "POST" }
  );
}

export type StudyGroupMessage = {
  id: string;
  userId: string;
  email: string;
  text: string;
  created: number;
};

export async function listStudyGroupMessages(groupId: string) {
  return req<{ ok: true; messages: StudyGroupMessage[] }>(
    `${env.backend}/api/groups/${encodeURIComponent(groupId)}/messages`,
    { method: "GET" }
  );
}

export async function sendStudyGroupMessage(groupId: string, text: string) {
  return req<{ ok: true; message: StudyGroupMessage }>(
    `${env.backend}/api/groups/${encodeURIComponent(groupId)}/messages`,
    {
      method: "POST",
      headers: jsonHeaders({}),
      body: JSON.stringify({ text }),
    }
  );
}

export function studyGroupFileDownloadUrl(groupId: string, key: string): string {
  return `${env.backend}/api/groups/${encodeURIComponent(groupId)}/files/object?key=${encodeURIComponent(key)}`;
}

export async function getExams() {
  return req<{ ok: true; exams: { id: string; name: string; sections: any[] }[] }>(
    `${env.backend}/exams`,
    { method: "GET" }
  )
}

export async function startExam(examId: string) {
  return req<{ ok: true; runId: string; stream: string }>(
    `${env.backend}/exam`,
    {
      method: "POST",
      headers: jsonHeaders({}),
      body: JSON.stringify({ examId }),
    }
  )
}

export function connectExamStream(runId: string, onEvent: (ev: ExamEvent) => void) {
  const url = wsURL(`/ws/exams?runId=${encodeURIComponent(runId)}`)
  const ws = new WebSocket(url)
  ws.onmessage = (m) => {
    try {
      onEvent(JSON.parse(m.data as string) as ExamEvent)
    } catch { }
  }
  ws.onerror = () => onEvent({ type: "error", error: "stream_error" })
  return { ws, close: () => { try { ws.close() } catch { } } }
}

export async function smartnotesStart(input: { topic?: string; notes?: string; filePath?: string }) {
  return req<SmartNotesStart>(`${env.backend}/smartnotes`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(input),
  });
}

export function connectSmartnotesStream(noteId: string, onEvent: (ev: SmartNotesEvent) => void) {
  const url = wsURL(`/ws/smartnotes?noteId=${encodeURIComponent(noteId)}`);
  const ws = new WebSocket(url);
  ws.onmessage = (m) => {
    try {
      onEvent(JSON.parse(m.data as string) as SmartNotesEvent);
    } catch { }
  };
  ws.onerror = () => onEvent({ type: "error", error: "stream_error" });
  return { ws, close: () => { try { ws.close(); } catch { } } };
}

export function flashcards(topic: string) {
  return req<{ cards: unknown[] }>(`${env.backend}/flashcards`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ topic }),
  });
}

export async function quizStart(topic: string) {
  return req<QuizStartResponse>(`${env.backend}/quiz`, {
    method: "POST",
    headers: jsonHeaders({}),
    body: JSON.stringify({ topic })
  }
  )
}

export async function podcastStart(payload: { topic: string }) {
  return req<{ ok: true; pid: string; stream: string }>(`${env.backend}/podcast`, {
    method: "POST",
    headers: jsonHeaders({}),
    body: JSON.stringify(payload),
  });
}

export async function listPodcasts() {
  return req<{ ok: true; podcasts: PodcastItem[] }>(`${env.backend}/podcast`, {
    method: "GET",
  });
}

export function podcastDownloadUrl(pid: string, filename: string) {
  return `${env.backend}/podcast/download/${encodeURIComponent(pid)}/${encodeURIComponent(filename)}`;
}

export function connectPodcastStream(pid: string, onEvent: (ev: any) => void) {
  const wsUrl = `${env.backend.replace(/^http/, "ws")}/ws/podcast?pid=${pid}`
  const ws = new WebSocket(wsUrl)

  ws.onopen = () => {
  }

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data)
      onEvent(msg)
    } catch (err) {
      onEvent({ type: "error", error: "invalid_message" })
    }
  }

  ws.onclose = (e) => {
  }

  ws.onerror = () => onEvent({ type: "error", error: "stream_error" } as any)
  return { ws, close: () => { try { ws.close() } catch { } } }
}

export function connectQuizStream(quizId: string, onEvent: (ev: QuizEvent) => void) {
  const url = wsURL(`/ws/quiz?quizId=${encodeURIComponent(quizId)}`);
  const ws = new WebSocket(url); ws.onmessage = m => {
    try {
      onEvent(JSON.parse(m.data as string) as QuizEvent)
    } catch { }
  }; ws.onerror = () => onEvent({ type: "error", error: "stream_error" } as any); return { ws, close: () => { try { ws.close() } catch { } } }
}

async function pollTranscribeJob(jobId: string) {
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    const row = await req<TranscriptionResponse>(`${env.backend}/transcriber/${encodeURIComponent(jobId)}`, {
      method: "GET",
      timeout: 30000,
    });
    if (row.status === "pending") {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    if (row.status === "error" || row.ok === false) {
      throw new ApiError(row.error || "Transcription failed", 500);
    }
    return row;
  }
  throw new ApiError("Transcription took too long. Try a shorter video.", 504);
}

export async function transcribeAudio(file: File) {
  const formData = new FormData();
  formData.append("file", file);

  const started = await req<TranscriptionResponse>(`${env.backend}/transcriber`, {
    method: "POST",
    body: formData,
    timeout: Math.max(env.timeout, 180000),
  });
  if (started.transcription) return started;
  if (!started.jobId) throw new ApiError(started.error || "Transcription failed to start", 500);
  return pollTranscribeJob(started.jobId);
}

export async function transcribeYouTube(youtubeUrl: string) {
  const started = await req<TranscriptionResponse>(`${env.backend}/transcriber`, {
    method: "POST",
    headers: jsonHeaders({}),
    body: JSON.stringify({ youtubeUrl }),
    timeout: Math.max(env.timeout, 60000),
  });
  if (started.transcription) return started;
  if (!started.jobId) throw new ApiError(started.error || "Transcription failed to start", 500);
  return pollTranscribeJob(started.jobId);
}

export type PlannerRecurrence = {
  freq: "daily" | "weekly" | "biweekly" | "monthly";
};

export type PlannerTask = {
  id: string;
  course?: string;
  title: string;
  type?: string;
  notes?: string;
  dueAt: number | string;
  estMins: number;
  priority: 1 | 2 | 3 | 4 | 5;
  status: "todo" | "doing" | "done" | "blocked";
  createdAt: number | string;
  updatedAt: number | string;
  tags?: string[];
  recurrence?: PlannerRecurrence;
  files?: { id: string; filename: string; originalName: string; mimeType: string; size: number; uploadedAt: number }[];
  steps?: string[];
};

export type PlannerSlot = { id: string; taskId: string; start: number; end: number; kind: "focus" | "review" | "buffer"; done?: boolean }
export type WeeklyPlan = { days: { date: string; slots: PlannerSlot[] }[] }

export type PlannerEvent =
  | { type: "ready"; sid: string }
  | { type: "phase"; value: string }
  | { type: "plan.update"; taskId: string; slots: PlannerSlot[] }
  | { type: "materials.chunk"; id: string; idx: number; total: number; more: boolean; encoding: string; data: string }
  | { type: "materials.done"; id: string; total: number }
  | { type: "reminder"; text: string; at: number; taskId?: string; scheduledFor?: string }
  | { type: "daily.digest"; date: string; due: { id: string; title: string; dueAt: number }[]; sessions: number; message: string }
  | { type: "evening.review"; date: string; stats: any; tomorrowTasks: { id: string; title: string }[]; message: string }
  | { type: "break.reminder"; text: string; at: string }
  | { type: "task.created"; task: PlannerTask }
  | { type: "task.updated"; task: PlannerTask }
  | { type: "task.deleted"; taskId: string }
  | { type: "task.files.added"; taskId: string; files: any[] }
  | { type: "task.file.removed"; taskId: string; fileId: string }
  | { type: "session.started"; session: { id: string; taskId: string; slotId?: string; startedAt: string; status: string } }
  | { type: "session.ended"; session: { id: string; endedAt: string; minutesWorked: number; completed: boolean; status: string } }
  | { type: "weekly.update"; plan: WeeklyPlan }
  | { type: "slot.update"; taskId: string; slotId: string; done: boolean; skip: boolean }
  | { type: "done" };

export async function plannerIngest(
  text: string,
  opts?: { dueAt?: string; recurrence?: PlannerRecurrence | null }
) {
  return req<{ ok: boolean; task: PlannerTask }>(`${env.backend}/tasks/ingest`, {
    method: "POST",
    headers: jsonHeaders({}),
    body: JSON.stringify({
      text,
      dueAt: opts?.dueAt,
      recurrence: opts?.recurrence || undefined,
    }),
  });
}

export async function plannerList(params?: { status?: string; dueBefore?: number; course?: string }) {
  const q = new URLSearchParams()
  if (params?.status) q.set("status", params.status)
  if (params?.dueBefore) q.set("dueBefore", String(params.dueBefore))
  if (params?.course) q.set("course", params.course)
  const url = `${env.backend}/tasks${q.toString() ? `?${q}` : ""}`
  return req<{ ok: boolean; tasks: PlannerTask[] }>(url, { method: "GET" })
}

export async function plannerPlan(id: string, cram?: boolean) {
  return req<{ ok: boolean; task: PlannerTask & { plan?: { slots: PlannerSlot[] } } }>(`${env.backend}/tasks/${encodeURIComponent(id)}/plan`, {
    method: "POST",
    headers: jsonHeaders({}),
    body: JSON.stringify({ cram: !!cram })
  })
}

export async function plannerWeekly(regenerate = false) {
  if (!regenerate) {
    return req<{ ok: boolean; plan: WeeklyPlan }>(`${env.backend}/planner/weekly`, {
      method: "GET",
    })
  }
  return req<{ ok: boolean; plan: WeeklyPlan }>(`${env.backend}/planner/weekly`, {
    method: "POST",
    headers: jsonHeaders({}),
    body: JSON.stringify({}),
  })
}

export async function plannerMaterials(id: string, kind: "summary" | "studyGuide" | "flashcards" | "quiz") {
  return req<{ ok: boolean; data: any }>(`${env.backend}/tasks/${encodeURIComponent(id)}/materials`, {
    method: "POST",
    headers: jsonHeaders({}),
    body: JSON.stringify({ kind })
  })
}

export function connectPlannerStream(sid: string, onEvent: (ev: PlannerEvent) => void) {
  const url = wsURL(`/ws/planner?sid=${encodeURIComponent(sid)}`)
  const ws = new WebSocket(url)
  ws.onmessage = (m) => {
    try {
      const ev = JSON.parse(m.data as string)
      onEvent(ev)
    } catch { }
  }
  ws.onerror = () => { /* ignore for now */ }
  return { ws, close: () => { try { ws.close() } catch { } } }
}

export async function plannerUpdate(
  id: string,
  patch: Partial<Omit<PlannerTask, "dueAt" | "recurrence">> & {
    dueAt?: number | string;
    recurrence?: PlannerRecurrence | null;
  }
) {
  return req<{ ok: boolean; task: PlannerTask; spawned?: PlannerTask }>(`${env.backend}/tasks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: jsonHeaders({}),
    body: JSON.stringify(patch),
  });
}

export async function plannerDelete(id: string) {
  return req<{ ok: boolean }>(`${env.backend}/tasks/${encodeURIComponent(id)}`, { method: "DELETE" })
}

export async function plannerCreateWithFiles(data: {
  text?: string;
  title?: string;
  course?: string;
  type?: string;
  dueAt?: string;
  recurrence?: PlannerRecurrence | null;
  files?: File[];
}) {
  const formData = new FormData();
  if (data.text) formData.append("q", data.text);
  if (data.title) formData.append("title", data.title);
  if (data.course) formData.append("course", data.course);
  if (data.type) formData.append("type", data.type);
  if (data.dueAt) formData.append("dueAt", data.dueAt);
  if (data.recurrence) formData.append("recurrence", JSON.stringify(data.recurrence));
  if (data.files) {
    for (const file of data.files) {
      formData.append("file", file, file.name);
    }
  }

  return req<{ ok: boolean; task: PlannerTask & { files?: any[] } }>(`${env.backend}/tasks`, {
    method: "POST",
    body: formData,
    timeout: Math.max(env.timeout, 300000),
  })
}

export async function plannerUploadFiles(taskId: string, files: File[]) {
  const formData = new FormData()
  for (const file of files) {
    formData.append('file', file, file.name)
  }

  return req<{ ok: boolean; files: any[] }>(`${env.backend}/tasks/${encodeURIComponent(taskId)}/files`, {
    method: "POST",
    body: formData,
    timeout: Math.max(env.timeout, 300000),
  })
}

export async function plannerDeleteFile(taskId: string, fileId: string) {
  return req<{ ok: boolean }>(`${env.backend}/tasks/${encodeURIComponent(taskId)}/files/${encodeURIComponent(fileId)}`, {
    method: "DELETE"
  })
}

export type DebateStartResponse = {
  ok: boolean;
  debateId: string;
  session: {
    id: string;
    topic: string;
    position: "for" | "against";
    createdAt: number;
  };
  stream: string;
  error?: string;
}

export type DebateSession = {
  id: string;
  topic: string;
  position: "for" | "against";
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    timestamp: number;
  }>;
  createdAt: number;
}

export async function startDebate(topic: string, position: "for" | "against") {
  return req<DebateStartResponse>(`${env.backend}/debate/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic, position }),
    timeout: 30000,
  })
}

export async function submitDebateArgument(debateId: string, argument: string) {
  return req<{ ok: boolean; message: string; error?: string }>(`${env.backend}/debate/${encodeURIComponent(debateId)}/argue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ argument }),
    timeout: 120000,
  })
}

export async function getDebateSession(debateId: string) {
  return req<{ ok: boolean; session: DebateSession; error?: string }>(`${env.backend}/debate/${encodeURIComponent(debateId)}`, {
    method: "GET",
  })
}

export async function listDebates() {
  return req<{ ok: boolean; debates: Array<any>; error?: string }>(`${env.backend}/debates`, {
    method: "GET",
  })
}

export async function deleteDebate(debateId: string) {
  return req<{ ok: boolean; message: string; error?: string }>(`${env.backend}/debate/${encodeURIComponent(debateId)}`, {
    method: "DELETE",
  })
}

export async function surrenderDebate(debateId: string) {
  return req<{ ok: boolean; message: string; error?: string }>(`${env.backend}/debate/${encodeURIComponent(debateId)}/surrender`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  })
}

export type DebateAnalysis = {
  winner: "user" | "ai" | "draw";
  reason: string;
  userStrengths: string[];
  aiStrengths: string[];
  userWeaknesses: string[];
  aiWeaknesses: string[];
  keyMoments: string[];
  overallAssessment: string;
}

export async function analyzeDebate(debateId: string) {
  return req<{ ok: boolean; analysis: DebateAnalysis; session: DebateSession; error?: string }>(`${env.backend}/debate/${encodeURIComponent(debateId)}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    timeout: 60000,
  })
}

export function err(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
