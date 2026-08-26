import { getSessionUser, type SessionUser } from "./auth";
import {
  groupFilesPrefix,
  guessMime,
  putUserUpload,
  sanitizeFileName,
  userUploadsPrefix,
  type FileEnv,
} from "./files";
import { loadSkills, saveSkills, type SkillRecord } from "./skills";

type GroupEnv = FileEnv;

export type GroupRole = "owner" | "member";
export type GroupItemKind = "skill" | "file" | "note" | "deck";

type GroupRow = {
  id: string;
  name: string;
  join_code: string;
  owner_id: string;
  created_at: string;
};

type MemberRow = {
  user_id: string;
  role: GroupRole;
};

type FlashcardRecord = {
  id: string;
  question: string;
  answer: string;
  tag: string;
  group?: string;
  created: number;
};

function cardFolder(card: FlashcardRecord): string {
  if (card.tag === "note") return "Notes";
  return String(card.group || "").trim() || "Ungrouped";
}

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function unwrapKeyv(raw: unknown): unknown {
  let cur = raw;
  for (let i = 0; i < 5; i++) {
    if (typeof cur === "string") {
      try {
        cur = JSON.parse(cur);
        continue;
      } catch {
        return cur;
      }
    }
    if (cur && typeof cur === "object" && !Array.isArray(cur) && "value" in cur) {
      cur = (cur as { value: unknown }).value;
      continue;
    }
    return cur;
  }
  return cur;
}

function flashcardsKey(userId: string): string {
  return `keyv:user:${userId}:flashcards`;
}

function flashcardItemKey(userId: string, id: string): string {
  return `keyv:user:${userId}:flashcard:${id}`;
}

type GroupChatMessage = {
  id: string;
  userId: string;
  email: string;
  text: string;
  created: number;
};

function chatKey(groupId: string): string {
  return `study-group-chat:${groupId}`;
}

async function loadMessages(db: D1Database, groupId: string): Promise<GroupChatMessage[]> {
  const row = await db.prepare("SELECT value FROM kv WHERE key = ?").bind(chatKey(groupId)).first<{ value: string }>();
  if (!row?.value) return [];
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveMessages(db: D1Database, groupId: string, messages: GroupChatMessage[]): Promise<void> {
  await kvSet(db, chatKey(groupId), messages.slice(-200));
}

async function kvSet(db: D1Database, key: string, value: unknown): Promise<void> {
  await db
    .prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, JSON.stringify(value))
    .run();
}

async function loadFlashcards(db: D1Database, userId: string): Promise<FlashcardRecord[]> {
  const keys = [flashcardsKey(userId), `user:${userId}:flashcards`];
  for (const key of keys) {
    const row = await db.prepare("SELECT value FROM kv WHERE key = ?").bind(key).first<{ value: string }>();
    const parsed = unwrapKeyv(row?.value);
    if (Array.isArray(parsed)) return parsed as FlashcardRecord[];
  }
  return [];
}

async function saveFlashcards(db: D1Database, userId: string, cards: FlashcardRecord[]): Promise<void> {
  await kvSet(db, flashcardsKey(userId), cards);
}

function makeJoinCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function normalizeCode(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

async function uniqueJoinCode(db: D1Database): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = makeJoinCode();
    const existing = await db.prepare("SELECT id FROM study_groups WHERE join_code = ?").bind(code).first();
    if (!existing) return code;
  }
  return `${makeJoinCode()}${makeJoinCode()}`.slice(0, 8);
}

async function getMembership(db: D1Database, groupId: string, userId: string): Promise<MemberRow | null> {
  return (
    (await db
      .prepare("SELECT user_id, role FROM study_group_members WHERE group_id = ? AND user_id = ?")
      .bind(groupId, userId)
      .first<MemberRow>()) || null
  );
}

async function requireMember(db: D1Database, groupId: string, user: SessionUser): Promise<MemberRow | Response> {
  const member = await getMembership(db, groupId, user.id);
  if (!member) return json({ error: "not found" }, { status: 404 });
  return member;
}

async function getGroup(db: D1Database, groupId: string): Promise<GroupRow | null> {
  return (
    (await db
      .prepare("SELECT id, name, join_code, owner_id, created_at FROM study_groups WHERE id = ?")
      .bind(groupId)
      .first<GroupRow>()) || null
  );
}

async function listUserGroups(db: D1Database, userId: string) {
  return db
    .prepare(
      `SELECT g.id, g.name, g.join_code, g.owner_id, g.created_at, m.role
       FROM study_group_members m
       JOIN study_groups g ON g.id = m.group_id
       WHERE m.user_id = ?
       ORDER BY g.created_at DESC`
    )
    .bind(userId)
    .all<{ id: string; name: string; join_code: string; owner_id: string; created_at: string; role: GroupRole }>();
}

async function loadGroupDetail(db: D1Database, group: GroupRow) {
  const members = await db
    .prepare(
      `SELECT m.user_id AS id, m.role, u.email, m.joined_at
       FROM study_group_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.group_id = ?
       ORDER BY m.joined_at ASC`
    )
    .bind(group.id)
    .all<{ id: string; role: GroupRole; email: string; joined_at: string }>();

  const items = await db
    .prepare(
      `SELECT i.id, i.kind, i.title, i.payload, i.r2_key, i.shared_by, i.created_at, u.email AS shared_by_email
       FROM study_group_items i
       JOIN users u ON u.id = i.shared_by
       WHERE i.group_id = ?
       ORDER BY i.created_at DESC`
    )
    .bind(group.id)
    .all<{
      id: string;
      kind: GroupItemKind;
      title: string;
      payload: string;
      r2_key: string | null;
      shared_by: string;
      created_at: number;
      shared_by_email: string;
    }>();

  return {
    ok: true,
    group: {
      id: group.id,
      name: group.name,
      joinCode: group.join_code,
      ownerId: group.owner_id,
      createdAt: group.created_at,
    },
    members: members.results || [],
    items: (items.results || []).map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      payload: safeParse(item.payload),
      r2Key: item.r2_key,
      sharedBy: item.shared_by,
      sharedByEmail: item.shared_by_email,
      created: item.created_at,
    })),
  };
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function deletePrefix(env: GroupEnv, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await env.STORAGE.list({ prefix, cursor, limit: 100 });
    if (page.objects.length) {
      await Promise.all(page.objects.map((obj) => env.STORAGE.delete(obj.key)));
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

function parsePath(pathname: string): string[] {
  return pathname
    .replace(/^\/api\/groups\/?/, "")
    .split("/")
    .map((part) => decodeURIComponent(part))
    .filter(Boolean);
}

async function shareSkill(env: GroupEnv, user: SessionUser, groupId: string, sourceId: string): Promise<Response> {
  const skills = await loadSkills(env.DB, user.id);
  const skill = skills.find((s) => s.id === sourceId);
  if (!skill) return json({ error: "skill not found" }, { status: 404 });
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO study_group_items (id, group_id, kind, title, payload, r2_key, shared_by, created_at)
     VALUES (?, ?, 'skill', ?, ?, NULL, ?, ?)`
  )
    .bind(id, groupId, skill.name, JSON.stringify({ name: skill.name, prompt: skill.prompt }), user.id, Date.now())
    .run();
  return json({ ok: true, itemId: id });
}

function normalizeFolder(name: string): string {
  try {
    return decodeURIComponent(name).trim();
  } catch {
    return name.trim();
  }
}

function cardsFromUnknown(raw: unknown): Array<{ question: string; answer: string; tag: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      return {
        question: String(row.question || row.q || "").trim(),
        answer: String(row.answer || row.a || "").trim(),
        tag: String(row.tag || "core"),
      };
    })
    .filter((card) => card.question && card.answer)
    .slice(0, 300);
}

async function shareDeck(env: GroupEnv, user: SessionUser, groupId: string, sourceId: string, extraCards?: unknown): Promise<Response> {
  const folder = normalizeFolder(sourceId);
  if (!folder || folder === "Notes") return json({ error: "folder not found" }, { status: 404 });
  let cards = (await loadFlashcards(env.DB, user.id))
    .filter((card) => card.tag !== "note" && cardFolder(card) === folder)
    .map((card) => ({
      question: String(card.question || "").trim(),
      answer: String(card.answer || "").trim(),
      tag: String(card.tag || "core"),
    }))
    .filter((card) => card.question && card.answer)
    .slice(0, 300);
  if (!cards.length) cards = cardsFromUnknown(extraCards);
  if (!cards.length) return json({ error: "folder not found" }, { status: 404 });
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO study_group_items (id, group_id, kind, title, payload, r2_key, shared_by, created_at)
     VALUES (?, ?, 'note', ?, ?, NULL, ?, ?)`
  )
    .bind(id, groupId, folder, JSON.stringify({ type: "deck", group: folder, cards }), user.id, Date.now())
    .run();
  return json({ ok: true, itemId: id });
}

async function shareNote(env: GroupEnv, user: SessionUser, groupId: string, sourceId: string): Promise<Response> {
  const cards = await loadFlashcards(env.DB, user.id);
  const card = cards.find((c) => c.id === sourceId);
  if (!card) return json({ error: "note not found" }, { status: 404 });
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO study_group_items (id, group_id, kind, title, payload, r2_key, shared_by, created_at)
     VALUES (?, ?, 'note', ?, ?, NULL, ?, ?)`
  )
    .bind(
      id,
      groupId,
      card.question,
      JSON.stringify({ question: card.question, answer: card.answer, tag: card.tag || "flashcard" }),
      user.id,
      Date.now()
    )
    .run();
  return json({ ok: true, itemId: id });
}

async function shareFile(env: GroupEnv, user: SessionUser, groupId: string, sourceId: string): Promise<Response> {
  const clean = decodeURIComponent(sourceId);
  if (clean.includes("..") || !clean.startsWith(userUploadsPrefix(user.id))) {
    return json({ error: "file not found" }, { status: 404 });
  }
  const obj = await env.STORAGE.get(clean);
  if (!obj) return json({ error: "file not found" }, { status: 404 });
  const filename = sanitizeFileName(obj.customMetadata?.filename || clean.split("/").pop() || "file");
  const destKey = `${groupFilesPrefix(groupId)}${Date.now()}-${filename}`;
  await env.STORAGE.put(destKey, obj.body, {
    httpMetadata: obj.httpMetadata,
    customMetadata: {
      source: obj.customMetadata?.source || "upload",
      filename,
      sharedFrom: clean,
    },
  });
  const id = crypto.randomUUID();
  const mimeType = obj.httpMetadata?.contentType || guessMime(filename);
  await env.DB.prepare(
    `INSERT INTO study_group_items (id, group_id, kind, title, payload, r2_key, shared_by, created_at)
     VALUES (?, ?, 'file', ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      groupId,
      filename,
      JSON.stringify({
        filename,
        mimeType,
        size: obj.size,
        source: obj.customMetadata?.source === "canvas" ? "canvas" : "upload",
      }),
      destKey,
      user.id,
      Date.now()
    )
    .run();
  return json({ ok: true, itemId: id });
}

async function saveItemToBag(env: GroupEnv, user: SessionUser, groupId: string, itemId: string): Promise<Response> {
  const item = await env.DB.prepare(
    "SELECT id, kind, title, payload, r2_key FROM study_group_items WHERE id = ? AND group_id = ?"
  )
    .bind(itemId, groupId)
    .first<{ id: string; kind: GroupItemKind; title: string; payload: string; r2_key: string | null }>();
  if (!item) return json({ error: "not found" }, { status: 404 });
  const payload = safeParse(item.payload) as Record<string, unknown>;

  if (item.kind === "skill") {
    const skill: SkillRecord = {
      id: crypto.randomUUID(),
      name: String(payload.name || item.title || "Skill"),
      prompt: String(payload.prompt || ""),
      created: Date.now(),
    };
    if (!skill.prompt) return json({ error: "invalid skill" }, { status: 400 });
    const skills = await loadSkills(env.DB, user.id);
    skills.unshift(skill);
    await saveSkills(env.DB, user.id, skills);
    return json({ ok: true, kind: "skill", id: skill.id });
  }

  if (item.kind === "note" && !Array.isArray(payload.cards) && payload.type !== "deck") {
    const card: FlashcardRecord = {
      id: crypto.randomUUID(),
      question: String(payload.question || item.title || "Note"),
      answer: String(payload.answer || ""),
      tag: String(payload.tag || "note"),
      created: Date.now(),
    };
    const cards = await loadFlashcards(env.DB, user.id);
    cards.unshift(card);
    await saveFlashcards(env.DB, user.id, cards);
    await kvSet(env.DB, flashcardItemKey(user.id, card.id), card);
    return json({ ok: true, kind: "note", id: card.id });
  }

  if (item.kind === "deck" || payload.type === "deck" || Array.isArray(payload.cards)) {
    const folder = String(payload.group || item.title || "Shared").trim() || "Shared";
    const incoming = Array.isArray(payload.cards) ? payload.cards : [];
    const cards = await loadFlashcards(env.DB, user.id);
    const seen = new Set(
      cards
        .filter((card) => cardFolder(card) === folder)
        .map((card) => String(card.question || "").trim().toLowerCase())
    );
    const added: FlashcardRecord[] = [];
    for (const raw of incoming) {
      const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const question = String(row.question || "").trim();
      const answer = String(row.answer || "").trim();
      if (!question || !answer) continue;
      const key = question.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const card: FlashcardRecord = {
        id: crypto.randomUUID(),
        question,
        answer,
        tag: String(row.tag || "core"),
        group: folder,
        created: Date.now(),
      };
      cards.unshift(card);
      added.push(card);
      await kvSet(env.DB, flashcardItemKey(user.id, card.id), card);
    }
    if (added.length) await saveFlashcards(env.DB, user.id, cards);
    return json({ ok: true, kind: "deck", id: added[0]?.id || "", count: added.length, group: folder });
  }

  if (item.kind === "file") {
    if (!item.r2_key || !item.r2_key.startsWith(groupFilesPrefix(groupId))) {
      return json({ error: "file not found" }, { status: 404 });
    }
    const obj = await env.STORAGE.get(item.r2_key);
    if (!obj) return json({ error: "file not found" }, { status: 404 });
    const bytes = await obj.arrayBuffer();
    const file = await putUserUpload(env, user.id, {
      filename: String(payload.filename || item.title || "file"),
      mimeType: String(payload.mimeType || obj.httpMetadata?.contentType || "application/octet-stream"),
      bytes,
    }, payload.source === "canvas" ? "canvas" : "upload");
    return json({ ok: true, kind: "file", id: file.id });
  }

  return json({ error: "not found" }, { status: 404 });
}

export async function handleGroupRoutes(
  request: Request,
  env: GroupEnv,
  pathname: string
): Promise<Response | null> {
  if (pathname !== "/api/groups" && !pathname.startsWith("/api/groups/")) return null;

  const user = await getSessionUser(request, env.DB);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });

  const parts = parsePath(pathname);
  const url = new URL(request.url);

  if (parts.length === 0 && request.method === "GET") {
    const { results } = await listUserGroups(env.DB, user.id);
    return json({
      ok: true,
      groups: (results || []).map((g) => ({
        id: g.id,
        name: g.name,
        joinCode: g.join_code,
        ownerId: g.owner_id,
        createdAt: g.created_at,
        role: g.role,
      })),
    });
  }

  if (parts.length === 0 && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { name?: string };
    const name = String(body.name || "").trim().slice(0, 80);
    if (!name) return json({ error: "name required" }, { status: 400 });
    const id = crypto.randomUUID();
    const joinCode = await uniqueJoinCode(env.DB);
    await env.DB.prepare("INSERT INTO study_groups (id, name, join_code, owner_id) VALUES (?, ?, ?, ?)")
      .bind(id, name, joinCode, user.id)
      .run();
    await env.DB.prepare("INSERT INTO study_group_members (group_id, user_id, role) VALUES (?, ?, 'owner')")
      .bind(id, user.id)
      .run();
    return json({ ok: true, group: { id, name, joinCode, ownerId: user.id, role: "owner" } });
  }

  if (parts[0] === "join" && parts.length === 1 && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { code?: string };
    const code = normalizeCode(String(body.code || ""));
    if (!code) return json({ error: "code required" }, { status: 400 });
    const group = await env.DB.prepare(
      "SELECT id, name, join_code, owner_id, created_at FROM study_groups WHERE join_code = ?"
    )
      .bind(code)
      .first<GroupRow>();
    if (!group) return json({ error: "No group uses that code." }, { status: 404 });
    const existing = await getMembership(env.DB, group.id, user.id);
    if (!existing) {
      await env.DB.prepare("INSERT INTO study_group_members (group_id, user_id, role) VALUES (?, ?, 'member')")
        .bind(group.id, user.id)
        .run();
    }
    return json({ ok: true, groupId: group.id });
  }

  const groupId = parts[0];
  if (!groupId) return json({ error: "not found" }, { status: 404 });
  const group = await getGroup(env.DB, groupId);
  if (!group) return json({ error: "not found" }, { status: 404 });

  const member = await requireMember(env.DB, groupId, user);
  if (member instanceof Response) return member;

  if (parts.length === 1 && request.method === "GET") {
    return json(await loadGroupDetail(env.DB, group));
  }

  if (parts.length === 1 && request.method === "DELETE") {
    if (member.role !== "owner") return json({ error: "forbidden" }, { status: 403 });
    await deletePrefix(env, groupFilesPrefix(groupId));
    await env.DB.prepare("DELETE FROM kv WHERE key = ?").bind(chatKey(groupId)).run();
    await env.DB.prepare("DELETE FROM study_group_items WHERE group_id = ?").bind(groupId).run();
    await env.DB.prepare("DELETE FROM study_group_members WHERE group_id = ?").bind(groupId).run();
    await env.DB.prepare("DELETE FROM study_groups WHERE id = ?").bind(groupId).run();
    return json({ ok: true });
  }

  if (parts[1] === "leave" && parts.length === 2 && request.method === "POST") {
    if (member.role === "owner") {
      return json({ error: "Owners can delete the group instead of leaving." }, { status: 400 });
    }
    await env.DB.prepare("DELETE FROM study_group_members WHERE group_id = ? AND user_id = ?")
      .bind(groupId, user.id)
      .run();
    return json({ ok: true });
  }

  if (parts[1] === "members" && parts.length === 3 && request.method === "DELETE") {
    if (member.role !== "owner") return json({ error: "forbidden" }, { status: 403 });
    const targetId = parts[2];
    if (targetId === user.id) return json({ error: "Owners cannot remove themselves." }, { status: 400 });
    await env.DB.prepare("DELETE FROM study_group_members WHERE group_id = ? AND user_id = ?")
      .bind(groupId, targetId)
      .run();
    return json({ ok: true });
  }

  if (parts[1] === "files" && parts[2] === "object" && parts.length === 3 && request.method === "GET") {
    const key = decodeURIComponent(url.searchParams.get("key") || "");
    if (!key || key.includes("..") || !key.startsWith(groupFilesPrefix(groupId))) {
      return json({ error: "not found" }, { status: 404 });
    }
    const obj = await env.STORAGE.get(key);
    if (!obj) return json({ error: "not found" }, { status: 404 });
    const name = obj.customMetadata?.filename || key.split("/").pop() || "file";
    const headers = new Headers();
    headers.set("Content-Type", obj.httpMetadata?.contentType || guessMime(name));
    headers.set("Content-Disposition", `attachment; filename="${name.replace(/"/g, "")}"`);
    return new Response(obj.body, { headers });
  }

  if (parts[1] === "items" && parts.length === 2 && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { kind?: string; sourceId?: string; cards?: unknown };
    const kind = String(body.kind || "").trim() as GroupItemKind;
    const sourceId = String(body.sourceId || "").trim();
    if (!sourceId) return json({ error: "sourceId required" }, { status: 400 });
    if (kind === "skill") return shareSkill(env, user, groupId, sourceId);
    if (kind === "file") return shareFile(env, user, groupId, sourceId);
    if (kind === "note") return shareNote(env, user, groupId, sourceId);
    if (kind === "deck") return shareDeck(env, user, groupId, sourceId, body.cards);
    return json({ error: "kind must be skill, file, note, or deck" }, { status: 400 });
  }

  if (parts[1] === "items" && parts.length === 3 && request.method === "DELETE") {
    const item = await env.DB.prepare("SELECT id, shared_by, r2_key FROM study_group_items WHERE id = ? AND group_id = ?")
      .bind(parts[2], groupId)
      .first<{ id: string; shared_by: string; r2_key: string | null }>();
    if (!item) return json({ error: "not found" }, { status: 404 });
    if (item.shared_by !== user.id && member.role !== "owner") {
      return json({ error: "forbidden" }, { status: 403 });
    }
    if (item.r2_key) await env.STORAGE.delete(item.r2_key);
    await env.DB.prepare("DELETE FROM study_group_items WHERE id = ?").bind(item.id).run();
    return json({ ok: true });
  }

  if (parts[1] === "items" && parts[3] === "save" && parts.length === 4 && request.method === "POST") {
    return saveItemToBag(env, user, groupId, parts[2]);
  }

  if (parts[1] === "messages" && parts.length === 2 && request.method === "GET") {
    return json({ ok: true, messages: await loadMessages(env.DB, groupId) });
  }

  if (parts[1] === "messages" && parts.length === 2 && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { text?: string };
    const text = String(body.text || "").trim().slice(0, 2000);
    if (!text) return json({ error: "text required" }, { status: 400 });
    const messages = await loadMessages(env.DB, groupId);
    const message: GroupChatMessage = {
      id: crypto.randomUUID(),
      userId: user.id,
      email: user.email,
      text,
      created: Date.now(),
    };
    messages.push(message);
    await saveMessages(env.DB, groupId, messages);
    return json({ ok: true, message });
  }

  return json({ error: "not found" }, { status: 404 });
}
