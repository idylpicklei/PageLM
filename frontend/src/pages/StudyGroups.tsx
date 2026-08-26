import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import GroupManageModal from "../components/Groups/GroupManageModal";
import { joinStudyGroup, listStudyGroups } from "../lib/api";
import { getLastGroupId, setLastGroupId } from "../lib/lastGroup";

export default function StudyGroups() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  useEffect(() => {
    const code = searchParams.get("code") || "";
    const go = async () => {
      try {
        if (code) {
          const joined = await joinStudyGroup(code);
          setLastGroupId(joined.groupId);
          navigate(`/groups/${joined.groupId}`, { replace: true });
          return;
        }
        const res = await listStudyGroups();
        const groups = res.groups || [];
        if (!groups.length) {
          setEmpty(true);
          setManageOpen(true);
          return;
        }
        const last = getLastGroupId();
        const pick = groups.find((group) => group.id === last) || groups[0];
        setLastGroupId(pick.id);
        navigate(`/groups/${pick.id}`, { replace: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not open a study group.");
        setEmpty(true);
      }
    };
    void go();
  }, [navigate, searchParams]);

  return (
    <div className="min-h-screen w-full px-4 lg:pl-28 lg:pr-4">
      <div className="max-w-6xl mx-auto pt-6 pb-14 px-2">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-white">Study group</h1>
            <p className="text-sm text-stone-400 mt-1">
              {empty ? "Create a group or join with a code to get started." : "Opening your group…"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setManageOpen(true)}
              className="px-4 py-2 rounded-xl bg-orange-600/20 border border-orange-700 text-orange-200 hover:bg-orange-600/30 text-sm"
            >
              Create or join
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        {!empty && !error && (
          <div className="rounded-2xl border border-dashed border-zinc-800 px-4 py-8 text-center text-stone-400 text-sm">
            Opening your group…
          </div>
        )}
      </div>

      <GroupManageModal
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        onReady={(groupId) => {
          setLastGroupId(groupId);
          navigate(`/groups/${groupId}`, { replace: true });
        }}
      />
    </div>
  );
}
