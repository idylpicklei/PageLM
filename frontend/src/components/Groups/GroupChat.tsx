import { FormEvent, useEffect, useRef, useState } from "react";
import { listStudyGroupMessages, sendStudyGroupMessage, type StudyGroupMessage } from "../../lib/api";

function displayName(email: string): string {
  return email.split("@")[0] || email;
}

function formatTime(created: number): string {
  return new Date(created).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function GroupChat({
  groupId,
  userId,
  active,
}: {
  groupId: string;
  userId?: string;
  active: boolean;
}) {
  const [messages, setMessages] = useState<StudyGroupMessage[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const load = async () => {
    try {
      const res = await listStudyGroupMessages(groupId);
      setMessages(res.messages || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load chat.");
    }
  };

  useEffect(() => {
    if (!active) return;
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [active, groupId]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || !stickRef.current) return;
    box.scrollTop = box.scrollHeight;
  }, [messages.length]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await sendStudyGroupMessage(groupId, trimmed);
      setText("");
      stickRef.current = true;
      setMessages((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send that message.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-2xl border border-zinc-800 bg-stone-950 overflow-hidden flex flex-col min-h-[28rem] h-[min(70vh,40rem)]">
      <div
        ref={boxRef}
        onScroll={() => {
          const box = boxRef.current;
          if (!box) return;
          stickRef.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
        }}
        className="flex-1 overflow-y-auto p-4 space-y-3"
      >
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-stone-500 text-center px-6">
            No messages yet. Say hello to the group.
          </div>
        ) : (
          messages.map((message) => {
            const mine = message.userId === userId;
            return (
              <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-3 py-2 ${
                    mine
                      ? "bg-orange-900/30 border border-orange-800/70 text-orange-50"
                      : "bg-stone-900 border border-zinc-800 text-stone-100"
                  }`}
                >
                  <div className="text-[11px] uppercase tracking-wide text-stone-400 mb-1">
                    {mine ? "You" : displayName(message.email)} · {formatTime(message.created)}
                  </div>
                  <div className="text-sm whitespace-pre-wrap break-words">{message.text}</div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {error && (
        <div className="px-4 py-2 text-sm text-red-200 border-t border-red-900/40 bg-red-500/10">{error}</div>
      )}

      <form onSubmit={(e) => void send(e)} className="border-t border-zinc-800 p-3 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          placeholder="Message the group"
          className="min-w-0 flex-1 rounded-xl border border-zinc-800 bg-stone-900 px-3 py-2 text-sm text-white placeholder:text-stone-500"
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          className="rounded-xl border border-orange-800/70 bg-orange-900/20 px-4 py-2 text-sm text-orange-100 hover:bg-orange-900/30 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
