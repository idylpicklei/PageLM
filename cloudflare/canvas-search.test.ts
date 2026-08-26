import { describe, expect, it } from "vitest";
import {
  CANVAS_MAX_SEARCH_TERM,
  canvasSearchFromRequest,
  courseFilesApiPath,
  sanitizeCanvasSearchTerm,
} from "./canvas-search";

describe("sanitizeCanvasSearchTerm", () => {
  it("returns null for empty or short terms", () => {
    expect(sanitizeCanvasSearchTerm("")).toBeNull();
    expect(sanitizeCanvasSearchTerm(" ")).toBeNull();
    expect(sanitizeCanvasSearchTerm("a")).toBeNull();
    expect(sanitizeCanvasSearchTerm(null)).toBeNull();
  });

  it("trims and collapses whitespace", () => {
    expect(sanitizeCanvasSearchTerm("  lecture   3  ")).toBe("lecture 3");
  });

  it("keeps terms of two or more characters", () => {
    expect(sanitizeCanvasSearchTerm("sy")).toBe("sy");
    expect(sanitizeCanvasSearchTerm("syllabus")).toBe("syllabus");
  });

  it("caps very long search terms", () => {
    const term = "x".repeat(CANVAS_MAX_SEARCH_TERM + 40);
    expect(sanitizeCanvasSearchTerm(term)?.length).toBe(CANVAS_MAX_SEARCH_TERM);
  });
});

describe("courseFilesApiPath", () => {
  it("lists recent files when there is no search term", () => {
    expect(courseFilesApiPath("42")).toBe(
      "/api/v1/courses/42/files?per_page=50&sort=updated_at&order=desc"
    );
  });

  it("adds Canvas search_term when provided", () => {
    expect(courseFilesApiPath("42", "lecture 3")).toBe(
      "/api/v1/courses/42/files?per_page=50&sort=updated_at&order=desc&search_term=lecture+3"
    );
  });
});

describe("canvasSearchFromRequest", () => {
  it("reads q from the incoming request", () => {
    expect(canvasSearchFromRequest("https://app.example/api/canvas/courses/9/files?q=syllabus")).toBe(
      "syllabus"
    );
  });

  it("accepts search as an alias and ignores one-character queries", () => {
    expect(canvasSearchFromRequest("https://app.example/api/canvas/courses/9/files?search=midterm")).toBe(
      "midterm"
    );
    expect(canvasSearchFromRequest("https://app.example/api/canvas/courses/9/files?q=s")).toBeNull();
  });
});
