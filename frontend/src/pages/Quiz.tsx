import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams, Link } from "react-router-dom";
import { quizStart, connectQuizStream, getSharedDeck, listFlashcards, type QuizEvent, type SavedFlashcard } from "../lib/api";
import LoadingIndicator from "../components/Chat/LoadingIndicator";
import TopicBar from "../components/Quiz/TopicBar";
import QuizHeader from "../components/Quiz/QuizHeader";
import QuestionCard from "../components/Quiz/QuestionCard";
import ResultsPanel from "../components/Quiz/ResultsPanel";
import ReviewModal from "../components/Quiz/ReviewModal";

export type Question = { id: number; question: string; options: string[]; correct: number; hint: string; explanation: string; imageHtml?: string };
export type UA = { questionId: number; selectedAnswer: number; correct: boolean; question: string; selectedOption: string; correctOption: string; explanation: string };

function takeQuizArray(a: unknown): Question[] {
  if (Array.isArray(a)) return a as Question[];
  if (Array.isArray((a as any)?.quiz)) return (a as any).quiz as Question[];
  return [];
}

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

function cardsToQuestions(cards: SavedFlashcard[]): Question[] {
  const study = cards.filter((c) => c.tag !== "note" && c.question.trim() && c.answer.trim());
  const answers = [...new Set(study.map((c) => c.answer.trim()))];
  return shuffle(study).map((card, i) => {
    const correct = card.answer.trim();
    const distractors = shuffle(answers.filter((a) => a !== correct)).slice(0, 3);
    const options = shuffle([correct, ...distractors]);
    return {
      id: i + 1,
      question: card.question,
      options,
      correct: Math.max(0, options.indexOf(correct)),
      hint: "Try to recall this from your saved flashcards.",
      explanation: correct,
    };
  });
}

export default function Quiz() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation() as any;

  const passedTopic = (location?.state && location.state.topic) || "";
  const initialTopic = search.get("topic") || passedTopic || "";
  const initialGroup = search.get("group") || "";
  const sharedGroup = search.get("sharedGroup") || "";
  const sharedItem = search.get("item") || "";

  const [topic, setTopic] = useState(initialTopic);
  const [bagCards, setBagCards] = useState<SavedFlashcard[]>([]);
  const [bagError, setBagError] = useState<string | null>(null);
  const [qs, setQs] = useState<Question[]>([]);
  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [showExp, setShowExp] = useState(false);
  const [done, setDone] = useState(false);
  const [answers, setAnswers] = useState<UA[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);

  const [connecting, setConnecting] = useState(false);

  const closeRef = useRef<null | (() => void)>(null);
  const bagStartRef = useRef("");

  const total = qs.length;
  const q = qs[idx];

  const percentage = useMemo(() => (total ? Math.round((score / total) * 100) : 0), [score, total]);
  const resultVisual = useMemo(() => { if (percentage >= 90) return { msg: "Excellent! You have mastered this topic!", cls: "bg-green-900/20 border border-green-700 text-green-200", icon: "🏆" }; if (percentage >= 70) return { msg: "Great job! You have a solid understanding.", cls: "bg-blue-900/20 border border-blue-700 text-blue-200", icon: "🎉" }; if (percentage >= 50) return { msg: "Good effort! Review the concepts and try again.", cls: "bg-yellow-900/20 border border-yellow-700 text-yellow-200", icon: "📚" }; return { msg: "Keep studying! Practice makes perfect.", cls: "bg-red-900/20 border border-red-700 text-red-200", icon: "💪" }; }, [percentage]);

  useEffect(() => () => { if (closeRef.current) closeRef.current(); }, []);

  const bagGroups = useMemo(() => {
    const map = new Map<string, SavedFlashcard[]>();
    for (const card of bagCards) {
      if (card.tag === "note") continue;
      const name = groupName(card);
      const list = map.get(name) || [];
      list.push(card);
      map.set(name, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [bagCards]);

  useEffect(() => {
    listFlashcards()
      .then((res) => {
        setBagCards(res.flashcards || []);
        setBagError(null);
      })
      .catch(() => setBagError("Could not load your flashcards."));
  }, []);

  useEffect(() => {
    if (sharedGroup || initialGroup) return;
    if (!initialTopic) return;
    start(initialTopic);
  }, [initialTopic, initialGroup, sharedGroup]);

  useEffect(() => {
    if (sharedGroup || !initialGroup || !bagCards.length) return;
    if (bagStartRef.current === initialGroup) return;
    bagStartRef.current = initialGroup;
    startFromCards(initialGroup, bagCards);
  }, [initialGroup, bagCards, sharedGroup]);

  useEffect(() => {
    if (!sharedGroup || !sharedItem) return;
    const key = `shared:${sharedItem}`;
    if (bagStartRef.current === key) return;
    bagStartRef.current = key;
    getSharedDeck(sharedGroup, sharedItem)
      .then((deck) => startFromCards(deck.name, deck.cards, true))
      .catch(() => setBagError("Could not load that shared folder."));
  }, [sharedGroup, sharedItem]);

  function resetQuestionState() {
    setIdx(0);
    setSelected(null);
    setShowHint(false);
    setShowExp(false);
  }

  async function start(t: string) {
    const trimmed = t.trim();
    if (!trimmed) return;
    if (closeRef.current) closeRef.current();

    setQs([]);
    resetQuestionState();
    setScore(0);
    setDone(false);
    setAnswers([]);
    setConnecting(true);

    try {
      const s = await quizStart(trimmed);
      const { close } = connectQuizStream(s.quizId, (ev: QuizEvent) => {
        if (ev.type === "quiz") {
          const arr = takeQuizArray(ev.quiz).map(q => ({
            ...q,
            correct: typeof q.correct === "number" ? Math.max(0, q.correct - 1) : 0
          }));
          setQs(arr);
          resetQuestionState();
          setConnecting(false);
        }
        if (ev.type === "done" || ev.type === "error") {
          setConnecting(false);
        }
      });
      closeRef.current = close;

      if (search.get("topic") !== trimmed) {
        navigate(`/quiz?topic=${encodeURIComponent(trimmed)}`, {
          replace: true,
          state: { topic: trimmed },
        });
      }
    } catch {
      setConnecting(false);
    }
  }

  const onSelect = (i: number) => { if (!showExp) setSelected(i); };

  const onNext = () => {
    if (selected == null || !q) return;
    const correct = selected === q.correct;
    const ua: UA = {
      questionId: q.id,
      selectedAnswer: selected,
      correct,
      question: q.question,
      selectedOption: q.options[selected],
      correctOption: q.options[q.correct],
      explanation: q.explanation,
    };
    setAnswers(a => [...a, ua]);
    setShowExp(true);
    if (correct) setScore(s => s + 1);
    setTimeout(() => {
      if (idx === total - 1) setDone(true);
      else {
        setIdx(n => n + 1);
        setSelected(null);
        setShowHint(false);
        setShowExp(false);
      }
    }, 350);
  };

  const newTopic = () => {
    setDone(false);
    setQs([]);
    setTopic("");
    setAnswers([]);
    resetQuestionState();
    setScore(0);
    bagStartRef.current = "";
    navigate("/quiz", { replace: true });
  };

  function startFromCards(name: string, all = bagCards, keepUrl = false) {
    if (closeRef.current) closeRef.current();
    const cards = name === "__all__"
      ? all.filter((c) => c.tag !== "note")
      : all.filter((c) => c.tag !== "note" && groupName(c) === name);
    const questions = cardsToQuestions(cards);
    if (!questions.length) return;
    const label = name === "__all__" ? "All flashcards" : name;
    setTopic(label);
    setQs(questions);
    resetQuestionState();
    setScore(0);
    setDone(false);
    setAnswers([]);
    setConnecting(false);
    if (!keepUrl && search.get("group") !== name) {
      navigate(`/quiz?group=${encodeURIComponent(name)}`, { replace: true, state: { group: name } });
    }
  }

  return (
    <div className="flex flex-col min-h-screen w-full px-4 lg:pl-28 lg:pr-4">
      <div className="w-full max-w-4xl mx-auto p-4 pt-8 pb-24 my-auto">

        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link to='/'
              className="p-2 rounded-xl bg-stone-950 border border-zinc-800 hover:bg-stone-900 transition-colors"
              aria-label="Back">
              <svg viewBox="0 0 24 24" className="size-5 text-stone-300" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
            </Link>
            <h1 className="text-2xl font-semibold text-white flex items-center gap-3">Quiz</h1>
          </div>
          <div className="px-3 py-1 rounded-full bg-gradient-to-r from-sky-500/20 to-blue-500/20 border border-sky-500/30 text-sky-300 text-xs font-medium">
            BETA
          </div>
        </div>

        {qs.length === 0 && !connecting && !done && (
          <>
            <TopicBar
              value={topic}
              onChange={setTopic}
              onStart={() => start(topic)}
            />

            <div className="rounded-3xl border border-stone-900 bg-stone-950/70 p-5">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <h2 className="text-white font-semibold">Quiz from your bag</h2>
                  <p className="text-sm text-stone-500 mt-1">Use a saved flashcard group instead of generating a new quiz.</p>
                </div>
                {bagGroups.length > 1 && (
                  <div className="flex shrink-0 gap-2">
                    <Link
                      to="/study?group=__all__"
                      className="rounded-full border border-orange-800/70 px-4 py-2 text-sm text-orange-200 hover:bg-orange-900/30"
                    >
                      Study all
                    </Link>
                    <button
                      type="button"
                      onClick={() => startFromCards("__all__")}
                      className="rounded-full bg-stone-800 hover:bg-stone-700 px-4 py-2 text-sm text-stone-100"
                    >
                      Quiz all
                    </button>
                  </div>
                )}
              </div>
              {bagError && (
                <div className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{bagError}</div>
              )}
              {bagGroups.length ? (
                <div className="space-y-2">
                  {bagGroups.map(([name, cards]) => (
                    <div
                      key={name}
                      className="w-full flex items-center gap-3 rounded-2xl border border-zinc-800 bg-stone-950 px-4 py-3"
                    >
                      <svg viewBox="0 0 24 24" className="size-5 shrink-0 text-orange-300" fill="currentColor">
                        <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0-2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
                      </svg>
                      <div className="min-w-0 flex-1">
                        <div className="text-white font-medium truncate">{name}</div>
                        <div className="text-xs text-stone-500">{cards.length} card{cards.length === 1 ? "" : "s"}</div>
                      </div>
                      <Link
                        to={`/study?group=${encodeURIComponent(name)}`}
                        className="shrink-0 rounded-lg border border-orange-800/70 px-3 py-1.5 text-sm text-orange-200 hover:bg-orange-900/30"
                      >
                        Study
                      </Link>
                      <button
                        type="button"
                        onClick={() => startFromCards(name)}
                        className="shrink-0 rounded-lg border border-zinc-800 px-3 py-1.5 text-sm text-stone-300 hover:text-white hover:bg-stone-900"
                      >
                        Quiz
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-zinc-800 px-4 py-8 text-center text-stone-400 text-sm">
                  No saved flashcards yet. Run a skill on a file, then come back here to quiz yourself.
                </div>
              )}
            </div>
          </>
        )}

        {connecting && (
          <div className="mt-10"><LoadingIndicator label="Building a quiz for you…" /></div>
        )}

        {qs.length > 0 && !done && q && (
          <>
            <QuizHeader topic={topic || "Quiz"} idx={idx} total={total} score={score} />
            <QuestionCard
              q={q}
              selected={selected}
              showExp={showExp}
              showHint={showHint}
              onSelect={onSelect}
              onHint={() => setShowHint(true)}
              onNext={onNext}
              isLast={idx === total - 1}
            />
          </>
        )}

        {done && (
          <ResultsPanel
            score={score}
            total={total}
            percentage={percentage}
            visual={resultVisual}
            answers={answers}
            onRetake={() => { resetQuestionState(); setScore(0); setDone(false); setAnswers([]); }}
            onReview={() => setReviewOpen(true)}
            onNewTopic={newTopic}
          />
        )}

        {reviewOpen && (
          <ReviewModal answers={answers} onClose={() => setReviewOpen(false)} />
        )}
      </div>
    </div>
  );
}