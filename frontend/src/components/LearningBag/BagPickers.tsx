import { useState } from "react";
import type { BagSkill, LibraryFile } from "../../lib/api";

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

export function useSkillRunState() {
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  return { running, setRunning, runError, setRunError };
}
