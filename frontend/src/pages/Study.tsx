import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  countDueTomorrow,
  getSharedDeck,
  isFlashcardDue,
  listFlashcards,
  reviewFlashcard,
  type SavedFlashcard,
} from "../lib/api";

function shuffle<T>(items: T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function groupName(card: SavedFlashcard): string {
  if (card.tag === "note") return "Notes";
  return card.group || "Ungrouped";
}

function asCardText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

function orderForStudy(cards: SavedFlashcard[]): SavedFlashcard[] {
  const due = cards.filter((c) => isFlashcardDue(c));
  const later = cards.filter((c) => !isFlashcardDue(c));
  return [...shuffle(due), ...shuffle(later)];
}

export default function Study() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const requested = search.get("group") || "";
  const dueOnly = search.get("due") === "1";
  const sharedGroup = search.get("sharedGroup") || "";
  const sharedItem = search.get("item") || "";
  const isShared = Boolean(sharedGroup && sharedItem);

  const [queue, setQueue] = useState<SavedFlashcard[]>([]);
  const [allInScope, setAllInScope] = useState<SavedFlashcard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState(0);
  const [missed, setMissed] = useState(0);
  const [done, setDone] = useState(false);
  const [dueTomorrow, setDueTomorrow] = useState(0);

  useEffect(() => {
    setLoading(true);
    const reset = (next: SavedFlashcard[], emptyMessage: string) => {
      const ordered = orderForStudy(next);
      setQueue(ordered);
      setAllInScope(next);
      setError(ordered.length ? null : emptyMessage);
      setFlipped(false);
      setKnown(0);
      setMissed(0);
      setDone(false);
      setDueTomorrow(0);
    };

    const load = isShared
      ? getSharedDeck(sharedGroup, sharedItem).then((deck) =>
          reset(deck.cards, "That shared folder has no flashcards.")
        )
      : listFlashcards().then((res) => {
          const all = (res.flashcards || [])
            .filter((c) => {
              const question = asCardText(c.question).trim();
              const answer = asCardText(c.answer).trim();
              return c.tag !== "note" && question && answer;
            })
            .map((c) => ({
              ...c,
              question: asCardText(c.question),
              answer: asCardText(c.answer),
            }));
          let filtered =
            requested === "__all__" || !requested
              ? all
              : all.filter((c) => groupName(c) === requested);
          if (dueOnly) filtered = filtered.filter((c) => isFlashcardDue(c));
          reset(filtered, dueOnly ? "No cards due for review." : "No flashcards in that group.");
        });

    load
      .catch(() =>
        setError(isShared ? "Could not load that shared folder." : "Could not load your flashcards.")
      )
      .finally(() => setLoading(false));
  }, [requested, dueOnly, sharedGroup, sharedItem, isShared]);

  const card = queue[0];
  const title = isShared
    ? (allInScope[0]?.group || "Shared folder")
    : dueOnly
      ? requested === "__all__" || !requested
        ? "Due for review"
        : `${requested} · due`
      : requested === "__all__" || !requested
        ? "All flashcards"
        : requested;
  const totalStarted = allInScope.length;
  const remaining = queue.length;
  const studied = totalStarted - remaining + (done ? 0 : card ? 1 : 0);
  const progress = useMemo(
    () => (totalStarted ? Math.round(((totalStarted - remaining) / totalStarted) * 100) : 0),
    [totalStarted, remaining]
  );

  const finish = async () => {
    setDone(true);
    if (!isShared) {
      try {
        const res = await listFlashcards();
        const all = (res.flashcards || []).filter((c) => c.tag !== "note");
        const scoped =
          requested === "__all__" || !requested
            ? all
            : all.filter((c) => groupName(c) === requested);
        setDueTomorrow(countDueTomorrow(scoped));
      } catch {
        setDueTomorrow(0);
      }
    }
  };

  const mark = (gotIt: boolean) => {
    if (!card || done) return;
    if (gotIt) setKnown((n) => n + 1);
    else setMissed((n) => n + 1);

    if (!isShared) {
      void reviewFlashcard(card.id, gotIt ? "good" : "again").catch(() => {});
    }

    const next = gotIt ? queue.slice(1) : [...queue.slice(1), queue[0]];
    setQueue(next);
    setFlipped(false);
    if (next.length === 0) void finish();
  };

  const restart = () => {
    setQueue(orderForStudy(allInScope));
    setFlipped(false);
    setKnown(0);
    setMissed(0);
    setDone(false);
    setDueTomorrow(0);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (done || !card) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setFlipped((v) => !v);
      } else if (e.key === "ArrowRight" || e.key === "1") {
        mark(false);
      } else if (e.key === "2") {
        mark(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, done]);

  return (
    <div className="flex flex-col min-h-screen w-full px-4 lg:pl-28 lg:pr-4">
      <div className="w-full max-w-3xl mx-auto p-4 pt-8 pb-24 my-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="p-2 rounded-xl bg-stone-950 border border-zinc-800 hover:bg-stone-900"
              aria-label="Back"
            >
              <svg viewBox="0 0 24 24" className="size-5 text-stone-300" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
            </button>
            <div>
              <h1 className="text-2xl font-semibold text-white">Study</h1>
              <p className="text-sm text-stone-500 truncate max-w-[16rem] sm:max-w-md">{title}</p>
            </div>
          </div>
          <Link to="/cards" className="text-sm text-orange-300 hover:text-orange-200">
            My bag
          </Link>
        </div>

        {loading && (
          <div className="rounded-2xl border border-zinc-800 bg-stone-950 px-4 py-8 text-center text-stone-400 text-sm">
            Loading cards…
          </div>
        )}

        {!loading && error && (
          <div className="rounded-2xl border border-zinc-800 bg-stone-950 px-4 py-8 text-center text-stone-400 text-sm">
            {error}
          </div>
        )}

        {!loading && !error && card && !done && (
          <>
            <div className="flex items-center justify-between text-sm text-stone-400 mb-4">
              <span>
                Card {totalStarted - remaining + 1} of {totalStarted}
                {remaining > 1 && queue.length > totalStarted - remaining + 1 ? " · repeats included" : ""}
              </span>
              <span>{remaining} left</span>
            </div>
            <div className="h-2 rounded-full bg-stone-800 mb-6 overflow-hidden">
              <div className="h-full bg-orange-500 transition-all" style={{ width: `${progress}%` }} />
            </div>

            <button
              type="button"
              onClick={() => setFlipped((v) => !v)}
              className="w-full min-h-[280px] rounded-3xl border border-zinc-800 bg-stone-950 px-6 py-10 text-center hover:border-orange-800/70 transition-colors"
            >
              <div className="text-xs uppercase tracking-wide text-orange-300 mb-4">
                {flipped ? "Answer" : "Question"}
              </div>
              <div className="text-2xl font-semibold text-white whitespace-pre-wrap">
                {flipped ? card.answer : card.question}
              </div>
              <div className="mt-8 text-sm text-stone-500">
                {flipped ? "Tap to see the question again" : "Tap to flip"}
              </div>
            </button>

            <div className="mt-6 flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={() => mark(false)}
                className="flex-1 rounded-xl border border-zinc-800 bg-stone-900 px-4 py-3 text-stone-200 hover:bg-stone-800"
              >
                Still learning
              </button>
              <button
                type="button"
                onClick={() => mark(true)}
                className="flex-1 rounded-xl border border-orange-800/70 bg-orange-900/20 px-4 py-3 text-orange-100 hover:bg-orange-900/30"
              >
                Got it
              </button>
            </div>
            {!isShared && (
              <p className="mt-3 text-center text-xs text-stone-500">
                Spaced repetition schedules your next review when you rate a card.
              </p>
            )}
          </>
        )}

        {done && (
          <div className="rounded-3xl border border-zinc-800 bg-stone-950 p-8 text-center">
            <h2 className="text-2xl font-semibold text-white mb-2">Study session done</h2>
            <p className="text-stone-400 mb-2">
              {known} got it · {missed} still learning · {studied} cards reviewed
            </p>
            {!isShared && dueTomorrow > 0 && (
              <p className="text-sm text-orange-200/90 mb-6">
                {dueTomorrow} card{dueTomorrow === 1 ? "" : "s"} due tomorrow
              </p>
            )}
            {!isShared && dueTomorrow === 0 && <div className="mb-6" />}
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                type="button"
                onClick={restart}
                className="rounded-xl border border-orange-800/70 bg-orange-900/20 px-5 py-3 text-orange-100 hover:bg-orange-900/30"
              >
                Study again
              </button>
              <Link
                to="/cards"
                className="rounded-xl border border-zinc-800 bg-stone-900 px-5 py-3 text-stone-200 hover:bg-stone-800"
              >
                Back to bag
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
