/* ============================================================
   src/scripts/seedDemo.js — Demo data for exploring the portals

   Drives the running API (not the database directly), so seeding
   exercises the same code paths as real use and can never create
   states the application couldn't. Re-runnable: existing demo
   accounts are detected and left alone.

   Accounts created (password for all: Demo-Pass-1):
     supervisor : efua.boateng@demo.opsts.edu
     students   : kofi.asante@demo.opsts.edu     (2 chapters approved)
                  abena.mensah@demo.opsts.edu    (1 pending review)
                  yaw.darko@demo.opsts.edu       (needs revision)

   Usage:  npm run seed-demo    (API must be running; admin creds
           via ADMIN_EMAIL / ADMIN_PASSWORD or the dev defaults)
============================================================ */

"use strict";

const BASE = process.env.OPSTS_URL || "http://localhost:5000/api";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@opsts.local";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Admin@OPSTS2026";
const DEMO_PASSWORD = "Demo-Pass-1";

const SUPERVISOR = {
  role: "supervisor",
  firstName: "Efua",
  lastName: "Boateng",
  email: "efua.boateng@demo.opsts.edu",
  staffId: "SUP-2026-01",
  department: "Computer Science",
  password: DEMO_PASSWORD,
};

const STUDENTS = [
  {
    role: "student",
    firstName: "Kofi",
    lastName: "Asante",
    email: "kofi.asante@demo.opsts.edu",
    indexNumber: "2426430101",
    department: "Computer Science",
    password: DEMO_PASSWORD,
    title: "AI-Assisted Examination Timetabling System",
    /* chapter → what happens to it */
    chapters: [
      { id: "CH001", decision: "Approved" },
      { id: "CH002", decision: "Approved" },
      { id: "CH003", decision: null }, // left under review
    ],
  },
  {
    role: "student",
    firstName: "Abena",
    lastName: "Mensah",
    email: "abena.mensah@demo.opsts.edu",
    indexNumber: "2426430102",
    department: "Information Technology",
    password: DEMO_PASSWORD,
    title: "Mobile Health Records for Rural Clinics",
    chapters: [{ id: "CH001", decision: null }],
  },
  {
    role: "student",
    firstName: "Yaw",
    lastName: "Darko",
    email: "yaw.darko@demo.opsts.edu",
    indexNumber: "2426430103",
    department: "Cybersecurity",
    password: DEMO_PASSWORD,
    title: "Network Intrusion Detection with Machine Learning",
    chapters: [{ id: "CH001", decision: "Needs Revision" }],
  },
];

const FEEDBACK_TEXT = {
  Approved:
    "Good work — the structure is clear and your argument flows well. " +
    "Approved; please move on to the next chapter.",
  "Needs Revision":
    "The direction is right, but the problem statement needs sharpening and " +
    "your citations must follow the departmental format. Please revise and resubmit.",
};

async function call(method, path, { token, body, form, allow = [] } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const res = await fetch(BASE + path, { method, headers, body: payload });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !allow.includes(res.status)) {
    throw new Error(`${method} ${path} → HTTP ${res.status}: ${data.message || "?"}`);
  }
  return { status: res.status, data };
}

async function login(email, password, role) {
  const { data } = await call("POST", "/auth/login", { body: { email, password, role } });
  return data.token;
}

async function main() {
  console.log(`Seeding demo data via ${BASE}\n`);
  const adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD, "admin");

  /* ── supervisor ─────────────────────────── */
  const reg = await call("POST", "/auth/register", { body: SUPERVISOR, allow: [409] });
  if (reg.status === 409) {
    console.log("Demo data already present (supervisor account exists) — nothing to do.");
    return;
  }

  const { data: pendingData } = await call("GET", "/users?status=pending", { token: adminToken });
  const byEmail = new Map(pendingData.users.map((u) => [u.email, u]));

  const supRow = byEmail.get(SUPERVISOR.email);
  await call("PATCH", `/users/${supRow.id}/approve`, { token: adminToken });
  console.log(`✓ supervisor ${SUPERVISOR.email}`);

  const supToken = await login(SUPERVISOR.email, DEMO_PASSWORD, "supervisor");

  /* ── students, projects, submissions, feedback ── */
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const startDate = iso(new Date(today.getTime() - 30 * 86400000));
  const deadline = iso(new Date(today.getTime() + 120 * 86400000));

  for (const s of STUDENTS) {
    const { chapters, title, ...registration } = s;

    await call("POST", "/auth/register", { body: registration });
    const { data: pend } = await call("GET", "/users?status=pending", { token: adminToken });
    const row = pend.users.find((u) => u.email === s.email);
    await call("PATCH", `/users/${row.id}/approve`, { token: adminToken });

    const { data: assigned } = await call("POST", "/projects/assign-supervisor", {
      token: adminToken,
      body: { studentId: row.id, supervisorId: supRow.id, title },
    });
    await call("PUT", `/projects/${assigned.project.id}`, {
      token: adminToken,
      body: { startDate, deadline, topic: title },
    });

    const studentToken = await login(s.email, DEMO_PASSWORD, "student");

    for (const chapter of chapters) {
      const form = new FormData();
      form.append("chapterId", chapter.id);
      form.append("notes", "Demo submission.");
      form.append(
        "file",
        new Blob([`%PDF-1.4 demo ${s.email} ${chapter.id}\n`], { type: "application/pdf" }),
        `${chapter.id.toLowerCase()}_${s.lastName.toLowerCase()}.pdf`
      );
      const { data: subData } = await call("POST", "/submissions", {
        token: studentToken,
        form,
      });

      if (chapter.decision) {
        await call("POST", "/feedback", {
          token: supToken,
          body: {
            submissionId: subData.submission.id,
            comment: FEEDBACK_TEXT[chapter.decision],
            rating: chapter.decision,
          },
        });
      }
    }

    console.log(`✓ student ${s.email} — ${chapters.length} submission(s)`);
  }

  /* ── a scheduled meeting and a student request ── */
  const { data: allStudents } = await call("GET", `/users/supervisor/${supRow.id}/students`, {
    token: supToken,
  });
  const kofi = allStudents.students.find((x) => x.email === STUDENTS[0].email);

  await call("POST", "/meetings", {
    token: supToken,
    body: {
      title: "Methodology walkthrough",
      date: iso(new Date(today.getTime() + 5 * 86400000)),
      time: "10:00",
      duration: "1 hour",
      platform: "Google Meet",
      link: "https://meet.google.com/demo-opsts-mtg",
      notes: "Bring your chapter 3 draft and data collection plan.",
      studentIds: [kofi.id],
    },
  });

  const kofiToken = await login(STUDENTS[0].email, DEMO_PASSWORD, "student");
  await call("POST", "/meetings/request", {
    token: kofiToken,
    body: {
      topic: "Questions about the results chapter",
      date: iso(new Date(today.getTime() + 9 * 86400000)),
      time: "14:30",
      platform: "Zoom",
      notes: "Mostly about how to present the evaluation metrics.",
    },
  });
  console.log("✓ one scheduled meeting and one student request");

  console.log(`\nDone. All demo accounts use the password: ${DEMO_PASSWORD}`);
}

main().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
