/* ============================================================
   src/utils/csv.js — Rows → a CSV file a spreadsheet will open

   Two things a naive join(",") gets wrong, both of which have
   consequences beyond a messy file:

     * A value containing a comma, a quote or a newline has to be
       quoted and its quotes doubled. A student's project title
       containing a comma would otherwise shift every column after
       it by one, silently.

     * A value starting with =, +, - or @ is a formula to Excel and
       Google Sheets, not text. A field a user controls is therefore
       a way to run something on the reader's machine, so those
       values are prefixed with a single quote — the standard way
       to tell a spreadsheet "this is text".
============================================================ */

"use strict";

const NEEDS_QUOTING = /[",\r\n]/;
const FORMULA_START = /^[=+\-@\t\r]/;

/** One value as a CSV field. */
function csvCell(value) {
  if (value === null || value === undefined) return "";

  let text = value instanceof Date ? value.toISOString() : String(value);

  if (FORMULA_START.test(text)) text = `'${text}`;
  if (NEEDS_QUOTING.test(text)) text = `"${text.replace(/"/g, '""')}"`;

  return text;
}

/**
 * Build a CSV document.
 *
 * @param {string[]} headers      column headings, in order
 * @param {Array<Array<*>>} rows  one array of values per row
 * @returns {string}              CRLF-delimited, per RFC 4180
 */
function toCsv(headers, rows) {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  return lines.join("\r\n");
}

/**
 * Send a CSV as a download.
 *
 * The BOM is what makes Excel read the file as UTF-8; without it a
 * name with an accent in it arrives mangled.
 */
function sendCsv(res, filename, csv) {
  const safeName = filename.replace(/["\\\r\n]/g, "");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(`\uFEFF${csv}`);
}

module.exports = { csvCell, toCsv, sendCsv };
