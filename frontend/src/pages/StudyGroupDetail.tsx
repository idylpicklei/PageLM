import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../components/AuthProvider";
import GroupChat from "../components/Groups/GroupChat";
import GroupManageModal from "../components/Groups/GroupManageModal";
import { PickBagFileModal, PickDeckModal, PickNoteModal, PickSkillModal } from "../components/LearningBag/BagPickers";
import { setLastGroupId } from "../lib/lastGroup";
import {
  deckCardsFromPayload,
  isSharedDeck,
  deleteStudyGroup,
  listSkills,
  getStudyGroup,
  leaveStudyGroup,
  listFlashcards,
  listLibraryFiles,
  listStudyGroups,
  removeStudyGroupItem,
  removeStudyGroupMember,
  saveStudyGroupItemToBag,
  shareToStudyGroup,
  studyGroupFileDownloadUrl,
  type StudyGroupSummary,
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

function ButtonGroup({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex min-w-0 overflow-hidden rounded-xl border border-zinc-800 divide-x divide-zinc-800 md:w-auto md:flex-wrap md:gap-2 md:overflow-visible md:rounded-none md:border-0 md:divide-x-0 ${className}`}>
      {children}
    </div>
  );
}

export default function StudyGroupDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const { user } = useAuth();
  const tab = search.get("tab") === "chat" || search.get("tab") === "members" ? search.get("tab") : "shared";
  const setTab = (next: "shared" | "chat" | "members") => {
    const params = new URLSearchParams(search);
    if (next === "shared") params.delete("tab");
    else params.set("tab", next);
    setSearch(params, { replace: true });
  };
  const [detail, setDetail] = useState<StudyGroupDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const [skills, setSkills] = useState<BagSkill[]>([]);
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [notes, setNotes] = useState<SavedFlashcard[]>([]);
  const [shareKind, setShareKind] = useState<StudyGroupItemKind | null>(null);
  const [openDeck, setOpenDeck] = useState<string | null>(null);
  const [groups, setGroups] = useState<StudyGroupSummary[]>([]);
  const [manageOpen, setManageOpen] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    folders: false,
    notes: true,
    files: true,
    skills: true,
  });

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
    if (id) setLastGroupId(id);
  }, [id]);

  useEffect(() => {
    listStudyGroups()
      .then((res) => setGroups(res.groups || []))
      .catch(() => setGroups([]));
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
      await shareToStudyGroup(
        id,
        kind,
        sourceId,
        kind === "deck"
          ? {
              cards: notes
                .filter((card) => card.tag !== "note" && (card.group || "Ungrouped") === sourceId)
                .map((card) => ({ question: card.question, answer: card.answer, tag: card.tag })),
            }
          : undefined
      );
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

  const goToAnotherGroup = (currentId: string) => {
    const next = groups.find((group) => group.id !== currentId);
    if (next) {
      setLastGroupId(next.id);
      navigate(`/groups/${next.id}`, { replace: true });
    } else {
      setLastGroupId("");
      navigate("/groups", { replace: true });
    }
  };

  const leave = async () => {
    if (!id) return;
    setBusy(true);
    try {
      await leaveStudyGroup(id);
      goToAnotherGroup(id);
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
      goToAnotherGroup(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete this group.");
      setBusy(false);
    }
  };

  const itemsByKind = (kind: StudyGroupItemKind) =>
    (detail?.items || []).filter((item) => item.kind === kind && (kind !== "note" || !isSharedDeck(item)));
  const sharedDecks = (detail?.items || []).filter((item) => isSharedDeck(item));
  const q = query.trim().toLowerCase();
  const filteredDecks = sharedDecks.filter((item) => itemMatches(item, q));
  const filteredNotes = itemsByKind("note").filter((item) => itemMatches(item, q));
  const filteredFiles = itemsByKind("file").filter((item) => itemMatches(item, q));
  const filteredSkills = itemsByKind("skill").filter((item) => itemMatches(item, q));
  const filteredMembers = (detail?.members || []).filter((member) => {
    if (!q) return true;
    return [member.email, member.role].some((value) => String(value).toLowerCase().includes(q));
  });
  const sharedMatches = filteredDecks.length + filteredNotes.length + filteredFiles.length + filteredSkills.length;
  const sectionOpen = (key: string, matchCount: number) => (q ? matchCount > 0 : !collapsed[key]);
  const toggleSection = (key: string) => setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));

  const deckFolders = notes.reduce<Record<string, number>>((acc, card) => {
    if (card.tag === "note") return acc;
    const name = card.group || "Ungrouped";
    acc[name] = (acc[name] || 0) + 1;
    return acc;
  }, {});

  const canRemove = (item: StudyGroupItem) => role === "owner" || item.sharedBy === user?.id;

  return (
    <div className="min-h-screen w-full max-w-[100vw] overflow-x-hidden px-4 lg:pl-28 lg:pr-4">
      <div className="mx-auto w-full min-w-0 max-w-6xl pt-6 pb-14">
        <div className="flex items-start justify-between gap-3 mb-6">
          <div className="relative min-w-0 flex-1">
            <button
              type="button"
              onClick={() => {
                setActionsOpen(false);
                if (groups.length > 1) setSwitchOpen((open) => !open);
              }}
              className="min-w-0 text-left"
            >
              <h1 className="flex items-center gap-2 text-2xl font-semibold text-white">
                <span className="truncate">{detail?.group.name || "Study group"}</span>
                {groups.length > 1 && (
                  <svg viewBox="0 0 24 24" className={`size-4 text-stone-400 transition-transform ${switchOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
                  </svg>
                )}
              </h1>
              {detail && (
                <p className="text-sm text-stone-400 mt-1">
                  Invite code <span className="text-orange-300 tracking-widest">{detail.group.joinCode}</span>
                </p>
              )}
            </button>
            {switchOpen && groups.length > 1 && (
              <div className="absolute z-20 mt-2 w-72 rounded-2xl border border-zinc-800 bg-stone-950 p-2 shadow-2xl">
                {groups.map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => {
                      setSwitchOpen(false);
                      if (group.id !== id) navigate(`/groups/${group.id}`);
                    }}
                    className={`w-full rounded-xl px-3 py-2 text-left text-sm ${
                      group.id === id ? "bg-stone-800 text-white" : "text-stone-300 hover:bg-stone-900 hover:text-white"
                    }`}
                  >
                    <div className="font-medium truncate">{group.name}</div>
                    <div className="text-xs text-stone-500">Code {group.joinCode}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => {
                setSwitchOpen(false);
                setActionsOpen((open) => !open);
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-800 px-3 py-2 text-sm text-stone-200 hover:bg-stone-900"
            >
              Manage
              <svg viewBox="0 0 24 24" className={`size-4 text-stone-400 transition-transform ${actionsOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {actionsOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setActionsOpen(false)} />
                <div className="absolute right-0 z-20 mt-2 w-48 rounded-2xl border border-zinc-800 bg-stone-950 p-1.5 shadow-2xl">
                  <button
                    type="button"
                    onClick={() => {
                      setActionsOpen(false);
                      setManageOpen(true);
                    }}
                    className="w-full rounded-xl px-3 py-2.5 text-left text-sm text-stone-200 hover:bg-stone-900"
                  >
                    Join
                  </button>
                  {detail && (
                    <button
                      type="button"
                      onClick={() => void copyInvite()}
                      className="w-full rounded-xl px-3 py-2.5 text-left text-sm text-orange-200 hover:bg-stone-900"
                    >
                      {copied ? "Copied" : "Invite"}
                    </button>
                  )}
                  {detail && (role === "owner" ? (
                    <button
                      type="button"
                      onClick={() => {
                        setActionsOpen(false);
                        void destroy();
                      }}
                      disabled={busy}
                      className="w-full rounded-xl px-3 py-2.5 text-left text-sm text-red-300 hover:bg-red-900/30 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setActionsOpen(false);
                        void leave();
                      }}
                      disabled={busy}
                      className="w-full rounded-xl px-3 py-2.5 text-left text-sm text-stone-300 hover:bg-stone-900 disabled:opacity-50"
                    >
                      Leave
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
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
            <div className="mb-6 grid grid-cols-3 overflow-hidden rounded-xl border border-zinc-800 divide-x divide-zinc-800 md:flex md:w-auto md:overflow-visible md:rounded-none md:border-0 md:divide-x-0 md:gap-2">
              {([
                ["shared", "Shared"],
                ["chat", "Chat"],
                ["members", `Members (${detail.members.length})`],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={`px-2 py-2.5 text-sm text-center truncate md:rounded-xl md:border md:px-4 ${
                    tab === id
                      ? "bg-stone-800 text-white md:border-zinc-700"
                      : "bg-stone-950 text-stone-400 hover:text-white hover:bg-stone-900 md:border-zinc-800"
                  }`}
                >
                  {id === "members" ? (
                    <>
                      <span className="sm:hidden">Members</span>
                      <span className="hidden sm:inline">{label}</span>
                    </>
                  ) : (
                    label
                  )}
                </button>
              ))}
            </div>

            {(tab === "shared" || tab === "members") && (
              <div className="relative mb-6">
                <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-500" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z" />
                </svg>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={tab === "members" ? "Search members…" : "Search folders, files, notes, and skills…"}
                  className="w-full rounded-xl border border-zinc-800 bg-stone-950 py-2.5 pl-10 pr-10 text-sm text-white placeholder:text-stone-500 outline-none focus:border-orange-800"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs text-stone-400 hover:text-white"
                    aria-label="Clear search"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}

            {tab === "chat" && (
              <GroupChat groupId={detail.group.id} userId={user?.id} active={tab === "chat"} />
            )}

            {tab === "members" && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-white">Members</h2>
                  <span className="text-xs text-stone-500">{filteredMembers.length}{q ? ` of ${detail.members.length}` : ""}</span>
                </div>
                {q && filteredMembers.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-stone-400">
                    No members match “{query}”.
                  </div>
                )}
                <div className="grid md:grid-cols-2 gap-4">
                  {filteredMembers.map((member) => (
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
            )}

            {tab === "shared" && (
              <>
            {q && sharedMatches === 0 && (
              <div className="mb-6 rounded-2xl border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-stone-400">
                No shared items match “{query}”.
              </div>
            )}
            {(!q || filteredDecks.length > 0) && (
            <ItemSection
              title="Flashcard folders"
              count={filteredDecks.length}
              open={sectionOpen("folders", filteredDecks.length)}
              onToggle={() => toggleSection("folders")}
              onShare={() => setShareKind("deck")}
              empty="No flashcard folders shared yet."
            >
              {filteredDecks.map((item) => {
                const cards = deckCardsFromPayload(item.payload, item.title);
                const isOpen = openDeck === item.id;
                return (
                  <article key={item.id} className="w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-zinc-800 bg-stone-950 p-3 md:col-span-2 md:p-4">
                    <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <button
                        type="button"
                        onClick={() => setOpenDeck(isOpen ? null : item.id)}
                        className="min-w-0 w-full overflow-hidden text-left md:flex-1"
                      >
                        <div className="text-xs uppercase tracking-wide text-orange-300 mb-1">Folder</div>
                        <div className="truncate text-white font-medium" title={item.title}>{item.title}</div>
                        <div className="text-stone-400 text-sm mt-1">{cards.length} card{cards.length === 1 ? "" : "s"}</div>
                      </button>
                      <ButtonGroup className="w-full">
                        <Link
                          to={`/study?sharedGroup=${encodeURIComponent(detail.group.id)}&item=${encodeURIComponent(item.id)}`}
                          className="flex-1 px-3 py-1.5 text-center text-xs text-orange-200 bg-orange-900/20 hover:bg-orange-900/30 md:flex-none md:rounded-lg md:border md:border-orange-800/70"
                        >
                          Study
                        </Link>
                        <Link
                          to={`/quiz?sharedGroup=${encodeURIComponent(detail.group.id)}&item=${encodeURIComponent(item.id)}`}
                          className="flex-1 px-3 py-1.5 text-center text-xs text-stone-300 hover:text-white hover:bg-stone-900 md:flex-none md:rounded-lg md:border md:border-zinc-800"
                        >
                          Quiz
                        </Link>
                      </ButtonGroup>
                    </div>
                    {isOpen && (
                      <div className="mt-3 grid md:grid-cols-2 gap-3">
                        {cards.map((card) => (
                          <div key={card.id} className="rounded-xl border border-zinc-800 bg-stone-900/40 p-3">
                            <div className="text-white text-sm font-medium">{card.question}</div>
                            <div className="text-stone-400 text-sm mt-1 whitespace-pre-wrap">{card.answer}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    <ItemActions
                      item={item}
                      canRemove={canRemove(item)}
                      busy={busy}
                      onSave={() => void saveItem(item)}
                      onRemove={() => void removeItem(item)}
                    />
                  </article>
                );
              })}
            </ItemSection>
            )}

            {(!q || filteredNotes.length > 0) && (
            <ItemSection
              title="Notes"
              count={filteredNotes.length}
              open={sectionOpen("notes", filteredNotes.length)}
              onToggle={() => toggleSection("notes")}
              onShare={() => setShareKind("note")}
              empty="No notes or flashcards shared yet."
            >
              {filteredNotes.map((item) => (
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
            )}

            {(!q || filteredFiles.length > 0) && (
            <ItemSection
              title="Files"
              count={filteredFiles.length}
              open={sectionOpen("files", filteredFiles.length)}
              onToggle={() => toggleSection("files")}
              onShare={() => setShareKind("file")}
              empty="No files shared yet."
            >
              {filteredFiles.map((item) => (
                <article key={item.id} className="rounded-2xl bg-stone-950 border border-zinc-800 p-4 min-w-0 overflow-hidden">
                  <div className="text-xs uppercase tracking-wide text-orange-300 mb-1">File</div>
                  <div className="text-white font-medium truncate">{item.title}</div>
                  <div className="text-stone-400 text-sm mt-1 truncate">
                    {formatBytes(item.payload.size)}
                    {item.payload.mimeType ? <span className="hidden sm:inline"> · {String(item.payload.mimeType)}</span> : null}
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
            )}

            {(!q || filteredSkills.length > 0) && (
            <ItemSection
              title="Skills"
              count={filteredSkills.length}
              open={sectionOpen("skills", filteredSkills.length)}
              onToggle={() => toggleSection("skills")}
              onShare={() => setShareKind("skill")}
              empty="No skills shared yet."
            >
              {filteredSkills.map((item) => (
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
            )}
              </>
            )}
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
      <PickDeckModal
        open={shareKind === "deck"}
        folders={Object.entries(deckFolders).sort((a, b) => a[0].localeCompare(b[0]))}
        busy={busy}
        onClose={() => setShareKind(null)}
        onPick={(name) => void shareItem("deck", name)}
      />
      <GroupManageModal
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        onReady={(groupId) => {
          setLastGroupId(groupId);
          navigate(`/groups/${groupId}`);
        }}
      />
    </div>
  );
}

function itemMatches(item: StudyGroupItem, search: string): boolean {
  if (!search) return true;
  const bits = [
    item.title,
    item.kind,
    item.sharedByEmail,
    String(item.payload?.answer || ""),
    String(item.payload?.prompt || ""),
    String(item.payload?.mimeType || ""),
    String(item.payload?.tag || ""),
  ];
  if (isSharedDeck(item)) {
    for (const card of deckCardsFromPayload(item.payload, item.title)) {
      bits.push(card.question, card.answer);
    }
  }
  return bits.some((value) => String(value).toLowerCase().includes(search));
}

function ItemSection({
  title,
  count,
  open,
  onToggle,
  onShare,
  empty,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  onShare: () => void;
  empty: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-4 w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-zinc-800 bg-stone-950">
      <div className="flex items-center min-w-0">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left hover:bg-stone-900/60"
        >
          <svg viewBox="0 0 24 24" className={`size-4 shrink-0 text-stone-500 transition-transform ${open ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <h2 className="truncate text-base font-semibold text-white">{title}</h2>
          <span className="shrink-0 text-xs text-stone-500">{count}</span>
        </button>
        <button
          type="button"
          onClick={onShare}
          className="shrink-0 px-4 py-3 text-sm text-orange-300 hover:text-orange-200"
        >
          Share
        </button>
      </div>
      {open && (
        <div className="border-t border-zinc-800 p-3 md:p-4">
          {count ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0 w-full">{children}</div>
          ) : (
            <div className="rounded-xl border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-stone-400">
              {empty}
            </div>
          )}
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
    <div className="mt-3 space-y-2">
      <ButtonGroup className="w-full">
        {downloadHref && (
          <a href={downloadHref} className="flex-1 px-3 py-1.5 text-center text-xs text-orange-200 hover:bg-stone-900 md:flex-none md:border-0 md:bg-transparent md:px-0 md:text-sm">
            Download
          </a>
        )}
        <button type="button" onClick={onSave} disabled={busy} className="flex-1 px-3 py-1.5 text-xs text-orange-200 hover:bg-stone-900 disabled:opacity-50 md:flex-none md:border-0 md:bg-transparent md:px-0 md:text-sm">
          <span className="md:hidden">Save</span>
          <span className="hidden md:inline">Save to my bag</span>
        </button>
        {canRemove && (
          <button type="button" onClick={onRemove} disabled={busy} className="flex-1 px-3 py-1.5 text-xs text-stone-400 hover:text-white hover:bg-stone-900 disabled:opacity-50 md:flex-none md:border-0 md:bg-transparent md:px-0 md:text-sm">
            Remove
          </button>
        )}
      </ButtonGroup>
      <div className="min-w-0 truncate text-xs text-stone-600">Shared by {item.sharedByEmail}</div>
    </div>
  );
}
