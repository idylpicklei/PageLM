import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  libraryFileToUpload,
  listLibraryFiles,
  type LibraryFile,
} from "../../lib/api";

type Props = {
  open: boolean;
  onClose: () => void;
  onPickDevice: () => void;
  onPickBagFile: (file: File) => void;
};

function formatBytes(size: number): string {
  if (!size) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function BagFilePicker({ open, onClose, onPickDevice, onPickBagFile }: Props) {
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickingId, setPickingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    listLibraryFiles()
      .then((res) => {
        if (!cancelled) setFiles(res.files || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load your learning bag.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const chooseBagFile = async (item: LibraryFile) => {
    if (pickingId) return;
    setPickingId(item.id);
    setError(null);
    try {
      onPickBagFile(await libraryFileToUpload(item));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not attach that file.");
    } finally {
      setPickingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="absolute left-1/2 top-1/2 w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-stone-800 bg-stone-950 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Add files</h2>
            <p className="mt-1 text-sm text-stone-400">Use a file from your learning bag or this device.</p>
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

        <button
          type="button"
          onClick={() => {
            onPickDevice();
            onClose();
          }}
          className="mb-4 w-full rounded-xl border border-zinc-800 bg-stone-900/60 px-4 py-3 text-left text-sm text-stone-200 hover:border-zinc-700"
        >
          From this device
        </button>

        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs uppercase tracking-wide text-stone-400">Learning bag</h3>
          <Link to="/cards" className="text-xs text-orange-300 hover:text-orange-200" onClick={onClose}>
            Open bag
          </Link>
        </div>

        {error && (
          <div className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="max-h-72 space-y-2 overflow-y-auto">
          {loading ? (
            <div className="py-8 text-center text-sm text-stone-400">Loading files…</div>
          ) : files.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-800 px-3 py-6 text-center text-sm text-stone-400">
              No files in your bag yet. Import from{" "}
              <Link to="/canvas" className="text-orange-300 hover:text-orange-200" onClick={onClose}>
                Canvas
              </Link>{" "}
              or upload from this device.
            </div>
          ) : (
            files.map((file) => (
              <button
                key={file.id}
                type="button"
                disabled={Boolean(pickingId)}
                onClick={() => void chooseBagFile(file)}
                className="w-full rounded-xl border border-zinc-800 bg-stone-900/50 px-3 py-3 text-left hover:border-zinc-700 disabled:opacity-60"
              >
                <div className="truncate text-sm font-medium text-white">{file.filename}</div>
                <div className="mt-1 text-xs text-stone-500">
                  {[file.source === "canvas" ? "Canvas" : "Uploaded", formatBytes(file.size)].filter(Boolean).join(" · ")}
                  {pickingId === file.id ? " · Adding…" : ""}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
