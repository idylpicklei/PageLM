import { useEffect, useState, type ReactNode } from "react";

import {
  clearLibraryFiles,
  countDueFlashcards,
  createSkill,
  createStudyGroup,
  deleteFlashcard,
  deleteFlashcardGroup,
  deleteLibraryFile,
  deleteSkill,
  libraryFileDownloadUrl,
  listFlashcards,
  listLibraryFiles,
  listSkills,
  listStudyGroups,
  runSkillWithFile,
  shareToStudyGroup,
  updateSkill,
  type BagSkill,
  type LibraryFile,
  type SavedFlashcard,
  type StudyGroupSummary,
} from "../lib/api";
import { useNavigate } from "react-router-dom";
import { PickBagFileModal, PickSkillModal, PickStudyGroupModal } from "../components/LearningBag/BagPickers";

function formatBytes(size: number): string {
  if (!size) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function BagSection({
  title,
  count,
  open,
  onToggle,
  extra,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  extra?: ReactNode;
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
        {extra}
      </div>
      {open && <div className="border-t border-zinc-800 p-3 md:p-4">{children}</div>}
    </section>
  );
}

export default function FlashCards() {
  const [items, setItems] = useState<SavedFlashcard[]>([]);
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [skills, setSkills] = useState<BagSkill[]>([]);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [runBusy, setRunBusy] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [studyGroups, setStudyGroups] = useState<StudyGroupSummary[]>([]);
  const [shareFolder, setShareFolder] = useState<string | null>(null);

  const [skillName, setSkillName] = useState("");
  const [skillPrompt, setSkillPrompt] = useState("");
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);

  const [pickFileForSkill, setPickFileForSkill] = useState<BagSkill | null>(null);
  const [pickSkillForFile, setPickSkillForFile] = useState<LibraryFile | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState({ cards: false, files: true, skills: true });
  const toggleSection = (key: keyof typeof collapsed) =>
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));

  const navigate = useNavigate();

  const load = async () => {
    try {
      const [{ flashcards }, fileRes, skillRes, groupRes] = await Promise.all([
        listFlashcards().catch(() => ({ flashcards: [] as SavedFlashcard[] })),
        listLibraryFiles(),
        listSkills().catch(() => ({ skills: [] as BagSkill[] })),
        listStudyGroups().catch(() => ({ groups: [] as StudyGroupSummary[] })),
      ]);
      setItems((flashcards || []).sort((a, b) => b.created - a.created));
      setFiles((fileRes.files || []).sort((a, b) => b.created - a.created));
      setSkills((skillRes.skills || []).sort((a, b) => b.created - a.created));
      setStudyGroups(groupRes.groups || []);
      setFilesError(null);
      setSkillsError(null);
    } catch (err) {
      setFilesError(err instanceof Error ? err.message : "Could not load files");
    }
  };

  useEffect(() => {
    load();
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const resetSkillForm = () => {
    setSkillName("");
    setSkillPrompt("");
    setEditingSkillId(null);
  };

  const saveSkill = async () => {
    const name = skillName.trim();
    const prompt = skillPrompt.trim();
    if (!name || !prompt) return;
    setBusy(true);
    setSkillsError(null);
    try {
      if (editingSkillId) {
        await updateSkill(editingSkillId, { name, prompt });
      } else {
        await createSkill({ name, prompt });
      }
      resetSkillForm();
      await load();
    } catch (err) {
      setSkillsError(err instanceof Error ? err.message : "Could not save skill");
    } finally {
      setBusy(false);
    }
  };

  const startEditSkill = (skill: BagSkill) => {
    setEditingSkillId(skill.id);
    setSkillName(skill.name);
    setSkillPrompt(skill.prompt);
  };

  const removeSkill = async (id: string) => {
    setBusy(true);
    try {
      await deleteSkill(id);
      if (editingSkillId === id) resetSkillForm();
    } catch {}
    await load();
    setBusy(false);
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await deleteFlashcard(id);
    } catch {}
    await load();
    setBusy(false);
  };

  const removeFile = async (id: string) => {
    setBusy(true);
    try {
      await deleteLibraryFile(id);
    } catch {}
    await load();
    setBusy(false);
  };

  const clearAll = async () => {
    if (!items.length && !files.length) return;
    setBusy(true);
    try {
      await Promise.all([
        ...items.map((i) => deleteFlashcard(i.id).catch(() => {})),
        files.length ? clearLibraryFiles().catch(() => {}) : Promise.resolve(),
      ]);
    } catch {}
    await load();
    setBusy(false);
  };

  const handleRunSkill = async (skill: BagSkill, file: LibraryFile) => {
    setRunBusy(true);
    setRunError(null);
    try {
      const chatId = await runSkillWithFile(skill, file);
      setPickFileForSkill(null);
      setPickSkillForFile(null);
      navigate(`/chat?chatId=${encodeURIComponent(chatId)}&q=${encodeURIComponent(skill.prompt)}`);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Could not start chat with that skill.");
    } finally {
      setRunBusy(false);
    }
  };

  const shareDeck = async (groupId: string, folder: string) => {
    setBusy(true);
    setRunError(null);
    try {
      await shareToStudyGroup(groupId, "deck", folder, {
        cards: (grouped[folder] || []).map((card) => ({
          question: card.question,
          answer: card.answer,
          tag: card.tag,
        })),
      });
      setShareFolder(null);
      setNotice(`Shared “${folder}” to the study group.`);
      await load();
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Could not share that folder.");
    } finally {
      setBusy(false);
    }
  };

  const empty = !items.length && !files.length;

  const grouped = items.reduce<Record<string, SavedFlashcard[]>>((acc, item) => {
    const name = item.tag === "note" ? "Notes" : (item.group || "Ungrouped");
    (acc[name] ||= []).push(item);
    return acc;
  }, {});
  const groupNames = Object.keys(grouped).sort((a, b) => {
    if (a === "Ungrouped") return 1;
    if (b === "Ungrouped") return -1;
    if (a === "Notes") return 1;
    if (b === "Notes") return -1;
    return a.localeCompare(b);
  });

  const flashcardItems = items.filter((item) => item.tag !== "note");
  const totalDue = countDueFlashcards(flashcardItems);

  return (
    <div className="min-h-screen w-full max-w-[100vw] overflow-x-hidden px-4 lg:pl-28 lg:pr-4">
      <div className="mx-auto w-full min-w-0 max-w-6xl pt-6 pb-14">
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="p-2 rounded-xl bg-stone-950 border border-zinc-800 hover:bg-stone-900"
              aria-label="Back"
            >
              <svg viewBox="0 0 24 24" className="size-5 text-stone-300" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
            </button>
            <h1 className="text-2xl font-semibold text-white truncate">My Learning Bag</h1>
          </div>
          <button
            onClick={clearAll}
            disabled={busy || empty}
            className="px-4 py-2 rounded-2xl bg-red-900/20 border border-red-800 text-red-300 hover:bg-red-900/30 disabled:opacity-50 shrink-0"
          >
            Clear All
          </button>
        </div>

        {notice && (
          <div className="mb-4 rounded-xl border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-sm text-orange-100">
            {notice}
          </div>
        )}

        {runError && (
          <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {runError}
          </div>
        )}

        <BagSection
          title="Flashcards & notes"
          count={items.length}
          open={!collapsed.cards}
          onToggle={() => toggleSection("cards")}
          extra={
            (totalDue > 0 || groupNames.some((name) => name !== "Notes")) ? (
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 mr-3">
                {totalDue > 0 && (
                  <button
                    type="button"
                    onClick={() => navigate("/study?group=__all__&due=1")}
                    className="px-3 py-1.5 rounded-lg border border-orange-500/50 bg-orange-600/20 text-xs text-orange-100 hover:bg-orange-600/30"
                  >
                    Review due ({totalDue})
                  </button>
                )}
                {groupNames.some((name) => name !== "Notes") && (
                  <button
                    type="button"
                    onClick={() => navigate("/study?group=__all__")}
                    className="px-3 py-1.5 rounded-lg border border-orange-800/70 text-xs text-orange-200 hover:bg-orange-900/30"
                  >
                    Study all
                  </button>
                )}
              </div>
            ) : undefined
          }
        >
          <div className="space-y-3">
            {groupNames.map((name) => {
              const isOpen = openGroup === name;
              const folderFlashcards = grouped[name].filter((c) => c.tag !== "note");
              const dueInFolder = countDueFlashcards(folderFlashcards);
              return (
                <div key={name} className="rounded-2xl border border-zinc-800 bg-stone-950 overflow-hidden">
                  <div className="flex flex-col sm:flex-row sm:items-center min-w-0">
                    <button
                      type="button"
                      onClick={() => setOpenGroup(isOpen ? null : name)}
                      className="flex-1 min-w-0 px-4 py-3 flex items-center gap-3 text-left hover:bg-stone-900/60"
                    >
                      <svg viewBox="0 0 24 24" className="size-5 shrink-0 text-orange-300" fill="currentColor">
                        <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
                      </svg>
                      <div className="min-w-0 flex-1">
                        <div className="text-white font-medium truncate">{name}</div>
                        <div className="text-xs text-stone-500">
                          {grouped[name].length} card{grouped[name].length === 1 ? "" : "s"}
                          {dueInFolder > 0 ? ` · ${dueInFolder} due` : ""}
                        </div>
                      </div>
                      <svg viewBox="0 0 24 24" className={`size-4 shrink-0 text-stone-500 transition-transform ${isOpen ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                    {name !== "Notes" && (
                      <div className="flex flex-wrap gap-2 px-4 pb-3 sm:items-center sm:pb-0 sm:pr-3">
                        <button
                          type="button"
                          onClick={() => navigate(`/study?group=${encodeURIComponent(name)}`)}
                          className="px-3 py-1.5 rounded-lg border border-orange-800/70 text-xs text-orange-200 hover:bg-orange-900/30"
                        >
                          Study
                        </button>
                        <button
                          type="button"
                          onClick={() => navigate(`/quiz?group=${encodeURIComponent(name)}`)}
                          className="px-3 py-1.5 rounded-lg border border-zinc-800 text-xs text-stone-300 hover:text-white hover:bg-stone-900"
                        >
                          Quiz
                        </button>
                        <button
                          type="button"
                          onClick={() => setShareFolder(name)}
                          className="px-3 py-1.5 rounded-lg border border-zinc-800 text-xs text-stone-300 hover:text-white hover:bg-stone-900"
                        >
                          Share
                        </button>
                        {name !== "Ungrouped" && (
                          <button
                            type="button"
                            onClick={() => void (async () => {
                              setBusy(true);
                              try { await deleteFlashcardGroup(name); } catch {}
                              if (openGroup === name) setOpenGroup(null);
                              await load();
                              setBusy(false);
                            })()}
                            disabled={busy}
                            className="px-3 py-1.5 rounded-lg border border-zinc-800 text-xs text-stone-400 hover:text-white hover:bg-stone-900 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {isOpen && (
                    <div className="grid md:grid-cols-2 gap-4 p-4 border-t border-zinc-800">
                      {grouped[name].map((it) => (
                        <div key={it.id} className="rounded-2xl bg-stone-900/40 border border-zinc-800 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-xs uppercase tracking-wide text-stone-400 mb-1">
                                {it.tag === "note" ? "note" : "flashcard"}
                              </div>
                              <div className="text-white font-medium">{it.question}</div>
                            </div>
                            <button
                              onClick={() => remove(it.id)}
                              disabled={busy}
                              className="p-2 rounded-lg bg-stone-950 border border-zinc-800 hover:bg-stone-900 disabled:opacity-50"
                              aria-label="Delete"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="size-4 text-stone-300" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M9.75 9.75a.75.75 0 0 1 .75.75v6a.75.75 0 1 1-1.5 0v-6a.75.75 0 0 1 .75-.75Zm3.75.75a.75.75 0 0 0-1.5 0v6a.75.75 0 1 0 1.5 0v-6Z"/>
                                <path fillRule="evenodd" d="M3 6.75A.75.75 0 0 1 3.75 6h4.443A2.25 2.25 0 0 1 10.315 4.5h2.37A2.25 2.25 0 0 1 14.807 6H19.5a.75.75 0 0 1 0 1.5h-.708l-1.03 12.06A2.25 2.25 0 0 1 15.52 21H8.48a2.25 2.25 0 0 1-2.242-2.44L5.208 7.5H4.5A.75.75 0 0 1 3.75 6.75ZM9.75 6a.75.75 0 0 1 .671-.75h2.37a.75.75 0 0 1 .671.75H9.75Z" clipRule="evenodd"/>
                              </svg>
                            </button>
                          </div>
                          <div className="text-stone-300 text-sm mt-2 whitespace-pre-wrap">{it.answer}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {!items.length && (
            <div className="rounded-2xl border border-dashed border-zinc-800 px-4 py-8 text-center text-stone-400 text-sm">
              Run a flashcard skill on a file to save a study group, or add cards from chat.
            </div>
          )}
        </BagSection>

        <BagSection
          title="Files"
          count={files.length}
          open={!collapsed.files}
          onToggle={() => toggleSection("files")}
        >
          {filesError && (
            <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {filesError}
            </div>
          )}
          {files.length ? (
            <div className="flex flex-col gap-3 md:grid md:grid-cols-2">
              {files.map((file) => (
                <div key={file.id} className="box-border w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-zinc-800 bg-stone-950 p-4">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1 overflow-hidden">
                      <div className="text-xs uppercase tracking-wide text-orange-300 mb-1">
                        {file.source === "canvas" ? "Canvas file" : "Uploaded file"}
                      </div>
                      <div className="truncate text-white font-medium" title={file.filename}>{file.filename}</div>
                      <div className="mt-1 truncate text-sm text-stone-400">
                        {formatBytes(file.size)}
                      </div>
                    </div>
                    <button
                      onClick={() => void removeFile(file.id)}
                      disabled={busy}
                      className="shrink-0 p-2 rounded-lg bg-stone-950 border border-zinc-800 hover:bg-stone-900 disabled:opacity-50"
                      aria-label="Remove file"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="size-4 text-stone-300" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M9.75 9.75a.75.75 0 0 1 .75.75v6a.75.75 0 1 1-1.5 0v-6a.75.75 0 0 1 .75-.75Zm3.75.75a.75.75 0 0 0-1.5 0v6a.75.75 0 1 0 1.5 0v-6Z"/>
                        <path fillRule="evenodd" d="M3 6.75A.75.75 0 0 1 3.75 6h4.443A2.25 2.25 0 0 1 10.315 4.5h2.37A2.25 2.25 0 0 1 14.807 6H19.5a.75.75 0 0 1 0 1.5h-.708l-1.03 12.06A2.25 2.25 0 0 1 15.52 21H8.48a2.25 2.25 0 0 1-2.242-2.44L5.208 7.5H4.5A.75.75 0 0 1 3.75 6.75ZM9.75 6a.75.75 0 0 1 .671-.75h2.37a.75.75 0 0 1 .671.75H9.75Z" clipRule="evenodd"/>
                      </svg>
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-3 gap-y-2">
                    <a
                      href={libraryFileDownloadUrl(file.id)}
                      className="text-sm text-orange-300 hover:text-orange-200"
                    >
                      Download
                    </a>
                    <button
                      type="button"
                      onClick={() => setPickSkillForFile(file)}
                      disabled={runBusy || !skills.length}
                      className="text-sm text-orange-300 hover:text-orange-200 disabled:opacity-50"
                    >
                      Use skill
                    </button>
                    {file.chatId && (
                      <button
                        type="button"
                        onClick={() => navigate(`/chat?chatId=${encodeURIComponent(file.chatId)}`)}
                        className="text-sm text-orange-300 hover:text-orange-200"
                      >
                        Open in chat
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-zinc-800 px-4 py-8 text-center text-stone-400 text-sm">
              No files yet. Import from Canvas or attach a document in chat.
            </div>
          )}
        </BagSection>

        <BagSection
          title="Skills"
          count={skills.length}
          open={!collapsed.skills}
          onToggle={() => toggleSection("skills")}
        >
          <p className="text-sm text-stone-400 mb-4">
            Reusable prompts you can run on any file in your bag. Run a skill, pick a file, and start a new chat.
          </p>

          <div className="rounded-2xl bg-stone-950 border border-zinc-800 p-4 mb-4">
            <div className="grid gap-3">
              <input
                type="text"
                value={skillName}
                onChange={(e) => setSkillName(e.target.value)}
                placeholder="Skill name"
                className="w-full rounded-xl border border-zinc-800 bg-stone-900/60 px-3 py-2 text-sm text-white placeholder:text-stone-500"
              />
              <textarea
                value={skillPrompt}
                onChange={(e) => setSkillPrompt(e.target.value)}
                placeholder="Prompt to send with the attached file…"
                rows={3}
                className="w-full rounded-xl border border-zinc-800 bg-stone-900/60 px-3 py-2 text-sm text-white placeholder:text-stone-500 resize-y"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void saveSkill()}
                  disabled={busy || !skillName.trim() || !skillPrompt.trim()}
                  className="px-4 py-2 rounded-xl bg-orange-600/20 border border-orange-700 text-orange-200 hover:bg-orange-600/30 disabled:opacity-50 text-sm"
                >
                  {editingSkillId ? "Update skill" : "Add skill"}
                </button>
                {editingSkillId && (
                  <button
                    type="button"
                    onClick={resetSkillForm}
                    className="px-4 py-2 rounded-xl border border-zinc-800 text-stone-300 hover:bg-stone-900 text-sm"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          </div>

          {skillsError && (
            <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {skillsError}
            </div>
          )}

          {skills.length ? (
            <div className="grid md:grid-cols-2 gap-4">
              {skills.map((skill) => (
                <div key={skill.id} className="rounded-2xl bg-stone-950 border border-zinc-800 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs uppercase tracking-wide text-orange-300 mb-1">Skill</div>
                      <div className="text-white font-medium">{skill.name}</div>
                      <div className="text-stone-400 text-sm mt-2 line-clamp-3 whitespace-pre-wrap">{skill.prompt}</div>
                    </div>
                    <button
                      onClick={() => void removeSkill(skill.id)}
                      disabled={busy}
                      className="p-2 rounded-lg bg-stone-950 border border-zinc-800 hover:bg-stone-900 disabled:opacity-50 shrink-0"
                      aria-label="Delete skill"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="size-4 text-stone-300" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M9.75 9.75a.75.75 0 0 1 .75.75v6a.75.75 0 1 1-1.5 0v-6a.75.75 0 0 1 .75-.75Zm3.75.75a.75.75 0 0 0-1.5 0v6a.75.75 0 1 0 1.5 0v-6Z"/>
                        <path fillRule="evenodd" d="M3 6.75A.75.75 0 0 1 3.75 6h4.443A2.25 2.25 0 0 1 10.315 4.5h2.37A2.25 2.25 0 0 1 14.807 6H19.5a.75.75 0 0 1 0 1.5h-.708l-1.03 12.06A2.25 2.25 0 0 1 15.52 21H8.48a2.25 2.25 0 0 1-2.242-2.44L5.208 7.5H4.5A.75.75 0 0 1 3.75 6.75ZM9.75 6a.75.75 0 0 1 .671-.75h2.37a.75.75 0 0 1 .671.75H9.75Z" clipRule="evenodd"/>
                      </svg>
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => setPickFileForSkill(skill)}
                      disabled={runBusy || !files.length}
                      className="text-sm text-orange-300 hover:text-orange-200 disabled:opacity-50"
                    >
                      Run
                    </button>
                    <button
                      type="button"
                      onClick={() => startEditSkill(skill)}
                      className="text-sm text-stone-300 hover:text-white"
                    >
                      Edit
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-zinc-800 px-4 py-8 text-center text-stone-400 text-sm">
              No skills yet. Add one above to save it to your bag.
            </div>
          )}
        </BagSection>
      </div>

      <PickBagFileModal
        open={Boolean(pickFileForSkill)}
        title={`Run: ${pickFileForSkill?.name ?? "Skill"}`}
        files={files}
        busy={runBusy}
        onClose={() => setPickFileForSkill(null)}
        onPick={(file) => {
          if (pickFileForSkill) void handleRunSkill(pickFileForSkill, file);
        }}
      />

      <PickSkillModal
        open={Boolean(pickSkillForFile)}
        subtitle={`Pick a skill to run on ${pickSkillForFile?.filename ?? "this file"}.`}
        skills={skills}
        busy={runBusy}
        onClose={() => setPickSkillForFile(null)}
        onPick={(skill) => {
          if (pickSkillForFile) void handleRunSkill(skill, pickSkillForFile);
        }}
      />

      <PickStudyGroupModal
        open={Boolean(shareFolder)}
        title={shareFolder ? `Share ${shareFolder}` : "Share folder"}
        groups={studyGroups}
        busy={busy}
        onClose={() => setShareFolder(null)}
        onPick={(group) => {
          if (shareFolder) void shareDeck(group.id, shareFolder);
        }}
        onCreate={(name) => {
          void (async () => {
            if (!shareFolder) return;
            setBusy(true);
            setRunError(null);
            try {
              const created = await createStudyGroup(name);
              await shareDeck(created.group.id, shareFolder);
            } catch (err) {
              setRunError(err instanceof Error ? err.message : "Could not create that group.");
              setBusy(false);
            }
          })();
        }}
      />
    </div>
  );
}
