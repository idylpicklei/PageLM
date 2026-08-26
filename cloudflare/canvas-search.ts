export const CANVAS_MIN_SEARCH_TERM = 2;
export const CANVAS_MAX_SEARCH_TERM = 200;

export function sanitizeCanvasSearchTerm(raw: unknown): string | null {
  const term = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (term.length < CANVAS_MIN_SEARCH_TERM) return null;
  return term.slice(0, CANVAS_MAX_SEARCH_TERM);
}

export function courseFilesApiPath(courseId: string, searchTerm?: string | null): string {
  const params = new URLSearchParams({
    per_page: "50",
    sort: "updated_at",
    order: "desc",
  });
  if (searchTerm) params.set("search_term", searchTerm);
  return `/api/v1/courses/${encodeURIComponent(courseId)}/files?${params.toString()}`;
}

export function canvasSearchFromRequest(url: string): string | null {
  const parsed = new URL(url);
  return sanitizeCanvasSearchTerm(parsed.searchParams.get("q") ?? parsed.searchParams.get("search"));
}
