/* =============================================================
   fix.js — applies the OPSTS frontend wiring fixes in place.

   Run from the Frontend/ directory:

       node fix.js

   Safe to run twice: every edit checks whether it has already
   been made. Does not touch the backend, and does not touch
   css/tailwind.css (run "npm run build" for that).
============================================================= */

"use strict";

const fs = require("fs");
const path = require("path");

let changed = 0;
let skipped = 0;

function edit(file, label, fn) {
  const full = path.join(__dirname, file);
  if (!fs.existsSync(full)) {
    console.log(`  MISSING  ${file}`);
    return;
  }
  const before = fs.readFileSync(full, "utf8");
  const after = fn(before);
  if (after === null) { skipped++; return; }
  if (after === before) { skipped++; return; }
  fs.writeFileSync(full, after, "utf8");
  console.log(`  fixed    ${file}  —  ${label}`);
  changed++;
}

/* Every page under pages/ that drives the portal. The five auth
   pages at the frontend root already load config.js and session.js. */
const PORTAL_PAGES = [
  "pages/Student/dashboard.html",
  "pages/Student/submissions.html",
  "pages/Student/feedback.html",
  "pages/Student/meetings.html",
  "pages/Student/progress.html",
  "pages/Student/notifications.html",
  "pages/Student/profile.html",
  "pages/supervisor/dashboard.html",
  "pages/supervisor/students.html",
  "pages/supervisor/review.html",
  "pages/supervisor/schedule.html",
  "pages/supervisor/progress.html",
  "pages/supervisor/notifications.html",
  "pages/supervisor/profile.html",
  "pages/admin/dashboard.html",
  "pages/admin/users.html",
  "pages/admin/projects.html",
  "pages/admin/assign.html",
  "pages/admin/reports.html",
  "pages/admin/notifications.html",
  "pages/admin/profile.html",
];

console.log("\n1. Script wiring — config.js and session.js\n");

/* api.js opens with `baseUrl: Config.apiBaseUrl`. Without config.js
   that line throws ReferenceError, Api is never defined, and every
   script after it fails too. */
PORTAL_PAGES.forEach(function (page) {
  edit(page, "added config.js + session.js", function (html) {
    if (html.includes("js/config.js")) return null;
    if (!html.includes('<script src="../../js/data.js"></script>')) {
      console.log(`  CHECK    ${page} — no data.js tag found, edit by hand`);
      return null;
    }
    return html.replace(
      '<script src="../../js/data.js"></script>',
      '<script src="../../js/config.js"></script>\n' +
      '<script src="../../js/session.js"></script>\n' +
      '<script src="../../js/data.js"></script>'
    );
  });
});

console.log("\n2. Missing stylesheet links\n");

/* These two pages linked no stylesheet at all. */
["pages/supervisor/dashboard.html", "pages/Student/submissions.html"].forEach(function (page) {
  edit(page, "added stylesheet links", function (html) {
    if (html.includes("css/tailwind.css")) return null;
    return html.replace(
      "</head>",
      '  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" />\n' +
      '  <link rel="stylesheet" href="../../css/tailwind.css" />\n' +
      "</head>"
    );
  });
});

console.log("\n3. Api.upload does not exist\n");

/* Api defines request/get/post/put/patch/delete/download — no upload.
   Api.post already handles FormData correctly: it skips the JSON
   content-type so the browser sets the multipart boundary itself. */
edit("js/student.js", "Api.upload -> Api.post", function (js) {
  if (!js.includes("Api.upload(")) return null;
  return js.replace(/Api\.upload\(/g, "Api.post(");
});

console.log("\n4. completionPercent is derived server-side\n");

/* progressService recalculates it from approved chapters, so sending
   it here is overwritten on the next submission anyway. */
edit("js/admin.js", "dropped completionPercent", function (js) {
  if (!js.includes('completionPercent: 100')) return null;
  return js.replace(
    '{ status: "Completed", completionPercent: 100 }',
    '{ status: "Completed" }'
  );
});

console.log("\n5. Stylesheet import\n");

edit("src/input.css", "added compat.css import", function (css) {
  if (css.includes("compat.css")) return null;
  if (!css.includes('@import "./auth.css";')) {
    console.log("  CHECK    src/input.css — no auth.css import found, add by hand");
    return null;
  }
  return css.replace(
    '@import "./auth.css";',
    '@import "./auth.css";\n@import "./compat.css";'
  );
});

edit("src/input.css", "added content.css import", function (css) {
  if (css.includes("content.css")) return null;
  if (!css.includes('@import "./compat.css";')) return null;
  return css.replace(
    '@import "./compat.css";',
    '@import "./compat.css";\n@import "./content.css";'
  );
});

console.log("\n─────────────────────────────────");
console.log(`${changed} file(s) changed, ${skipped} already correct.`);

const need = ["src/compat.css", "src/content.css"].filter(
  (f) => !fs.existsSync(path.join(__dirname, f))
);
if (need.length) {
  console.log("\nMISSING: " + need.join(", "));
  console.log("Download and save before building.");
} else {
  console.log("\nNext:  npm run build");
}
console.log("");
