import { useEffect, useState } from "react";

import {
  clearLibraryFiles,
  createSkill,
  deleteFlashcard,
  deleteLibraryFile,
  deleteSkill,
  libraryFileDownloadUrl,
  listFlashcards,
  listLibraryFiles,
  listSkills,
  runSkillWithFile,
  updateSkill,
  type BagSkill,
  type LibraryFile,
  type SavedFlashcard,
} from "../lib/api";
import { useNavigate } from "react-router-dom";
import { PickBagFileModal, PickSkillModal } from "../components/LearningBag/BagPickers";

function formatBytes(size: number): string {
  if (!size) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
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

  const [skillName, setSkillName] = useState("");
  const [skillPrompt, setSkillPrompt] = useState("");
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);

  const [pickFileForSkill, setPickFileForSkill] = useState<BagSkill | null>(null);
  const [pickSkillForFile, setPickSkillForFile] = useState<LibraryFile | null>(null);

  const navigate = useNavigate();

  const load = async () => {
    try {
      const [{ flashcards }, fileRes, skillRes] = await Promise.all([
        listFlashcards().catch(() => ({ flashcards: [] as SavedFlashcard[] })),
        listLibraryFiles(),
        listSkills().catch(() => ({ skills: [] as BagSkill[] })),
      ]);
      setItems((flashcards || []).sort((a, b) => b.created - a.created));
      setFiles((fileRes.files || []).sort((a, b) => b.created - a.created));
      setSkills((skillRes.skills || []).sort((a, b) => b.created - a.created));
      setFilesError(null);
      setSkillsError(null);
    } catch (err) {
      setFilesError(err instanceof Error ? err.message : "Could not load files");
    }
  };

  useEffect(() => {
    load();
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
      navigate(`/chat?chatId=${encodeURIComponent(chatId)}`);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Could not start chat with that skill.");
    } finally {
      setRunBusy(false);
    }
  };

  const empty = !items.length && !files.length;

  return (
    <div className="min-h-screen w-full px-4 lg:pl-28 lg:pr-4">
      <div className="max-w-6xl mx-auto pt-6 pb-14 px-2">
        <div className="flex items-center justify-between mb-6">
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
            <h1 className="text-2xl font-semibold text-white">My Learning Bag</h1>
          </div>
          <button
            onClick={clearAll}
            disabled={busy || empty}
            className="px-4 py-2 rounded-2xl bg-red-900/20 border border-red-800 text-red-300 hover:bg-red-900/30 disabled:opacity-50"
          >
            Clear All
          </button>
        </div>

        {runError && (
          <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {runError}
          </div>
        )}

        <section className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Flashcards & notes</h2>
            <span className="text-xs text-stone-500">{items.length} saved</span>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {items.map((it) => (
              <div key={it.id} className="rounded-2xl bg-stone-950 border border-zinc-800 p-4">
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

          {!items.length && (
            <div className="rounded-2xl border border-dashed border-zinc-800 px-4 py-8 text-center text-stone-400 text-sm">
              Add flashcards or notes from the chat.
            </div>
          )}
        </section>

        <section className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Files</h2>
            <span className="text-xs text-stone-500">{files.length} imported</span>
          </div>
          {filesError && (
            <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {filesError}
            </div>
          )}
          {files.length ? (
            <div className="grid md:grid-cols-2 gap-4">
              {files.map((file) => (
                <div key={file.id} className="rounded-2xl bg-stone-950 border border-zinc-800 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs uppercase tracking-wide text-orange-300 mb-1">
                        {file.source === "canvas" ? "Canvas file" : "Uploaded file"}
                      </div>
                      <div className="text-white font-medium truncate">{file.filename}</div>
                      <div className="text-stone-400 text-sm mt-1">
                        {[formatBytes(file.size), file.mimeType].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <button
                      onClick={() => void removeFile(file.id)}
                      disabled={busy}
                      className="p-2 rounded-lg bg-stone-950 border border-zinc-800 hover:bg-stone-900 disabled:opacity-50"
                      aria-label="Remove file"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="size-4 text-stone-300" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M9.75 9.75a.75.75 0 0 1 .75.75v6a.75.75 0 1 1-1.5 0v-6a.75.75 0 0 1 .75-.75Zm3.75.75a.75.75 0 0 0-1.5 0v6a.75.75 0 1 0 1.5 0v-6Z"/>
                        <path fillRule="evenodd" d="M3 6.75A.75.75 0 0 1 3.75 6h4.443A2.25 2.25 0 0 1 10.315 4.5h2.37A2.25 2.25 0 0 1 14.807 6H19.5a.75.75 0 0 1 0 1.5h-.708l-1.03 12.06A2.25 2.25 0 0 1 15.52 21H8.48a2.25 2.25 0 0 1-2.242-2.44L5.208 7.5H4.5A.75.75 0 0 1 3.75 6.75ZM9.75 6a.75.75 0 0 1 .671-.75h2.37a.75.75 0 0 1 .671.75H9.75Z" clipRule="evenodd"/>
                      </svg>
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3">
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
        </section>

        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Skills</h2>
            <span className="text-xs text-stone-500">{skills.length} saved</span>
          </div>
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
        </section>
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
    </div>
  );
}
