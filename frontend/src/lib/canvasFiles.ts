export const CANVAS_FILE_SEARCH_MIN = 2;

export function canvasFileMatchesQuery(
  file: { name: string; contentType: string },
  query: string
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return file.name.toLowerCase().includes(q) || file.contentType.toLowerCase().includes(q);
}

export function canvasServerSearchQuery(query: string): string {
  const q = query.replace(/\s+/g, " ").trim();
  return q.length >= CANVAS_FILE_SEARCH_MIN ? q : "";
}

export function canvasCourseMatchesQuery(
  course: { name: string; code?: string | null },
  query: string
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return course.name.toLowerCase().includes(q) || String(course.code || "").toLowerCase().includes(q);
}
