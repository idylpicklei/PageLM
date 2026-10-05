import { describe, expect, it } from "vitest";
import {
  allScope,
  cardsForScope,
  cardsForSession,
  emptyChecks,
  folderName,
  launch,
  oneFolder,
  parsePersonalStudy,
  retainChecks,
  scopeDueMarker,
  scopeFolderNames,
  scopeFromChecks,
  scopeLabel,
  sessionEmptyMessage,
  studyPath,
  toggleCheck,
  type FolderName,
} from "./studyScope";

function mustFolder(raw: string): FolderName {
  const folder = folderName(raw);
  if (!folder) throw new Error(`expected a folder name, got ${JSON.stringify(raw)}`);
  return folder;
}

describe("studyPath and parsePersonalStudy", () => {
  it("round-trips all, one folder, two folders, and due=1", () => {
    expect(studyPath(launch(allScope()))).toBe("/study?group=__all__");
    expect(parsePersonalStudy(new URLSearchParams("group=__all__"))).toEqual({
      status: "ok",
      launch: { scope: { kind: "all" }, dueOnly: false },
    });

    expect(studyPath(launch(allScope(), true))).toBe("/study?group=__all__&due=1");
    expect(parsePersonalStudy(new URLSearchParams("group=__all__&due=1"))).toEqual({
      status: "ok",
      launch: { scope: { kind: "all" }, dueOnly: true },
    });

    const biology = mustFolder("Biology");
    expect(studyPath(launch(oneFolder(biology)))).toBe("/study?group=Biology");
    expect(parsePersonalStudy(new URLSearchParams("group=Biology"))).toEqual({
      status: "ok",
      launch: { scope: { kind: "folders", folders: ["Biology"] }, dueOnly: false },
    });
    expect(studyPath(launch(oneFolder(biology), true))).toBe("/study?group=Biology&due=1");
    expect(parsePersonalStudy(new URLSearchParams("group=Biology&due=1"))).toEqual({
      status: "ok",
      launch: { scope: { kind: "folders", folders: ["Biology"] }, dueOnly: true },
    });

    const chemistry = mustFolder("Chemistry");
    const selected = scopeFromChecks(toggleCheck(toggleCheck(emptyChecks(), chemistry), biology));
    expect(selected).toEqual({ kind: "folders", folders: ["Biology", "Chemistry"] });
    expect(studyPath(launch(selected!))).toBe("/study?group=Biology&group=Chemistry");
    expect(studyPath(launch(selected!, true))).toBe("/study?group=Biology&group=Chemistry&due=1");
    expect(parsePersonalStudy(new URLSearchParams("group=Chemistry&group=Biology"))).toEqual({
      status: "ok",
      launch: {
        scope: { kind: "folders", folders: ["Biology", "Chemistry"] },
        dueOnly: false,
      },
    });
    expect(parsePersonalStudy(new URLSearchParams("group=Chemistry&group=Biology&due=1"))).toEqual({
      status: "ok",
      launch: {
        scope: { kind: "folders", folders: ["Biology", "Chemistry"] },
        dueOnly: true,
      },
    });
    expect(studyPath(launch(oneFolder(mustFolder("Cell Bio"))))).toBe("/study?group=Cell%20Bio");
  });

  it("reads missing and empty group as all, and a whitespace-only group as that folder", () => {
    expect(parsePersonalStudy(new URLSearchParams())).toEqual({
      status: "ok",
      launch: { scope: { kind: "all" }, dueOnly: false },
    });
    expect(parsePersonalStudy(new URLSearchParams([["group", ""]]))).toEqual({
      status: "ok",
      launch: { scope: { kind: "all" }, dueOnly: false },
    });
    const whitespace = new URLSearchParams();
    whitespace.append("group", "  ");
    expect(parsePersonalStudy(whitespace)).toEqual({
      status: "ok",
      launch: {
        scope: { kind: "folders", folders: ["  "] },
        dueOnly: false,
      },
    });
  });

  it("rejects a mix of __all__ and a named folder", () => {
    expect(parsePersonalStudy(new URLSearchParams("group=__all__&group=Biology"))).toEqual({
      status: "invalid",
      message: "That study link mixes all folders with a named folder.",
    });
  });

  it("rejects Notes instead of studying the other folders", () => {
    expect(parsePersonalStudy(new URLSearchParams("group=Notes"))).toEqual({
      status: "invalid",
      message: "Notes are not part of flashcard review.",
    });
    expect(parsePersonalStudy(new URLSearchParams("group=Biology&group=Notes"))).toEqual({
      status: "invalid",
      message: "Notes are not part of flashcard review.",
    });
  });
});

describe("scopeFromChecks", () => {
  it("returns null for an empty selection and a sorted scope for the folders still on screen", () => {
    expect(scopeFromChecks(emptyChecks())).toBeNull();

    const biology = mustFolder("Biology");
    const chemistry = mustFolder("Chemistry");
    const history = mustFolder("History");
    const checks = toggleCheck(toggleCheck(toggleCheck(emptyChecks(), history), chemistry), biology);
    expect(scopeFromChecks(checks)).toEqual({
      kind: "folders",
      folders: ["Biology", "Chemistry", "History"],
    });
    expect(scopeFromChecks(retainChecks(checks, [chemistry, biology]))).toEqual({
      kind: "folders",
      folders: ["Biology", "Chemistry"],
    });
    expect(scopeFromChecks(checks)).toEqual({
      kind: "folders",
      folders: ["Biology", "Chemistry", "History"],
    });
    expect(scopeFromChecks(toggleCheck(toggleCheck(emptyChecks(), biology), biology))).toBeNull();
  });
});

describe("cardsForScope and cardsForSession", () => {
  const cards = [
    { group: "Biology", tag: "core", question: "mito", answer: "power" },
    { group: "Chemistry", tag: "core", question: "h2o", answer: "water" },
    { group: "History", tag: "core", question: "year", answer: "1066" },
    { group: "Biology", tag: "core", question: "   ", answer: "blank side" },
    { group: "Biology", tag: "note", question: "ignore", answer: "ignore" },
  ];

  it("keeps two selected folders from a three-folder fixture, including blank sides", () => {
    const selected = scopeFromChecks(
      toggleCheck(toggleCheck(emptyChecks(), mustFolder("History")), mustFolder("Biology")),
    );
    expect(selected).toEqual({ kind: "folders", folders: ["Biology", "History"] });
    expect(cardsForScope(cards, selected!).map((card) => [card.group, card.question])).toEqual([
      ["Biology", "mito"],
      ["History", "year"],
      ["Biology", "   "],
    ]);
    expect(cardsForSession(cards, launch(selected!), () => true).map((card) => card.question)).toEqual([
      "mito",
      "year",
    ]);
  });

  it("keeps a card stored as __all__ in the all scope and drops blank sides from the session", () => {
    const stored = [
      { group: "__all__", tag: "core", question: "q", answer: "a" },
      { group: "Biology", tag: "core", question: " ", answer: "a" },
      { group: "Biology", tag: "note", question: "n", answer: "n" },
    ];
    expect(cardsForScope(stored, allScope()).map((card) => card.group)).toEqual(["__all__", "Biology"]);
    expect(cardsForSession(stored, launch(allScope()), () => true).map((card) => card.group)).toEqual([
      "__all__",
    ]);
  });

  it("filters a due-only session with the caller callback", () => {
    const dueCards = [
      { group: "Biology", question: "now", answer: "a", due: 1 },
      { group: "Biology", question: "later", answer: "b", due: 50 },
    ];
    const session = cardsForSession(dueCards, launch(oneFolder(mustFolder("Biology")), true), (card) => card.due === 1);
    expect(session.map((card) => card.question)).toEqual(["now"]);
  });
});

describe("session copy", () => {
  it("uses the all-scope subtitles, a due marker, and the empty-session lines", () => {
    expect(scopeLabel(allScope(), false)).toBe("All flashcards");
    expect(scopeLabel(allScope(), true)).toBe("Due for review");
    expect(scopeFolderNames(allScope())).toEqual([]);
    expect(scopeFolderNames(oneFolder(mustFolder("Biology")))).toEqual(["Biology"]);
    expect(scopeDueMarker(false)).toBeNull();
    expect(scopeDueMarker(true)).toBe("Due");
    expect(sessionEmptyMessage(launch(allScope(), true))).toBe("No cards due for review.");
    expect(sessionEmptyMessage(launch(allScope()))).toBe("No flashcards in that group.");
    expect(sessionEmptyMessage(launch(oneFolder(mustFolder("Biology"))))).toBe("No flashcards in that group.");
    const two = scopeFromChecks(toggleCheck(toggleCheck(emptyChecks(), mustFolder("Zoology")), mustFolder("Anatomy")));
    expect(sessionEmptyMessage(launch(two!))).toBe("No flashcards in those folders.");
  });
});
