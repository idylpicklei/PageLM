declare const folderNameBrand: unique symbol;

export type FolderName = string & { readonly [folderNameBrand]: true };

export type FolderScope = {
  readonly kind: "folders";
  readonly folders: readonly [FolderName, ...FolderName[]];
};

export type StudyScope = { readonly kind: "all" } | FolderScope;

export type StudyLaunch = {
  readonly scope: StudyScope;
  readonly dueOnly: boolean;
};

export type PersonalStudyParse =
  | { readonly status: "ok"; readonly launch: StudyLaunch }
  | { readonly status: "invalid"; readonly message: string };

export type FolderChecks = ReadonlySet<FolderName>;

export type FolderCard = {
  readonly tag?: string | null;
  readonly group?: string | null;
};

export type SessionCard = FolderCard & {
  readonly question?: unknown;
  readonly answer?: unknown;
  readonly due?: number | null;
};

export type StudyQueueCard<T> = Omit<T, "question" | "answer"> & {
  readonly question: string;
  readonly answer: string;
};

const ALL_TOKEN = "__all__";
const NOTES_LABEL = "Notes";

export function folderName(raw: string): FolderName | null {
  if (raw === "" || raw === NOTES_LABEL || raw === ALL_TOKEN) return null;
  return raw as FolderName;
}

export function cardFolderName(card: FolderCard): FolderName | null {
  if (card.tag === "note") return null;
  return folderName(card.group || "Ungrouped");
}

export function folderLabel(card: FolderCard): string {
  if (card.tag === "note") return NOTES_LABEL;
  return card.group || "Ungrouped";
}

export function compareFolderLabels(a: string, b: string): number {
  if (a === "Ungrouped") return b === "Ungrouped" ? 0 : 1;
  if (b === "Ungrouped") return -1;
  if (a === NOTES_LABEL) return b === NOTES_LABEL ? 0 : 1;
  if (b === NOTES_LABEL) return -1;
  return a.localeCompare(b);
}

export function emptyChecks(): FolderChecks {
  return new Set();
}

export function toggleCheck(checks: FolderChecks, folder: FolderName): FolderChecks {
  const next = new Set(checks);
  if (next.has(folder)) next.delete(folder);
  else next.add(folder);
  return next;
}

export function retainChecks(checks: FolderChecks, present: readonly FolderName[]): FolderChecks {
  const keep = new Set(present);
  return new Set([...checks].filter((folder) => keep.has(folder)));
}

export function allScope(): StudyScope {
  return { kind: "all" };
}

export function oneFolder(folder: FolderName): FolderScope {
  return { kind: "folders", folders: [folder] };
}

function folderScope(names: readonly FolderName[]): FolderScope | null {
  const sorted = [...names].sort(compareFolderLabels);
  const first = sorted[0];
  if (first === undefined) return null;
  return { kind: "folders", folders: [first, ...sorted.slice(1)] };
}

export function scopeFromChecks(checks: FolderChecks): FolderScope | null {
  return folderScope([...checks]);
}

export function launch(scope: StudyScope, dueOnly = false): StudyLaunch {
  return { scope, dueOnly };
}

export function studyPath(session: StudyLaunch): string {
  const parts: string[] = [];
  switch (session.scope.kind) {
    case "all":
      parts.push(`group=${encodeURIComponent(ALL_TOKEN)}`);
      break;
    case "folders":
      for (const folder of session.scope.folders) {
        parts.push(`group=${encodeURIComponent(folder)}`);
      }
      break;
    default: {
      const unreachable: never = session.scope;
      return unreachable;
    }
  }
  if (session.dueOnly) parts.push("due=1");
  return `/study?${parts.join("&")}`;
}

function uniqueInOrder(tokens: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const token of tokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    unique.push(token);
  }
  return unique;
}

export function parsePersonalStudy(params: URLSearchParams): PersonalStudyParse {
  // "" is an absent group. A whitespace-only token is a folder name, not all.
  const unique = uniqueInOrder(params.getAll("group").filter((token) => token !== ""));
  const dueOnly = params.get("due") === "1";
  const hasAll = unique.includes(ALL_TOKEN);
  if (hasAll && unique.length > 1) {
    return { status: "invalid", message: "That study link mixes all folders with a named folder." };
  }
  if (hasAll || unique.length === 0) return { status: "ok", launch: launch(allScope(), dueOnly) };
  if (unique.includes(NOTES_LABEL)) {
    return { status: "invalid", message: "Notes are not part of flashcard review." };
  }
  const folders: FolderName[] = [];
  for (const token of unique) {
    const folder = folderName(token);
    if (!folder) return { status: "invalid", message: "That study link has an unusable folder." };
    folders.push(folder);
  }
  const scope = folderScope(folders);
  if (!scope) return { status: "invalid", message: "That study link has an unusable folder." };
  return { status: "ok", launch: launch(scope, dueOnly) };
}

export function cardsForScope<T extends FolderCard>(cards: readonly T[], scope: StudyScope): T[] {
  return cards.filter((card) => {
    if (card.tag === "note") return false;
    switch (scope.kind) {
      case "all":
        return true;
      case "folders": {
        const folder = cardFolderName(card);
        return folder !== null && scope.folders.includes(folder);
      }
      default: {
        const unreachable: never = scope;
        return unreachable;
      }
    }
  });
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

export function cardsForSession<T extends SessionCard>(
  cards: readonly T[],
  session: StudyLaunch,
  isDue: (card: T) => boolean,
): Array<StudyQueueCard<T>> {
  let next = cardsForScope(cards, session.scope).filter(
    (card) => text(card.question).trim() !== "" && text(card.answer).trim() !== "",
  );
  if (session.dueOnly) next = next.filter(isDue);
  return next.map((card) => ({
    ...card,
    question: text(card.question),
    answer: text(card.answer),
  }));
}

export function scopeFolderNames(scope: StudyScope): readonly FolderName[] {
  switch (scope.kind) {
    case "all":
      return [];
    case "folders":
      return scope.folders;
    default: {
      const unreachable: never = scope;
      return unreachable;
    }
  }
}

export function scopeDueMarker(dueOnly: boolean): "Due" | null {
  return dueOnly ? "Due" : null;
}

export function scopeLabel(scope: StudyScope, dueOnly: boolean): string {
  switch (scope.kind) {
    case "all":
      return dueOnly ? "Due for review" : "All flashcards";
    case "folders": {
      const names = scope.folders.join(", ");
      return dueOnly ? `${names} · due` : names;
    }
    default: {
      const unreachable: never = scope;
      return unreachable;
    }
  }
}

export function sessionEmptyMessage(session: StudyLaunch): string {
  if (session.dueOnly) return "No cards due for review.";
  switch (session.scope.kind) {
    case "all":
      return "No flashcards in that group.";
    case "folders":
      return session.scope.folders.length > 1
        ? "No flashcards in those folders."
        : "No flashcards in that group.";
    default: {
      const unreachable: never = session.scope;
      return unreachable;
    }
  }
}
