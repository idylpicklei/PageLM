import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../components/AuthProvider";
import { PickBagFileModal, PickNoteModal, PickSkillModal } from "../components/LearningBag/BagPickers";
import {
  deleteStudyGroup,
  listSkills,
  getStudyGroup,
  leaveStudyGroup,
  listFlashcards,
  listLibraryFiles,
  removeStudyGroupItem,
  removeStudyGroupMember,
  saveStudyGroupItemToBag,
  shareToStudyGroup,
  studyGroupFileDownloadUrl,
  type BagSkill,
  type LibraryFile,
  type SavedFlashcard,
  type StudyGroupDetail,
  type StudyGroupItem,
  type StudyGroupItemKind,
} from "../lib/api";

function formatBytes(size: unknown): string {
  const n = Number(size);
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function StudyGroupDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [detail, setDetail] = useState<StudyGroupDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const [skills, setSkills] = useState<BagSkill[]>([]);
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [notes, setNotes] = useState<SavedFlashcard[]>([]);
  const [shareKind, setShareKind] = useState<StudyGroupItemKind | null>(null);

  const load = async () => {
    if (!id) return;
    try {
      const res = await getStudyGroup(id);
      setDetail(res);
      setError(null);
    } catch (err) {
      setDetail(null);
      setError(err instanceof Error ? err.message : "Could not load this group.");
    }
  };

  useEffect(() => {
    void load();
  }, [id]);

  useEffect(() => {
    void Promise.all([
      listSkills().catch(() => ({ skills: [] as BagSkill[] })),
      listLibraryFiles().catch(() => ({ files: [] as LibraryFile[] })),
      listFlashcards().catch(() => ({ flashcards: [] as SavedFlashcard[] })),
    ]).then(([skillRes, fileRes, noteRes]) => {
      setSkills(skillRes.skills || []);
      setFiles(fileRes.files || []);
      setNotes(noteRes.flashcards || []);
    });
  }, []);

  const role = useMemo(() => {
    if (!detail || !user) return null;
    return detail.members.find((m) => m.id === user.id)?.role || null;
  }, [detail, user]);

  const joinLink = useMemo(() => {
    if (!detail) return "";
    return `${window.location.origin}/groups/join?code=${encodeURIComponent(detail.group.joinCode)}`;
  }, [detail]);

  const copyInvite = async () => {
    if (!detail) return;
    const text = `Join my PageLM study group "${detail.group.name}" with code ${detail.group.joinCode}: ${joinLink}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Could not copy the invite.");
    }
  };

  const shareItem = async (kind: StudyGroupItemKind, sourceId: string) => {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await shareToStudyGroup(id, kind, sourceId);
      setShareKind(null);
      setNotice("Shared to the group.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not share that item.");
    } finally {
      setBusy(false);
    }
  };

  const saveItem = async (item: StudyGroupItem) => {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await saveStudyGroupItemToBag(id, item.id);
      setNotice("Saved to your learning bag.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that item.");
    } finally {
      setBusy(false);
    }
  };

  const removeItem = async (item: StudyGroupItem) => {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await removeStudyGroupItem(id, item.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove that item.");
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (userId: string) => {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await removeStudyGroupMember(id, userId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove that member.");
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    if (!id) return;
    setBusy(true);
    try {
      await leaveStudyGroup(id);
      navigate("/groups");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not leave this group.");
      setBusy(false);
    }
  };

  const destroy = async () => {
    if (!id) return;
    if (!window.confirm("Delete this study group for everyone?")) return;
    setBusy(true);
    try {
      await deleteStudyGroup(id);
      navigate("/groups");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete this group.");
      setBusy(false);
    }
  };

  const itemsByKind = (kind: StudyGroupItemKind) => (detail?.items || []).filter((item) => item.kind === kind);

  const canRemove = (item: StudyGroupItem) => role === "owner" || item.sharedBy === user?.id;

  return (
    <div className="min-h-screen w-full px-4 lg:pl-28 lg:pr-4">
      <div className="max-w-6xl mx-auto pt-6 pb-14 px-2">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <Link
              to="/groups"
              className="p-2 rounded-xl bg-stone-950 border border-zinc-800 hover:bg-stone-900"
              aria-label="Back to groups"
            >
              <svg viewBox="0 0 24 24" className="size-5 text-stone-300" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
            </Link>
            <div>
              <h1 className="text-2xl font-semibold text-white">{detail?.group.name || "Study group"}</h1>
              {detail && (
                <p className="text-sm text-stone-400 mt-1">
                  Invite code <span className="text-orange-300 tracking-widest">{detail.group.joinCode}</span>
                </p>
              )}
            </div>
          </div>
          {detail && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void copyInvite()}
                className="px-4 py-2 rounded-xl bg-orange-600/20 border border-orange-700 text-orange-200 hover:bg-orange-600/30 text-sm"
              >
                {copied ? "Copied" : "Copy invite"}
              </button>
              {role === "owner" ? (
                <button
                  type="button"
                  onClick={() => void destroy()}
                  disabled={busy}
                  className="px-4 py-2 rounded-xl bg-red-900/20 border border-red-800 text-red-300 hover:bg-red-900/30 text-sm disabled:opacity-50"
                >
                  Delete group
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void leave()}
                  disabled={busy}
                  className="px-4 py-2 rounded-xl border border-zinc-800 text-stone-300 hover:bg-stone-900 text-sm disabled:opacity-50"
                >
                  Leave
                </button>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}
        {notice && (
          <div className="mb-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            {notice}
          </div>
        )}

        {!detail && !error && (
          <div className="rounded-2xl border border-dashed border-zinc-800 px-4 py-8 text-center text-stone-400 text-sm">
            Loading group…
          </div>
        )}

        {detail && (
          <>
            <section className="mb-10">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white">Members</h2>
                <span className="text-xs text-stone-500">{detail.members.length}</span>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                {detail.members.map((member) => (
                  <div key={member.id} className="rounded-2xl bg-stone-950 border border-zinc-800 p-4 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-orange-300 mb-1">{member.role}</div>
                      <div className="text-white font-medium truncate">{member.email}</div>
                    </div>
                    {role === "owner" && member.id !== user?.id && (
                      <button
                        type="button"
                        onClick={() => void removeMember(member.id)}
                        disabled={busy}
                        className="text-sm text-red-300 hover:text-red-200 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <ItemSection
              title="Skills"
              count={itemsByKind("skill").length}
              onShare={() => setShareKind("skill")}
              empty="No skills shared yet."
            >
              {itemsByKind("skill").map((item) => (
                <article key={item.id} className="rounded-2xl bg-stone-950 border border-zinc-800 p-4">
                  <div className="text-xs uppercase tracking-wide text-orange-300 mb-1">Skill</div>
                  <div className="text-white font-medium">{item.title}</div>
                  <div className="text-stone-400 text-sm mt-2 line-clamp-3 whitespace-pre-wrap">
                    {String(item.payload.prompt || "")}
                  </div>
                  <ItemActions
                    item={item}
                    canRemove={canRemove(item)}
                    busy={busy}
                    onSave={() => void saveItem(item)}
                    onRemove={() => void removeItem(item)}
                  />
                </article>
              ))}
            </ItemSection>

            <ItemSection
              title="Files"
              count={itemsByKind("file").length}
              onShare={() => setShareKind("file")}
              empty="No files shared yet."
            >
              {itemsByKind("file").map((item) => (
                <article key={item.id} className="rounded-2xl bg-stone-950 border border-zinc-800 p-4">
                  <div className="text-xs uppercase tracking-wide text-orange-300 mb-1">File</div>
                  <div className="text-white font-medium truncate">{item.title}</div>
                  <div className="text-stone-400 text-sm mt-1">
                    {[formatBytes(item.payload.size), String(item.payload.mimeType || "")].filter(Boolean).join(" · ")}
                  </div>
                  <ItemActions
                    item={item}
                    canRemove={canRemove(item)}
                    busy={busy}
                    downloadHref={item.r2Key ? studyGroupFileDownloadUrl(detail.group.id, item.r2Key) : undefined}
                    onSave={() => void saveItem(item)}
                    onRemove={() => void removeItem(item)}
                  />
                </article>
              ))}
            </ItemSection>

            <ItemSection
              title="Notes"
              count={itemsByKind("note").length}
              onShare={() => setShareKind("note")}
              empty="No notes or flashcards shared yet."
            >
              {itemsByKind("note").map((item) => (
                <article key={item.id} className="rounded-2xl bg-stone-950 border border-zinc-800 p-4">
                  <div className="text-xs uppercase tracking-wide text-stone-400 mb-1">
                    {item.payload.tag === "note" ? "note" : "flashcard"}
                  </div>
                  <div className="text-white font-medium">{item.title}</div>
                  <div className="text-stone-300 text-sm mt-2 whitespace-pre-wrap">{String(item.payload.answer || "")}</div>
                  <ItemActions
                    item={item}
                    canRemove={canRemove(item)}
                    busy={busy}
                    onSave={() => void saveItem(item)}
                    onRemove={() => void removeItem(item)}
                  />
                </article>
              ))}
            </ItemSection>
          </>
        )}
      </div>

      <PickSkillModal
        open={shareKind === "skill"}
        title="Share a skill"
        subtitle="Pick a skill from your bag to copy into this group."
        skills={skills}
        busy={busy}
        onClose={() => setShareKind(null)}
        onPick={(skill) => void shareItem("skill", skill.id)}
      />
      <PickBagFileModal
        open={shareKind === "file"}
        title="Share a file"
        subtitle="Pick a file from your bag. The group gets its own copy."
        files={files}
        busy={busy}
        onClose={() => setShareKind(null)}
        onPick={(file) => void shareItem("file", file.id)}
      />
      <PickNoteModal
        open={shareKind === "note"}
        notes={notes}
        busy={busy}
        onClose={() => setShareKind(null)}
        onPick={(note) => void shareItem("note", note.id)}
      />
    </div>
  );
}

function ItemSection({
  title,
  count,
  onShare,
  empty,
  children,
}: {
  title: string;
  count: number;
  onShare: () => void;
  empty: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-stone-500">{count} shared</span>
          <button
            type="button"
            onClick={onShare}
            className="text-sm text-orange-300 hover:text-orange-200"
          >
            Share
          </button>
        </div>
      </div>
      {count ? (
        <div className="grid md:grid-cols-2 gap-4">{children}</div>
      ) : (
        <div className="rounded-2xl border border-dashed border-zinc-800 px-4 py-8 text-center text-stone-400 text-sm">
          {empty}
        </div>
      )}
    </section>
  );
}

function ItemActions({
  item,
  canRemove,
  busy,
  downloadHref,
  onSave,
  onRemove,
}: {
  item: StudyGroupItem;
  canRemove: boolean;
  busy: boolean;
  downloadHref?: string;
  onSave: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      {downloadHref && (
        <a href={downloadHref} className="text-sm text-orange-300 hover:text-orange-200">
          Download
        </a>
      )}
      <button type="button" onClick={onSave} disabled={busy} className="text-sm text-orange-300 hover:text-orange-200 disabled:opacity-50">
        Save to my bag
      </button>
      {canRemove && (
        <button type="button" onClick={onRemove} disabled={busy} className="text-sm text-stone-400 hover:text-white disabled:opacity-50">
          Remove
        </button>
      )}
      <span className="text-xs text-stone-600">Shared by {item.sharedByEmail}</span>
    </div>
  );
}
