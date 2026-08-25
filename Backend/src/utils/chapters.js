/* ============================================================
   src/utils/chapters.js — The five project chapters

   Static reference data, deliberately not a table: the chapter
   list is fixed by the department's project handbook and the
   frontend ships the same list in js/data.js (DB_CHAPTERS).
   Keep the two in sync if the handbook ever changes.

   Completion percentage is derived from how many of these five
   are approved, so the count matters to more than just labels.
============================================================ */

"use strict";

const CHAPTERS = Object.freeze([
  Object.freeze({ id: "CH001", label: "Chapter 1", title: "Introduction" }),
  Object.freeze({ id: "CH002", label: "Chapter 2", title: "Literature Review" }),
  Object.freeze({ id: "CH003", label: "Chapter 3", title: "Methodology" }),
  Object.freeze({ id: "CH004", label: "Chapter 4", title: "Implementation & Results" }),
  Object.freeze({ id: "CH005", label: "Chapter 5", title: "Conclusion & Recommendations" }),
]);

const CHAPTER_IDS = Object.freeze(CHAPTERS.map((c) => c.id));

const byId = new Map(CHAPTERS.map((c) => [c.id, c]));

/** @returns {{id: string, label: string, title: string}|null} */
function getChapter(id) {
  return byId.get(id) || null;
}

function isValidChapterId(id) {
  return byId.has(id);
}

/** "Chapter 3 – Methodology", used for feedback labels and milestones. */
function chapterLabel(id) {
  const chapter = byId.get(id);
  return chapter ? `${chapter.label} – ${chapter.title}` : id;
}

module.exports = {
  CHAPTERS,
  CHAPTER_IDS,
  TOTAL_CHAPTERS: CHAPTERS.length,
  getChapter,
  isValidChapterId,
  chapterLabel,
};
