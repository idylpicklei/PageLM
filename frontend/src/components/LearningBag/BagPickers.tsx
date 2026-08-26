import { useState } from "react";
import { Link } from "react-router-dom";
import type { BagSkill, LibraryFile, SavedFlashcard, StudyGroupSummary } from "../../lib/api";

function formatBytes(size: number): string {
  if (!size) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

type PickFileProps = {
  open: boolean;
  title?: string;
  subtitle?: string;
  files: LibraryFile[];
  busy?: boolean;
  onClose: () => void;
  onPick: (file: LibraryFile) => void;
};

export function PickBagFileModal({
  open,
  title = "Pick a file",
  subtitle = "Choose a file from your learning bag to run this skill.",
  files,
  busy,
  onClose,
  onPick,
}: PickFileProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="absolute left-1/2 top-1/2 w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-stone-800 bg-stone-950 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            <p className="mt-1 text-sm text-stone-400">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-stone-400 hover:bg-stone-900 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="max-h-72 space-y-2 overflow-y-auto">
          {files.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-800 px-3 py-6 text-center text-sm text-stone-400">
              No files in your bag yet. Import from Canvas or attach a document in chat.
            </div>
          ) : (
            files.map((file) => (
              <button
                key={file.id}
                type="button"
                disabled={busy}
                onClick={() => onPick(file)}
                className="w-full rounded-xl border border-zinc-800 bg-stone-900/50 px-3 py-3 text-left hover:border-zinc-700 disabled:opacity-60"
              >
                <div className="truncate text-sm font-medium text-white">{file.filename}</div>
                <div className="mt-1 text-xs text-stone-500">
                  {[file.source === "canvas" ? "Canvas" : "Uploaded", formatBytes(file.size)].filter(Boolean).join(" · ")}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

type PickSkillProps = {
  open: boolean;
  title?: string;
  subtitle?: string;
  skills: BagSkill[];
  busy?: boolean;
  onClose: () => void;
  onPick: (skill: BagSkill) => void;
};

export function PickSkillModal({
  open,
  title = "Use a skill",
  subtitle = "Pick a skill to run on this file.",
  skills,
  busy,
  onClose,
  onPick,
}: PickSkillProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="absolute left-1/2 top-1/2 w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-stone-800 bg-stone-950 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            <p className="mt-1 text-sm text-stone-400">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-stone-400 hover:bg-stone-900 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="max-h-72 space-y-2 overflow-y-auto">
          {skills.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-800 px-3 py-6 text-center text-sm text-stone-400">
              No skills yet. Add one on the My Learning Bag page.
            </div>
          ) : (
            skills.map((skill) => (
              <button
                key={skill.id}
                type="button"
                disabled={busy}
                onClick={() => onPick(skill)}
                className="w-full rounded-xl border border-zinc-800 bg-stone-900/50 px-3 py-3 text-left hover:border-zinc-700 disabled:opacity-60"
              >
                <div className="text-sm font-medium text-white">{skill.name}</div>
                <div className="mt-1 line-clamp-2 text-xs text-stone-500">{skill.prompt}</div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

type PickNoteProps = {
  open: boolean;
  title?: string;
  subtitle?: string;
  notes: SavedFlashcard[];
  busy?: boolean;
  onClose: () => void;
  onPick: (note: SavedFlashcard) => void;
};

export function PickNoteModal({
  open,
  title = "Share a note",
  subtitle = "Pick a flashcard or note from your learning bag.",
  notes,
  busy,
  onClose,
  onPick,
}: PickNoteProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="absolute left-1/2 top-1/2 w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-stone-800 bg-stone-950 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            <p className="mt-1 text-sm text-stone-400">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-stone-400 hover:bg-stone-900 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="max-h-72 space-y-2 overflow-y-auto">
          {notes.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-800 px-3 py-6 text-center text-sm text-stone-400">
              No flashcards or notes in your bag yet.
            </div>
          ) : (
            notes.map((note) => (
              <button
                key={note.id}
                type="button"
                disabled={busy}
                onClick={() => onPick(note)}
                className="w-full rounded-xl border border-zinc-800 bg-stone-900/50 px-3 py-3 text-left hover:border-zinc-700 disabled:opacity-60"
              >
                <div className="text-xs uppercase tracking-wide text-stone-500">{note.tag === "note" ? "note" : "flashcard"}</div>
                <div className="mt-1 text-sm font-medium text-white">{note.question}</div>
                <div className="mt-1 line-clamp-2 text-xs text-stone-500">{note.answer}</div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

type PickStudyGroupProps = {
  open: boolean;
  title?: string;
  subtitle?: string;
  groups: StudyGroupSummary[];
  busy?: boolean;
  onClose: () => void;
  onPick: (group: StudyGroupSummary) => void;
  onCreate?: (name: string) => void;
};

export function PickStudyGroupModal({
  open,
  title = "Share to a study group",
  subtitle = "The group gets its own copy of this flashcard folder.",
  groups,
  busy,
  onClose,
  onPick,
  onCreate,
}: PickStudyGroupProps) {
  const [name, setName] = useState("");
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="absolute left-1/2 top-1/2 w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-stone-800 bg-stone-950 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            <p className="mt-1 text-sm text-stone-400">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-stone-400 hover:bg-stone-900 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="max-h-72 space-y-2 overflow-y-auto">
          {groups.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-800 px-3 py-6 text-center text-sm text-stone-400">
              You are not in a study group yet. Create one below or on the{" "}
              <Link to="/groups" className="text-orange-300 hover:text-orange-200" onClick={onClose}>
                Study Groups
              </Link>{" "}
              page.
            </div>
          ) : (
            groups.map((group) => (
              <button
                key={group.id}
                type="button"
                disabled={busy}
                onClick={() => onPick(group)}
                className="w-full rounded-xl border border-zinc-800 bg-stone-900/50 px-3 py-3 text-left hover:border-zinc-700 disabled:opacity-60"
              >
                <div className="text-sm font-medium text-white">{group.name}</div>
                <div className="mt-1 text-xs text-stone-500">Code {group.joinCode}</div>
              </button>
            ))
          )}
        </div>

        {onCreate && (
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = name.trim();
              if (!trimmed || busy) return;
              onCreate(trimmed);
              setName("");
            }}
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New group name"
              className="min-w-0 flex-1 rounded-xl border border-zinc-800 bg-stone-900 px-3 py-2 text-sm text-white placeholder:text-stone-500"
            />
            <button
              type="submit"
              disabled={busy || !name.trim()}
              className="rounded-xl border border-orange-800/70 px-3 py-2 text-sm text-orange-200 hover:bg-orange-900/30 disabled:opacity-50"
            >
              Create
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

type PickDeckProps = {
  open: boolean;
  folders: Array<[string, number]>;
  busy?: boolean;
  onClose: () => void;
  onPick: (name: string) => void;
};

export function PickDeckModal({
  open,
  folders,
  busy,
  onClose,
  onPick,
}: PickDeckProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="absolute left-1/2 top-1/2 w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-stone-800 bg-stone-950 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Share a flashcard folder</h2>
            <p className="mt-1 text-sm text-stone-400">The group gets the whole folder, not one card at a time.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-stone-400 hover:bg-stone-900 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="max-h-72 space-y-2 overflow-y-auto">
          {folders.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-800 px-3 py-6 text-center text-sm text-stone-400">
              No flashcard folders in your bag yet.
            </div>
          ) : (
            folders.map(([name, count]) => (
              <button
                key={name}
                type="button"
                disabled={busy}
                onClick={() => onPick(name)}
                className="w-full rounded-xl border border-zinc-800 bg-stone-900/50 px-3 py-3 text-left hover:border-zinc-700 disabled:opacity-60"
              >
                <div className="text-sm font-medium text-white">{name}</div>
                <div className="mt-1 text-xs text-stone-500">{count} card{count === 1 ? "" : "s"}</div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export function useSkillRunState() {
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  return { running, setRunning, runError, setRunError };
}
