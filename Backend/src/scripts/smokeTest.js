/* ============================================================
   src/scripts/smokeTest.js — End-to-end workflow test

   Drives the running API through the same journey the frontend
   takes: register → approve → assign → submit → review → track →
   meet → notify → report. Exits non-zero on the first failure.

   Usage:  npm run smoke            (API must be running)
           OPSTS_URL=... ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run smoke
============================================================ */

"use strict";

const BASE = process.env.OPSTS_URL || "http://localhost:5000/api";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@opsts.local";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Admin@OPSTS2026";

/* Unique per run so the script can be re-run without cleanup. */
const RUN = Date.now().toString(36);
const student = {
  email: `student.${RUN}@test.opsts.edu`,
  password: "Student-Pass-1",
  firstName: "Kofi",
  lastName: "Asante",
  indexNumber: `24${RUN}`.slice(0, 12),
  /* Registered by the student, and expected to arrive as the title of
     the project shell without an administrator typing it again. */
  projectTopic: "Predicting exam outcomes from attendance records",
};

/* A second student on the same supervisor, so "schedule one meeting
   with everyone I supervise" has more than one person to reach. */
const student2 = {
  email: `student2.${RUN}@test.opsts.edu`,
  password: "Student-Pass-1",
  firstName: "Ama",
  lastName: "Mensah",
  indexNumber: `25${RUN}`.slice(0, 12),
  projectTopic: "A mobile triage assistant for rural clinics",
};
const supervisor = {
  email: `supervisor.${RUN}@test.opsts.edu`,
  password: "Super-Pass-1",
  firstName: "Efua",
  lastName: "Boateng",
  staffId: `ST${RUN}`.slice(0, 10),
};

let passed = 0;

function ok(label, condition, extra) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    console.error(`  ✗ ${label}${extra ? ` — ${JSON.stringify(extra).slice(0, 300)}` : ""}`);
    process.exit(1);
  }
}

async function call(method, path, { token, body, form, expect = 200 } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const res = await fetch(BASE + path, { method, headers, body: payload });
  const isJson = (res.headers.get("content-type") || "").includes("json");
  const data = isJson ? await res.json() : await res.arrayBuffer();

  if (res.status !== expect) {
    console.error(`  ✗ ${method} ${path} → HTTP ${res.status} (expected ${expect})`);
    console.error("   ", isJson ? JSON.stringify(data).slice(0, 400) : "(binary)");
    process.exit(1);
  }
  return { status: res.status, data };
}

/**
 * Like `call`, but for a response that is not JSON. Returns the body
 * as text plus the two headers a download is judged by, so a CSV can
 * be checked without pretending it parses as JSON.
 */
async function callRaw(method, path, { token, expect = 200 } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(BASE + path, { method, headers });
  /* Read as bytes, not res.text(): the WHATWG decode that text()
     performs strips a leading BOM, which is exactly the byte a CSV
     download has to be checked for. */
  const bytes = Buffer.from(await res.arrayBuffer());
  const text = bytes.toString("utf8");

  if (res.status !== expect) {
    console.error(`  ✗ ${method} ${path} → HTTP ${res.status} (expected ${expect})`);
    console.error("   ", text.slice(0, 400));
    process.exit(1);
  }

  return {
    status: res.status,
    bytes,
    text,
    contentType: res.headers.get("content-type") || "",
    disposition: res.headers.get("content-disposition") || "",
  };
}

async function main() {
  console.log(`Smoke test against ${BASE}\n`);

  /* ── health ─────────────────────────────── */
  console.log("Health & reference data");
  const health = await call("GET", "/health");
  ok("health reports ok", health.data.status === "ok");
  const chapters = await call("GET", "/chapters");
  ok("five chapters defined", chapters.data.total === 5);

  /* ── auth: register & approval gate ─────── */
  console.log("\nAuthentication & access control");
  const reg1 = await call("POST", "/auth/register", {
    body: { role: "student", department: "Computer Science", ...student },
    expect: 201,
  });
  ok("student registered as pending", reg1.data.user.status === "pending");

  await call("POST", "/auth/register", {
    body: { role: "student", department: "Computer Science", ...student2 },
    expect: 201,
  });
  ok("second student registered", true);

  await call("POST", "/auth/register", {
    body: { role: "supervisor", department: "Computer Science", ...supervisor },
    expect: 201,
  });
  ok("supervisor registered", true);

  await call("POST", "/auth/register", {
    body: {
      role: "student",
      department: "Computer Science",
      email: `no.topic.${RUN}@test.opsts.edu`,
      password: "Student-Pass-1",
      firstName: "Yaw",
      lastName: "Owusu",
      indexNumber: `26${RUN}`.slice(0, 12),
    },
    expect: 400,
  });
  ok("a student cannot register without a project topic", true);

  await call("POST", "/auth/login", {
    body: { email: student.email, password: student.password, role: "student" },
    expect: 403,
  });
  ok("pending student cannot sign in", true);

  await call("POST", "/auth/login", {
    body: { email: student.email, password: "wrong-password-1", role: "student" },
    expect: 401,
  });
  ok("wrong password rejected", true);

  const adminLogin = await call("POST", "/auth/login", {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, role: "admin" },
  });
  const adminToken = adminLogin.data.token;
  ok("admin signed in", Boolean(adminToken));
  ok(
    "session reports whether the password is still an initial one",
    typeof adminLogin.data.user.mustChangePassword === "boolean"
  );

  await call("GET", "/users", { expect: 401 });
  ok("user list requires a token", true);

  /* ── admin: approve both accounts ───────── */
  console.log("\nAdmin: user management");
  const pending = await call("GET", "/users?status=pending", { token: adminToken });
  const studentRow = pending.data.users.find((u) => u.email === student.email);
  const student2Row = pending.data.users.find((u) => u.email === student2.email);
  const supervisorRow = pending.data.users.find((u) => u.email === supervisor.email);
  ok(
    "pending list shows all three registrations",
    Boolean(studentRow && student2Row && supervisorRow)
  );
  ok(
    "the approval queue shows the topic the student registered",
    studentRow.projectTopic === student.projectTopic,
    studentRow
  );

  await call("PATCH", `/users/${studentRow.id}/approve`, { token: adminToken });
  await call("PATCH", `/users/${student2Row.id}/approve`, { token: adminToken });
  await call("PATCH", `/users/${supervisorRow.id}/approve`, { token: adminToken });
  ok("all three accounts approved", true);

  const studentLogin = await call("POST", "/auth/login", {
    body: { email: student.email, password: student.password, role: "student" },
  });
  const studentToken = studentLogin.data.token;
  ok("approved student can sign in", Boolean(studentToken));

  const freshProject = await call("GET", "/projects", { token: studentToken });
  ok(
    "the registered topic became the project, with no admin assignment",
    freshProject.data.projects.length === 1 &&
      freshProject.data.projects[0].title === student.projectTopic &&
      freshProject.data.projects[0].topic === student.projectTopic,
    freshProject.data.projects[0]
  );

  const supLogin = await call("POST", "/auth/login", {
    body: { email: supervisor.email, password: supervisor.password, role: "supervisor" },
  });
  const supToken = supLogin.data.token;
  ok("approved supervisor can sign in", Boolean(supToken));

  await call("GET", "/users", { token: studentToken, expect: 403 });
  ok("student cannot list users (RBAC)", true);

  /* ── assign supervisor ──────────────────── */
  console.log("\nProject management");
  const assign = await call("POST", "/projects/assign-supervisor", {
    token: adminToken,
    body: {
      studentId: studentRow.id,
      supervisorId: supervisorRow.id,
      title: "AI-Assisted Timetabling System",
    },
  });
  const projectId = assign.data.project.id;
  ok("supervisor assigned to student project", assign.data.project.supervisorId === supervisorRow.id);

  await call("POST", "/projects/assign-supervisor", {
    token: adminToken,
    body: { studentId: student2Row.id, supervisorId: supervisorRow.id },
  });
  ok("second student assigned to the same supervisor", true);

  const deadline = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  await call("PUT", `/projects/${projectId}`, {
    token: adminToken,
    body: { startDate: today, deadline },
  });
  ok("project dates set", true);

  const stuProjects = await call("GET", "/projects", { token: studentToken });
  ok(
    "student sees their own project with supervisor details",
    stuProjects.data.projects.length === 1 &&
      stuProjects.data.projects[0].supervisorName === "Efua Boateng"
  );

  const milestones = await call("GET", `/projects/milestones/${projectId}`, {
    token: studentToken,
  });
  ok(
    "five milestones seeded with scheduled due dates",
    milestones.data.milestones.length === 5 &&
      milestones.data.milestones.every((m) => m.due_date)
  );

  /* ── submission upload ──────────────────── */
  console.log("\nDocument submission");
  const fileBody = `%PDF-1.4 smoke-test chapter one ${RUN}\n`;
  const form = new FormData();
  form.append("chapterId", "CH001");
  form.append("notes", "First draft of my introduction.");
  form.append(
    "file",
    new Blob([fileBody], { type: "application/pdf" }),
    "chapter1_introduction.pdf"
  );
  const sub1 = await call("POST", "/submissions", {
    token: studentToken,
    form,
    expect: 201,
  });
  const submissionId = sub1.data.submission.id;
  ok("chapter 1 uploaded as v1", sub1.data.submission.version === 1);

  const badForm = new FormData();
  badForm.append("chapterId", "CH001");
  badForm.append("file", new Blob(["#!/bin/sh"], { type: "application/x-sh" }), "evil.sh");
  await call("POST", "/submissions", { token: studentToken, form: badForm, expect: 400 });
  ok("executable upload rejected", true);

  const download = await call("GET", `/submissions/${submissionId}/download`, {
    token: studentToken,
  });
  ok(
    "student can download their file back, byte-identical",
    Buffer.from(download.data).toString() === fileBody
  );

  const supSubs = await call("GET", "/submissions?status=Under%20Review", { token: supToken });
  ok(
    "supervisor sees the submission in their review queue",
    supSubs.data.submissions.some((s) => s.id === submissionId)
  );

  /* ── feedback & progress ────────────────── */
  console.log("\nFeedback, review & progress tracking");
  await call("POST", "/feedback", {
    token: supToken,
    body: {
      submissionId,
      comment: "Well structured. Approved — proceed to the literature review.",
      rating: "Approved",
    },
    expect: 201,
  });
  ok("supervisor approved the submission", true);

  const afterApproval = await call("GET", "/projects", { token: studentToken });
  ok(
    "completion moved to 20% (1 of 5 chapters approved)",
    afterApproval.data.projects[0].completionPercent === 20,
    afterApproval.data.projects[0]
  );
  ok(
    "project status moved to In Progress",
    afterApproval.data.projects[0].status === "In Progress"
  );

  const msAfter = await call("GET", `/projects/milestones/${projectId}`, { token: studentToken });
  ok(
    "chapter 1 milestone marked Completed",
    msAfter.data.milestones.find((m) => m.chapterId === "CH001").status === "Completed"
  );

  /* Requirement: an approved chapter takes no further submissions. */
  const closedForm = new FormData();
  closedForm.append("chapterId", "CH001");
  closedForm.append(
    "file",
    new Blob([`%PDF-1.4 second attempt ${RUN}\n`], { type: "application/pdf" }),
    "chapter1_again.pdf"
  );
  await call("POST", "/submissions", { token: studentToken, form: closedForm, expect: 409 });
  ok("an approved chapter refuses another submission", true);

  await call("POST", `/submissions/${submissionId}/reopen`, {
    token: studentToken,
    body: {},
    expect: 403,
  });
  ok("a student cannot reopen their own approved chapter", true);

  const reopened = await call("POST", `/submissions/${submissionId}/reopen`, {
    token: supToken,
    body: { reason: "Please expand section 1.3." },
  });
  ok("supervisor reopened the chapter", Boolean(reopened.data.submission.reopenedAt));

  await call("POST", `/submissions/${submissionId}/reopen`, {
    token: supToken,
    body: {},
    expect: 409,
  });
  ok("reopening an already-open chapter is refused", true);

  const revisionForm = new FormData();
  revisionForm.append("chapterId", "CH001");
  revisionForm.append(
    "file",
    new Blob([`%PDF-1.4 revised ${RUN}\n`], { type: "application/pdf" }),
    "chapter1_v2.pdf"
  );
  const sub2 = await call("POST", "/submissions", {
    token: studentToken,
    form: revisionForm,
    expect: 201,
  });
  ok("the reopened chapter accepts v2", sub2.data.submission.version === 2);

  const afterRevision = await call("GET", "/projects", { token: studentToken });
  ok(
    "completion drops back to 0% while the revision is under review",
    afterRevision.data.projects[0].completionPercent === 0,
    afterRevision.data.projects[0]
  );

  await call("POST", "/feedback", {
    token: supToken,
    body: {
      submissionId: sub2.data.submission.id,
      comment: "Section 1.3 is much clearer now. Approved.",
      rating: "Approved",
    },
    expect: 201,
  });

  const thirdForm = new FormData();
  thirdForm.append("chapterId", "CH001");
  thirdForm.append(
    "file",
    new Blob([`%PDF-1.4 third attempt ${RUN}\n`], { type: "application/pdf" }),
    "chapter1_v3.pdf"
  );
  await call("POST", "/submissions", { token: studentToken, form: thirdForm, expect: 409 });
  ok("approving the revision closes the chapter again", true);

  const stuFeedback = await call("GET", "/feedback", { token: studentToken });
  ok(
    "student sees both pieces of feedback with the supervisor name",
    stuFeedback.data.feedback.length === 2 &&
      stuFeedback.data.feedback[0].supervisorName === "Efua Boateng"
  );

  /* ── meetings ───────────────────────────── */
  console.log("\nMeeting management");
  const meetDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  await call("POST", "/meetings/request", {
    token: studentToken,
    body: {
      topic: "Discuss literature review scope",
      date: meetDate,
      time: "10:30",
      platform: "Zoom",
    },
    expect: 201,
  });
  ok("student requested a meeting", true);

  const scheduled = await call("POST", "/meetings", {
    token: supToken,
    body: {
      title: "Chapter 2 planning",
      date: meetDate,
      time: "14:00",
      duration: "1 hour",
      platform: "Google Meet",
      link: "https://meet.google.com/abc-defg-hij",
      studentIds: [studentRow.id],
    },
    expect: 201,
  });
  ok("supervisor scheduled a meeting with a link", Boolean(scheduled.data.meeting.link));

  /* Requirement: one meeting for every student a supervisor has, not
     one meeting each. The API takes a list, so "all" is the same
     call with more ids. */
  const cohort = await call("POST", "/meetings", {
    token: supToken,
    body: {
      title: "Cohort progress check-in",
      date: meetDate,
      time: "16:00",
      duration: "1 hour",
      platform: "Google Meet",
      link: "https://meet.google.com/all-cohort-abc",
      studentIds: [studentRow.id, student2Row.id],
    },
    expect: 201,
  });
  ok(
    "one meeting can invite every supervised student at once",
    cohort.data.meeting.participants.length === 2,
    cohort.data.meeting.participants
  );
  ok(
    "the confirmation counts everyone it reached",
    /All 2 students have been notified/.test(cohort.data.message),
    cohort.data.message
  );

  const supStudents = await call("GET", `/users/supervisor/${supervisorRow.id}/students`, {
    token: supToken,
  });
  ok(
    "the supervisor's student list is what an \"all students\" choice expands to",
    supStudents.data.students.length === 2,
    supStudents.data.students.map((x) => x.name)
  );

  const stuMeetings = await call("GET", "/meetings", { token: studentToken });
  ok(
    "student sees their request, their meeting and the cohort meeting",
    stuMeetings.data.meetings.length === 3,
    stuMeetings.data.meetings.map((m) => m.title)
  );

  /* ── notifications ──────────────────────── */
  console.log("\nNotifications");
  const stuNotifs = await call("GET", "/notifications", { token: studentToken });
  const types = stuNotifs.data.notifications.map((n) => n.type);
  ok(
    "student was notified of approval, feedback/approval and meeting",
    types.includes("approval") && types.includes("meeting"),
    types
  );

  const unread = await call("GET", "/notifications/unread-count", { token: studentToken });
  ok("unread count is positive", unread.data.count > 0);

  const firstNotif = stuNotifs.data.notifications[0];
  await call("PATCH", `/notifications/${firstNotif.id}/read`, { token: studentToken });
  await call("PATCH", "/notifications/read-all", { token: studentToken });
  const unreadAfter = await call("GET", "/notifications/unread-count", { token: studentToken });
  ok("read-all clears the badge", unreadAfter.data.count === 0);

  const supNotifs = await call("GET", "/notifications", { token: supToken });
  ok(
    "supervisor was notified of assignment, submission and meeting request",
    supNotifs.data.notifications.some((n) => n.type === "submission") &&
      supNotifs.data.notifications.some((n) => n.type === "meeting")
  );

  /* ── reports ────────────────────────────── */
  console.log("\nReporting");
  const summary = await call("GET", "/reports/summary", { token: adminToken });
  ok(
    "summary counts students, supervisors and submissions",
    summary.data.summary.totalStudents >= 1 && summary.data.summary.totalSubmissions >= 1
  );

  const workload = await call("GET", "/reports/workload", { token: adminToken });
  const supWorkload = workload.data.report.find((w) => w.id === supervisorRow.id);
  ok(
    "workload report shows the supervisor with both students and both reviews",
    supWorkload && supWorkload.studentsAssigned === 2 && supWorkload.feedbackGiven === 2,
    supWorkload
  );

  const completion = await call("GET", "/reports/completion", { token: adminToken });
  ok("completion report covers all three statuses", completion.data.report.length === 3);

  await call("GET", "/reports/summary", { token: studentToken, expect: 403 });
  ok("reports are admin-only", true);

  /* Requirement: the reports page can be downloaded, not just read. */
  /* The exact filename, not a loose pattern: a sanitiser that ate a
     character would still satisfy "looks roughly like a csv name". */
  const stamp = new Date().toISOString().slice(0, 10);
  const EXPECTED_FILENAMES = {
    summary: "system-summary",
    completion: "completion",
    projects: "project-progress",
    workload: "supervisor-workload",
    deadlines: "deadlines",
  };

  for (const [type, label] of Object.entries(EXPECTED_FILENAMES)) {
    const csv = await callRaw("GET", `/reports/export/${type}`, { token: adminToken });
    ok(
      `${type} report downloads as ${label}.csv`,
      csv.contentType.includes("text/csv") &&
        csv.disposition === `attachment; filename="opsts-${label}-${stamp}.csv"`,
      { contentType: csv.contentType, disposition: csv.disposition }
    );
  }

  const projectsCsv = await callRaw("GET", "/reports/export/projects", { token: adminToken });
  const csvLines = projectsCsv.text.split("\r\n");
  ok(
    "the projects CSV opens with a BOM and a header row",
    /* The BOM is what makes Excel read the file as UTF-8. */
    csvLines[0].startsWith("\uFEFFStudent,Index number,Project title"),
    csvLines[0].slice(0, 120)
  );
  ok(
    "the projects CSV contains a row for the test student",
    csvLines.some(
      (line) =>
        line.startsWith(`${student.firstName} ${student.lastName},`) &&
        line.includes("AI-Assisted Timetabling System")
    ),
    csvLines.filter((line) => line.startsWith(student.firstName)).slice(0, 3)
  );

  await call("GET", "/reports/export/nonsense", { token: adminToken, expect: 400 });
  ok("an unknown report name is refused", true);

  await callRaw("GET", "/reports/export/projects", { token: supToken, expect: 403 });
  ok("report downloads are admin-only too", true);

  /* ── password change invalidates old token ─ */
  console.log("\nSession security");

  /* A freshly registered account chose its own password, so it must not
     be nagged to change it — this is what keeps the prompt meaningful. */
  const studentMe = await call("GET", "/auth/me", { token: studentToken });
  ok(
    "self-registered account is not flagged must-change-password",
    studentMe.data.user.mustChangePassword === false,
    studentMe.data.user
  );

  const change = await call("POST", "/auth/change-password", {
    token: studentToken,
    body: { currentPassword: student.password, newPassword: "Student-Pass-2" },
  });
  ok("password changed and a fresh token issued", Boolean(change.data.token));
  await call("GET", "/projects", { token: studentToken, expect: 401 });
  ok("old token rejected after password change", true);
  await call("GET", "/projects", { token: change.data.token });
  ok("new token works", true);

  /* ── cleanup ────────────────────────────── */
  console.log("\nCleanup");
  await call("DELETE", `/users/${studentRow.id}`, { token: adminToken });
  await call("DELETE", `/users/${student2Row.id}`, { token: adminToken });
  await call("DELETE", `/users/${supervisorRow.id}`, { token: adminToken });
  ok("test accounts removed (cascade cleans project, files, feedback)", true);

  console.log(`\nAll ${passed} checks passed.`);
}

main().catch((err) => {
  console.error("\nSmoke test failed:", err.message);
  process.exit(1);
});
