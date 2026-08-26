import { FormEvent, useState } from "react";
import { createStudyGroup, joinStudyGroup } from "../../lib/api";

export default function GroupManageModal({
  open,
  onClose,
  onReady,
}: {
  open: boolean;
  onClose: () => void;
  onReady: (groupId: string) => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await createStudyGroup(trimmed);
      setName("");
      onReady(res.group.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create that group.");
    } finally {
      setBusy(false);
    }
  };

  const join = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await joinStudyGroup(trimmed);
      setCode("");
      onReady(res.groupId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not join that group.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="absolute left-1/2 top-1/2 w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-stone-800 bg-stone-950 p-5 shadow-2xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-white">Create or join</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-stone-400 hover:bg-stone-900 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <form onSubmit={(e) => void create(e)} className="space-y-2">
          <div className="text-sm font-medium text-white">Create a group</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Group name (e.g. CHEM 101)"
            className="w-full rounded-xl border border-zinc-800 bg-stone-900 px-3 py-2 text-sm text-white placeholder:text-stone-500"
          />
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="px-4 py-2 rounded-xl bg-orange-600 hover:bg-orange-500 text-white text-sm disabled:opacity-50"
          >
            Create group
          </button>
        </form>

        <form onSubmit={(e) => void join(e)} className="space-y-2 pt-2 border-t border-zinc-800">
          <div className="text-sm font-medium text-white">Join a group</div>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="Invite code"
            className="w-full rounded-xl border border-zinc-800 bg-stone-900 px-3 py-2 text-sm text-white placeholder:text-stone-500 tracking-widest uppercase"
          />
          <button
            type="submit"
            disabled={busy || !code.trim()}
            className="px-4 py-2 rounded-xl bg-orange-600/20 border border-orange-700 text-orange-200 hover:bg-orange-600/30 text-sm disabled:opacity-50"
          >
            Join group
          </button>
        </form>
      </div>
    </div>
  );
}
