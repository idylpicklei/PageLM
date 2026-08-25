import db from "../database/scoped-keyv";

export type LibraryFile = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  chatId: string;
  source: "canvas" | "upload";
  created: number;
};

const INDEX_KEY = "library-files";

async function loadAll(): Promise<LibraryFile[]> {
  const rows = (await db.get(INDEX_KEY)) as LibraryFile[] | undefined;
  return Array.isArray(rows) ? rows : [];
}

export async function addLibraryFiles(
  entries: Array<Omit<LibraryFile, "id" | "created">>
): Promise<LibraryFile[]> {
  if (!entries.length) return [];
  const rows = await loadAll();
  const created = Date.now();
  const added = entries.map((entry) => ({
    ...entry,
    id: crypto.randomUUID(),
    created,
  }));
  rows.unshift(...added);
  await db.set(INDEX_KEY, rows.slice(0, 500));
  return added;
}

export async function listLibraryFiles(): Promise<LibraryFile[]> {
  const rows = await loadAll();
  return rows.sort((a, b) => (b.created || 0) - (a.created || 0));
}

export async function deleteLibraryFile(id: string): Promise<boolean> {
  const rows = await loadAll();
  const next = rows.filter((row) => row.id !== id);
  if (next.length === rows.length) return false;
  await db.set(INDEX_KEY, next);
  return true;
}

export async function clearLibraryFiles(): Promise<void> {
  await db.set(INDEX_KEY, []);
}
