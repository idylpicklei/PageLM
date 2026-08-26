import { describe, expect, it } from "vitest";
import { canvasCourseMatchesQuery, canvasFileMatchesQuery, canvasServerSearchQuery } from "./canvasFiles";

describe("canvasFileMatchesQuery", () => {
  const syllabus = { name: "Week 1 Syllabus.pdf", contentType: "application/pdf" };

  it("matches file names case-insensitively", () => {
    expect(canvasFileMatchesQuery(syllabus, "syllabus")).toBe(true);
    expect(canvasFileMatchesQuery(syllabus, "WEEK")).toBe(true);
    expect(canvasFileMatchesQuery(syllabus, "quiz")).toBe(false);
  });

  it("matches content types", () => {
    expect(canvasFileMatchesQuery(syllabus, "pdf")).toBe(true);
    expect(canvasFileMatchesQuery(syllabus, "word")).toBe(false);
  });

  it("treats blank queries as a match", () => {
    expect(canvasFileMatchesQuery(syllabus, "   ")).toBe(true);
  });
});

describe("canvasServerSearchQuery", () => {
  it("only forwards terms long enough for Canvas search_term", () => {
    expect(canvasServerSearchQuery("s")).toBe("");
    expect(canvasServerSearchQuery("  sy ")).toBe("sy");
    expect(canvasServerSearchQuery("lecture   notes")).toBe("lecture notes");
  });
});

describe("canvasCourseMatchesQuery", () => {
  const course = { name: "Intro to Biology", code: "BIO-101" };

  it("matches course names and codes", () => {
    expect(canvasCourseMatchesQuery(course, "biology")).toBe(true);
    expect(canvasCourseMatchesQuery(course, "bio-101")).toBe(true);
    expect(canvasCourseMatchesQuery(course, "chem")).toBe(false);
  });
});
