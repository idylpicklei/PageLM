import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  createStudyGroup,
  joinStudyGroup,
  listStudyGroups,
  type StudyGroupSummary,
} from "../lib/api";

export default function StudyGroups() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [groups, setGroups] = useState<StudyGroupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState(searchParams.get("code") || "");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const res = await listStudyGroups();
      setGroups(res.groups || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load study groups.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await createStudyGroup(trimmed);
      setName("");
      navigate(`/groups/${res.group.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create that group.");
    } finally {
      setBusy(false);
    }
  };

  const onJoin = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await joinStudyGroup(trimmed);
      setCode("");
      navigate(`/groups/${res.groupId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not join that group.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen w-full px-4 lg:pl-28 lg:pr-4">
      <div className="max-w-6xl mx-auto pt-6 pb-14 px-2">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-xl bg-stone-950 border border-zinc-800 hover:bg-stone-900"
            aria-label="Back"
          >
            <svg viewBox="0 0 24 24" className="size-5 text-stone-300" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-semibold text-white">Study Groups</h1>
            <p className="text-sm text-stone-400 mt-1">
              Create a group or join with a code, then share skills, files, and notes from your bag.
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-4 mb-10">
          <form onSubmit={onCreate} className="rounded-2xl bg-stone-950 border border-zinc-800 p-4 space-y-3">
            <h2 className="text-lg font-semibold text-white">Create a group</h2>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Group name (e.g. CHEM 101)"
              className="w-full rounded-xl border border-zinc-800 bg-stone-900/60 px-3 py-2 text-sm text-white placeholder:text-stone-500"
            />
            <button
              type="submit"
              disabled={busy || !name.trim()}
              className="px-4 py-2 rounded-xl bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium disabled:opacity-50"
            >
              Create group
            </button>
          </form>

          <form onSubmit={onJoin} className="rounded-2xl bg-stone-950 border border-zinc-800 p-4 space-y-3">
            <h2 className="text-lg font-semibold text-white">Join a group</h2>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Invite code"
              className="w-full rounded-xl border border-zinc-800 bg-stone-900/60 px-3 py-2 text-sm text-white placeholder:text-stone-500 tracking-widest uppercase"
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

        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Your groups</h2>
            <span className="text-xs text-stone-500">{groups.length} joined</span>
          </div>
          {loading ? (
            <div className="rounded-2xl border border-dashed border-zinc-800 px-4 py-8 text-center text-stone-400 text-sm">
              Loading groups…
            </div>
          ) : groups.length ? (
            <div className="grid md:grid-cols-2 gap-4">
              {groups.map((group) => (
                <Link
                  key={group.id}
                  to={`/groups/${group.id}`}
                  className="rounded-2xl bg-stone-950 border border-zinc-800 p-4 hover:border-zinc-700"
                >
                  <div className="text-xs uppercase tracking-wide text-orange-300 mb-1">
                    {group.role === "owner" ? "Owner" : "Member"}
                  </div>
                  <div className="text-white font-medium">{group.name}</div>
                  <div className="text-stone-500 text-sm mt-1">Code {group.joinCode}</div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-zinc-800 px-4 py-8 text-center text-stone-400 text-sm">
              You are not in any study groups yet. Create one or join with a code.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
