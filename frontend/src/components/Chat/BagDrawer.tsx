import { useState } from "react";
import { Link } from "react-router-dom";
import { libraryFileDownloadUrl, runSkillWithFile, type BagSkill, type LibraryFile } from "../../lib/api";
import { PickBagFileModal } from "../LearningBag/BagPickers";

type Item = { id: string; kind: "flashcard" | "note"; title: string; content: string };

type Props = {
  open: boolean;
  items: Item[];
  files?: LibraryFile[];
  skills?: BagSkill[];
  onClose: () => void;
  onClear: () => void;
  onOpenFile?: (file: LibraryFile) => void;
  onSkillChatStarted?: (chatId: string) => void;
};

function formatBytes(size: number): string {
  if (!size) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function BagDrawer({
  open,
  items,
  files = [],
  skills = [],
  onClose,
  onClear,
  onOpenFile,
  onSkillChatStarted,
}: Props) {
  const [pickFileForSkill, setPickFileForSkill] = useState<BagSkill | null>(null);
  const [runBusy, setRunBusy] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  if (!open) return null;

  const empty = items.length === 0 && files.length === 0 && skills.length === 0;

  const handleRunSkill = async (skill: BagSkill, file: LibraryFile) => {
    setRunBusy(true);
    setRunError(null);
    try {
      const chatId = await runSkillWithFile(skill, file);
      setPickFileForSkill(null);
      onClose();
      onSkillChatStarted?.(chatId);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Could not start chat with that skill.");
    } finally {
      setRunBusy(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" onClick={onClose}>
        <div className="absolute right-4 top-4 bottom-4 w-96 bg-stone-950 border border-stone-900 rounded-2xl p-6 overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">📝 My Learning Bag</h2>
            <button onClick={onClose} className="p-2 hover:bg-stone-900 rounded-xl transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="size-6">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {runError && (
            <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {runError}
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {empty ? (
              <div className="text-center text-stone-400 py-8">
                <img
                  src="https://forum.playhive.com/uploads/default/original/3X/f/3/f3e340eef1c12e1080f55958d70c5afc8a73dfa3.png"
                  alt="empty bag"
                  className="h-16 w-auto mx-auto opacity-50 mb-4"
                />
                <p>Your bag is empty</p>
                <p className="text-sm">Import files or add flashcards and notes to get started.</p>
              </div>
            ) : (
              <div className="space-y-6">
                {items.length > 0 && (
                  <section>
                    <h3 className="text-xs uppercase tracking-wide text-stone-400 mb-3">Cards & notes</h3>
                    <div className="space-y-3">
                      {items.map((b) => (
                        <div key={b.id} className="bg-stone-900/60 border border-stone-800 rounded-xl p-3">
                          <div className="text-xs uppercase tracking-wide text-stone-400 mb-1">{b.kind}</div>
                          <div className="text-white font-medium">{b.title}</div>
                          <div className="text-stone-300 text-sm mt-1">{b.content}</div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {files.length > 0 && (
                  <section>
                    <h3 className="text-xs uppercase tracking-wide text-stone-400 mb-3">Files</h3>
                    <div className="space-y-3">
                      {files.map((file) => (
                        <div key={file.id} className="bg-stone-900/60 border border-stone-800 rounded-xl p-3">
                          <div className="text-xs uppercase tracking-wide text-orange-300 mb-1">
                            {file.source === "canvas" ? "Canvas file" : "File"}
                          </div>
                          <div className="text-white font-medium truncate">{file.filename}</div>
                          <div className="text-stone-400 text-xs mt-1">
                            {[formatBytes(file.size), file.mimeType].filter(Boolean).join(" · ")}
                          </div>
                          <div className="mt-2 flex gap-3">
                            <a href={libraryFileDownloadUrl(file.id)} className="text-xs text-orange-300 hover:text-orange-200">
                              Download
                            </a>
                            {file.chatId && (
                              <button
                                type="button"
                                onClick={() => onOpenFile?.(file)}
                                className="text-xs text-orange-300 hover:text-orange-200"
                              >
                                Open in chat
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {skills.length > 0 && (
                  <section>
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <h3 className="text-xs uppercase tracking-wide text-stone-400">Skills</h3>
                      <Link to="/cards" className="text-xs text-orange-300 hover:text-orange-200" onClick={onClose}>
                        Manage
                      </Link>
                    </div>
                    <div className="space-y-3">
                      {skills.map((skill) => (
                        <div key={skill.id} className="bg-stone-900/60 border border-stone-800 rounded-xl p-3">
                          <div className="text-white font-medium">{skill.name}</div>
                          <div className="text-stone-400 text-xs mt-1 line-clamp-2">{skill.prompt}</div>
                          <button
                            type="button"
                            onClick={() => setPickFileForSkill(skill)}
                            disabled={runBusy || !files.length}
                            className="mt-2 text-xs text-orange-300 hover:text-orange-200 disabled:opacity-50"
                          >
                            Run
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}
          </div>

          <div className="mt-4 pt-4 border-t border-stone-900">
            <button onClick={onClear} className="w-full bg-red-900/20 hover:bg-red-900/30 border border-red-800 text-red-400 rounded-xl px-4 py-2 text-sm transition-colors">
              Clear All Items
            </button>
          </div>
        </div>
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
    </>
  );
}
