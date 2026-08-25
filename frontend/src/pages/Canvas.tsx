import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  canvasDisconnect,
  canvasImportFiles,
  canvasListCourses,
  canvasListFiles,
  canvasSaveToken,
  canvasStatus,
  ApiError,
  isSlowDownError,
  type CanvasCourse,
  type CanvasFile,
} from "../lib/api";

const MAX_IMPORT = 5;

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUpdatedAt(value: string | null): string {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

export default function CanvasPage() {
  const navigate = useNavigate();
  const [connected, setConnected] = useState(false);
  const [last4, setLast4] = useState<string | null>(null);
  const [host, setHost] = useState<string | null>(null);
  const [hostInput, setHostInput] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [saveBusy, setSaveBusy] = useState(false);
  const [disconnectBusy, setDisconnectBusy] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectSuccess, setConnectSuccess] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  const [courses, setCourses] = useState<CanvasCourse[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(false);
  const [coursesError, setCoursesError] = useState<string | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null);

  const [files, setFiles] = useState<CanvasFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<number>>(new Set());
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const res = await canvasStatus();
      setConnected(Boolean(res.connected));
      setLast4(res.last4 || null);
      setHost(res.host || null);
      if (res.host) setHostInput(res.host.replace(/^https:\/\//, ""));
    } catch {
      setConnected(false);
      setLast4(null);
      setHost(null);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const loadCourses = useCallback(async () => {
    setCoursesLoading(true);
    setCoursesError(null);
    setExpired(false);
    try {
      const res = await canvasListCourses();
      setCourses(res.items);
      setSelectedCourseId((prev) => prev ?? (res.items[0]?.id ?? null));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load Canvas courses";
      setCoursesError(msg);
      if (isSlowDownError(err)) return;
      if (err instanceof ApiError && err.status === 400 && /expired|invalid|revoked/i.test(msg)) {
        setExpired(true);
        setConnected(false);
        setLast4(null);
        setHost(null);
      }
    } finally {
      setCoursesLoading(false);
    }
  }, []);

  const loadFiles = useCallback(async (courseId: number) => {
    setFilesLoading(true);
    setFilesError(null);
    setSelectedFileIds(new Set());
    setExpired(false);
    try {
      const res = await canvasListFiles(courseId);
      setFiles(res.items);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load course files";
      setFilesError(msg);
      setFiles([]);
      if (isSlowDownError(err)) return;
      if (err instanceof ApiError && err.status === 400 && /expired|invalid|revoked/i.test(msg)) {
        setExpired(true);
        setConnected(false);
        setLast4(null);
        setHost(null);
      }
    } finally {
      setFilesLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (connected) void loadCourses();
  }, [connected, loadCourses]);

  useEffect(() => {
    if (connected && selectedCourseId != null) void loadFiles(selectedCourseId);
  }, [connected, selectedCourseId, loadFiles]);

  const handleSave = async () => {
    const token = tokenInput.trim();
    const hostValue = hostInput.trim();
    if (!token || !hostValue || saveBusy) return;
    setSaveBusy(true);
    setConnectError(null);
    setConnectSuccess(null);
    try {
      const res = await canvasSaveToken(hostValue, token);
      setConnected(true);
      setLast4(res.last4 || token.slice(-4));
      setHost(res.host);
      setHostInput(res.host.replace(/^https:\/\//, ""));
      setTokenInput("");
      setShowReplace(false);
      setExpired(false);
      setConnectSuccess("Canvas connected. Your token is stored securely and will not be shown again.");
      setCourses([]);
      setFiles([]);
      setSelectedCourseId(null);
      setSelectedFileIds(new Set());
      await loadCourses();
    } catch (err: unknown) {
      if (isSlowDownError(err)) {
        setConnectError(err instanceof Error ? err.message : "Canvas rate limit reached. Please wait and try again.");
      } else {
        setConnectError(err instanceof Error ? err.message : "Failed to save Canvas token");
      }
    } finally {
      setSaveBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (disconnectBusy) return;
    setDisconnectBusy(true);
    setConnectError(null);
    setConnectSuccess(null);
    try {
      await canvasDisconnect();
      setConnected(false);
      setLast4(null);
      setHost(null);
      setTokenInput("");
      setShowReplace(false);
      setCourses([]);
      setFiles([]);
      setSelectedCourseId(null);
      setSelectedFileIds(new Set());
      setExpired(false);
      setConnectSuccess("Canvas disconnected.");
    } catch (err: unknown) {
      setConnectError(err instanceof Error ? err.message : "Failed to disconnect Canvas");
    } finally {
      setDisconnectBusy(false);
    }
  };

  const toggleFile = (file: CanvasFile) => {
    if (!file.importable) return;
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(file.id)) {
        next.delete(file.id);
        return next;
      }
      if (next.size >= MAX_IMPORT) {
        setImportError(`Select up to ${MAX_IMPORT} files at a time.`);
        return prev;
      }
      setImportError(null);
      next.add(file.id);
      return next;
    });
  };

  const handleImport = async () => {
    if (importBusy || selectedCourseId == null || selectedFileIds.size === 0) return;
    setImportBusy(true);
    setImportError(null);
    try {
      const course = courses.find((c) => c.id === selectedCourseId);
      const res = await canvasImportFiles({
        courseId: selectedCourseId,
        fileIds: Array.from(selectedFileIds),
        title: course ? `Canvas: ${course.name}` : "Canvas import",
      });
      if (res.chatId) {
        navigate(`/chat?chatId=${encodeURIComponent(res.chatId)}`);
        return;
      }
      navigate("/cards");
    } catch (err: unknown) {
      if (isSlowDownError(err)) {
        setImportError(err instanceof Error ? err.message : "Import rate limit reached. Please wait and try again.");
      } else {
        setImportError(err instanceof Error ? err.message : "Failed to import Canvas files");
      }
    } finally {
      setImportBusy(false);
    }
  };

  const showTokenForm = !connected || showReplace || expired;
  const selectedCourse = courses.find((c) => c.id === selectedCourseId) || null;

  return (
    <div className="min-h-screen w-full px-4 lg:pl-28 lg:pr-4">
      <div className="max-w-5xl mx-auto pt-6 px-4 pb-14">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="p-2 rounded-xl bg-stone-950 border border-zinc-800 hover:bg-stone-900 transition-colors"
              aria-label="Back"
            >
              <svg viewBox="0 0 24 24" className="size-5 text-stone-300" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
            </Link>
            <h1 className="text-2xl font-semibold text-white">Canvas</h1>
          </div>
          <div className="px-3 py-1 rounded-full bg-gradient-to-r from-orange-500/20 to-red-500/20 border border-orange-500/30 text-orange-200 text-xs font-medium">
            {statusLoading ? "Checking…" : connected ? "Connected" : "Not connected"}
          </div>
        </div>

        <div className="space-y-6">
          <section className="rounded-2xl bg-stone-950 border border-zinc-800 p-5">
            <h2 className="text-lg font-semibold text-white mb-2">Connect Canvas LMS</h2>
            <p className="text-sm text-stone-400 leading-relaxed mb-4">
              Paste your Canvas school URL and a personal access token from{" "}
              <strong className="text-stone-300">Profile → Approved Integrations → New Access Token</strong>.
              PageLM uses it only to list and import your course files.
            </p>

            {connected && !showTokenForm && (
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-sm">
                  Connected{host ? ` · ${host.replace(/^https:\/\//, "")}` : ""}{last4 ? ` · ending in ${last4}` : ""}
                </span>
                <button
                  type="button"
                  onClick={() => setShowReplace(true)}
                  className="px-3 py-1.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 text-sm transition-colors"
                >
                  Replace token
                </button>
                <button
                  type="button"
                  onClick={() => void handleDisconnect()}
                  disabled={disconnectBusy}
                  className="px-3 py-1.5 rounded-xl border border-red-800/50 text-red-200 hover:bg-red-950/40 text-sm transition-colors disabled:opacity-50"
                >
                  {disconnectBusy ? "Disconnecting…" : "Disconnect"}
                </button>
              </div>
            )}

            {expired && (
              <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                Your Canvas token expired or was revoked. Paste a new access token to continue.
              </div>
            )}

            {showTokenForm && (
              <div className="space-y-3">
                <input
                  type="text"
                  autoComplete="off"
                  value={hostInput}
                  onChange={(e) => setHostInput(e.target.value)}
                  placeholder="School URL (e.g. yourschool.instructure.com)"
                  disabled={saveBusy}
                  className="w-full px-4 py-3 rounded-xl bg-stone-900/80 border border-zinc-700 text-white placeholder-zinc-500 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 outline-none transition-all disabled:opacity-50"
                />
                <input
                  type="password"
                  autoComplete="off"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="Paste Canvas access token…"
                  disabled={saveBusy}
                  className="w-full px-4 py-3 rounded-xl bg-stone-900/80 border border-zinc-700 text-white placeholder-zinc-500 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 outline-none transition-all disabled:opacity-50"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={saveBusy || !tokenInput.trim() || !hostInput.trim()}
                    className="px-4 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                  >
                    {saveBusy ? "Saving…" : "Save connection"}
                  </button>
                  {connected && showReplace && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowReplace(false);
                        setTokenInput("");
                        setConnectError(null);
                        if (host) setHostInput(host.replace(/^https:\/\//, ""));
                      }}
                      className="px-4 py-2.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 text-sm transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            )}

            {connectError && (
              <div className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {connectError}
              </div>
            )}
            {connectSuccess && (
              <div className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                {connectSuccess}
              </div>
            )}
          </section>

          {connected && (
            <>
              <section className="rounded-2xl bg-stone-950 border border-zinc-800 p-5">
                <h2 className="text-lg font-semibold text-white mb-4">Your courses</h2>
                {coursesError && (
                  <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                    {coursesError}
                  </div>
                )}
                {coursesLoading ? (
                  <div className="text-sm text-stone-400 py-4">Loading courses…</div>
                ) : courses.length === 0 ? (
                  <div className="text-sm text-stone-400 py-4">No active courses found.</div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {courses.map((course) => (
                      <button
                        key={course.id}
                        type="button"
                        onClick={() => setSelectedCourseId(course.id)}
                        className={`px-3 py-2 rounded-xl text-sm transition-colors ${
                          selectedCourseId === course.id
                            ? "bg-orange-600 text-white"
                            : "bg-stone-900 border border-zinc-800 text-stone-300 hover:bg-stone-800"
                        }`}
                      >
                        {course.name}
                      </button>
                    ))}
                  </div>
                )}
              </section>

              {selectedCourse && (
                <section className="rounded-2xl bg-stone-950 border border-zinc-800 p-5">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                    <div>
                      <h2 className="text-lg font-semibold text-white">Course files</h2>
                      <p className="text-sm text-stone-500 mt-1">{selectedCourse.name}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleImport()}
                      disabled={importBusy || selectedFileIds.size === 0}
                      className="px-4 py-2 rounded-xl bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                    >
                      {importBusy
                        ? "Importing…"
                        : `Import ${selectedFileIds.size || ""} file${selectedFileIds.size === 1 ? "" : "s"} to chat`}
                    </button>
                  </div>

                  <p className="text-xs text-stone-500 mb-4">
                    Check the files you want, then click Import. Supported: PDF, Word, plain text, Markdown (up to {MAX_IMPORT} files, 15 MB each).
                  </p>

                  {importError && (
                    <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                      {importError}
                    </div>
                  )}
                  {filesError && (
                    <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                      {filesError}
                    </div>
                  )}

                  {filesLoading ? (
                    <div className="text-sm text-stone-400 py-8 text-center">Loading files…</div>
                  ) : files.length === 0 ? (
                    <div className="text-sm text-stone-400 py-8 text-center">No files found in this course.</div>
                  ) : (
                    <div className="space-y-2">
                      {files.map((file) => {
                        const checked = selectedFileIds.has(file.id);
                        return (
                          <label
                            key={file.id}
                            className={`flex items-start gap-3 rounded-xl border px-3 py-3 transition-colors ${
                              file.importable
                                ? checked
                                  ? "border-orange-500/50 bg-orange-500/10"
                                  : "border-zinc-800 bg-stone-900/50 hover:border-zinc-700 cursor-pointer"
                                : "border-zinc-900 bg-stone-950/50 opacity-60 cursor-not-allowed"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!file.importable}
                              onChange={() => toggleFile(file)}
                              className="mt-1"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="text-white text-sm font-medium truncate">{file.name}</div>
                              <div className="text-stone-500 text-xs mt-1 flex flex-wrap gap-2">
                                <span>{file.contentType}</span>
                                <span>{formatBytes(file.size)}</span>
                                {formatUpdatedAt(file.updatedAt) && <span>Updated {formatUpdatedAt(file.updatedAt)}</span>}
                                {!file.importable && <span>Not supported for import</span>}
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
