/* =============================================================
   js/data.js  –  Data Store for OPSTS
   All data that would normally come from a backend/database.
   Shared across student.js, supervisor.js, admin.js
============================================================= */

"use strict";

// ─────────────────────────────────────────────
// 1. USERS
// ─────────────────────────────────────────────
const DB_USERS = [];


// ─────────────────────────────────────────────
// 2. PROJECTS
// ─────────────────────────────────────────────
const DB_PROJECTS = [];


// ─────────────────────────────────────────────
// 3. CHAPTERS  (static config — do not remove)
// ─────────────────────────────────────────────
const DB_CHAPTERS = [
  { id: "CH001", label: "Chapter 1", title: "Introduction" },
  { id: "CH002", label: "Chapter 2", title: "Literature Review" },
  { id: "CH003", label: "Chapter 3", title: "Methodology" },
  { id: "CH004", label: "Chapter 4", title: "Implementation & Results" },
  { id: "CH005", label: "Chapter 5", title: "Conclusion & Recommendations" },
];


// ─────────────────────────────────────────────
// 4. SUBMISSIONS
// ─────────────────────────────────────────────
const DB_SUBMISSIONS = [];


// ─────────────────────────────────────────────
// 5. FEEDBACK
// ─────────────────────────────────────────────
const DB_FEEDBACK = [];


// ─────────────────────────────────────────────
// 6. MEETINGS
// ─────────────────────────────────────────────
const DB_MEETINGS = [];


// ─────────────────────────────────────────────
// 7. MILESTONES
// ─────────────────────────────────────────────
const DB_MILESTONES = [];


// ─────────────────────────────────────────────
// 8. NOTIFICATIONS
// ─────────────────────────────────────────────
const DB_NOTIFICATIONS = [];


// ─────────────────────────────────────────────
// 9. DEPARTMENTS  (static config — do not remove)
// ─────────────────────────────────────────────
const DB_DEPARTMENTS = [
  "Computer Science",
  "Information Technology",
  "Computer Engineering",
  "Software Engineering",
  "Cybersecurity",
];


// ─────────────────────────────────────────────
// HELPER LOOKUP FUNCTIONS
// ─────────────────────────────────────────────
const DB = {
  getUserById:             (id)    => DB_USERS.find(u => u.id === id) || null,
  getUserByEmail:          (email) => DB_USERS.find(u => u.email === email.toLowerCase()) || null,
  getProjectById:          (id)    => DB_PROJECTS.find(p => p.id === id) || null,
  getProjectByStudent:     (sid)   => DB_PROJECTS.find(p => p.studentId === sid) || null,
  getSubmissionsByProject: (pid)   => DB_SUBMISSIONS.filter(s => s.projectId === pid),
  getSubmissionsByStudent: (sid)   => DB_SUBMISSIONS.filter(s => s.studentId === sid),
  getFeedbackByProject:    (pid)   => DB_FEEDBACK.filter(f => f.projectId === pid),
  getFeedbackByStudent:    (sid)   => DB_FEEDBACK.filter(f => f.studentId === sid),
  getMilestonesByProject:  (pid)   => DB_MILESTONES.filter(m => m.projectId === pid),
  getMeetingsByUser:       (uid)   => DB_MEETINGS.filter(m =>
                                        m.supervisorId === uid || m.participants.includes(uid)),
  getNotificationsByUser:  (uid)   => DB_NOTIFICATIONS.filter(n => n.userId === uid),
  getUnreadCount:          (uid)   => DB_NOTIFICATIONS.filter(n => n.userId === uid && !n.read).length,
  getStudentsBySupervisor: (sid)   => DB_USERS.filter(u => u.role === "student" && u.supervisorId === sid),
  getChapterById:          (id)    => DB_CHAPTERS.find(c => c.id === id) || null,
};