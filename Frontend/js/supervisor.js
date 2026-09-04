/* ============================================================
   js/supervisor.js — Supervisor Portal Logic
   OPSTS – Online Project Supervision & Tracking System
   Now backed by the real API instead of mock arrays.
   Handles: dashboard, students, review, progress,
            schedule, notifications, profile
============================================================ */

"use strict";

/* ══════════════════════════════════════
   HELPERS
══════════════════════════════════════ */
function avatarColor(initials) {
  /* Delegates to Utils so every portal colours a given set of
     initials identically (see Utils.AVATAR_PALETTE). */
  return Utils.avatarColor(initials);
}

function badge(status) {
  var map = {
    "Approved":       { cls: "badge-success",   icon: '<i class="fa-solid fa-circle-check"></i>' },
    "Completed":      { cls: "badge-success",   icon: '<i class="fa-solid fa-circle-check"></i>' },
    "In Progress":    { cls: "badge-primary",   icon: '<i class="fa-solid fa-arrows-rotate"></i>' },
    "Under Review":   { cls: "badge-warning",   icon: '<i class="fa-solid fa-eye"></i>' },
    "Needs Revision": { cls: "badge-danger",    icon: '<i class="fa-solid fa-pen"></i>' },
    "Pending":        { cls: "badge-secondary", icon: '<i class="fa-solid fa-hourglass-half"></i>' },
    "Rejected":       { cls: "badge-danger",    icon: '<i class="fa-solid fa-circle-xmark"></i>' },
    "Upcoming":       { cls: "badge-primary",   icon: '<i class="fa-solid fa-calendar-days"></i>' },
  };
  var b = map[status] || { cls: "badge-secondary", icon: "•" };
  return '<span class="badge ' + b.cls + '">' + b.icon + " " + status + "</span>";
}

function currentPage() {
  var parts = window.location.pathname.split("/");
  return parts[parts.length - 1];
}

function apiErrorToast(err, fallback) {
  showToast((err && err.message) || fallback || "Something went wrong. Please try again.", "error", 4500);
}

async function downloadFile(url, filename) {
  try {
    var token = Utils.getToken();
    var res = await fetch(url, { headers: token ? { Authorization: "Bearer " + token } : {} });
    if (!res.ok) throw new Error("Download failed.");
    var blob = await res.blob();
    var link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename || "download";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  } catch (err) {
    showToast("Could not download the file.", "error");
  }
}

/* ══════════════════════════════════════
   SIDEBAR "Review" BADGE
══════════════════════════════════════ */
async function updateReviewBadge() {
  var badgeEl = document.getElementById("reviewBadge");
  if (!badgeEl) return;
  try {
    var res = await Api.get("/submissions?status=" + encodeURIComponent("Under Review"));
    var pending = (res.submissions || []).length;
    if (pending > 0) { badgeEl.textContent = pending; badgeEl.classList.remove("hidden"); }
    else badgeEl.classList.add("hidden");
  } catch (err) { /* non-fatal */ }
}

/* ══════════════════════════════════════
   DASHBOARD PAGE
══════════════════════════════════════ */
async function initDashboard(user) {
  var el = function (id) { return document.getElementById(id); };
  var sub = el("topbarSub");
  if (sub) sub.textContent = "Welcome back, " + user.name.split(" ")[0] + "!";

  var projects = [], submissions = [], meetings = [];

  try {
    var results = await Promise.all([
      Api.get("/projects"),
      Api.get("/submissions"),
      Api.get("/meetings"),
    ]);
    projects    = results[0].projects    || [];
    submissions = results[1].submissions || [];
    meetings    = results[2].meetings    || [];
  } catch (err) {
    apiErrorToast(err, "Could not load dashboard data.");
  }

  var pending  = submissions.filter(function (s) { return s.status === "Under Review"; });
  var approved = submissions.filter(function (s) { return s.status === "Approved"; });
  var upcoming = meetings.filter(function (m) { return m.status === "Upcoming"; });

  el("statStudents").textContent = projects.length;
  el("statPending").textContent  = pending.length;
  el("statApproved").textContent = approved.length;
  el("statMeetings").textContent = upcoming.length;

  var studentNameById = {};
  projects.forEach(function (p) { studentNameById[p.studentId] = p.studentName; });

  var pendingEl = el("pendingReviewsList");
  if (pendingEl) {
    pendingEl.innerHTML = pending.length === 0
      ? '<div class="empty-state"><i class="fa-solid fa-circle-check"></i><p>No pending reviews. All caught up!</p></div>'
      : pending.map(function (s) {
          var ch   = DB.getChapterById(s.chapterId);
          var name = studentNameById[s.studentId] || "Student";
          return '<div class="pending-strip">' +
            "<div><strong>" + name + "</strong> submitted " + (ch ? ch.label + " – " + ch.title : s.chapterId) +
            "<br><small>" + Utils.formatDateTime(s.submittedAt) + "</small></div>" +
            '<a href="review.html" class="btn btn-outline btn-sm">Review <i class="fa-solid fa-arrow-right"></i></a>' +
            "</div>";
        }).join("");
  }

  var meetEl = el("upcomingMeetingsList");
  if (meetEl) {
    meetEl.innerHTML = upcoming.length === 0
      ? '<div class="empty-state"><i class="fa-solid fa-calendar-days"></i><p>No upcoming meetings.</p></div>'
      : upcoming.slice(0, 2).map(function (m) {
          var d = new Date(m.date);
          var day = d.getDate();
          var mon = d.toLocaleString("en-GB", { month: "short" }).toUpperCase();
          var esc = Utils.escapeHtml;
          return '<div class="meeting-card">' +
            '<div class="meeting-date-box"><div class="mday">' + day + '</div><div class="mmon">' + mon + "</div></div>" +
            '<div class="meeting-info"><h4>' + esc(m.title) + "</h4>" +
            '<div class="meeting-meta"><span><i class="fa-solid fa-clock"></i> ' + esc(m.time) + '</span><span><i class="fa-solid fa-stopwatch"></i> ' + esc(m.duration) + "</span></div>" +
            '<div class="meeting-meta"><span><i class="fa-solid fa-video"></i> ' + esc(m.platform) + "</span></div>" +
            Utils.meetingJoin(m, false) +
            "</div></div>";
        }).join("");
  }

  var stuEl = el("studentQuickList");
  if (stuEl) {
    stuEl.innerHTML = projects.length === 0
      ? '<div class="empty-state"><i class="fa-solid fa-user-graduate"></i><p>No students assigned yet.</p></div>'
      : projects.map(function (p) {
          var init = Utils.initials(p.studentName || "?");
          return '<div class="student-summary-card">' +
            '<div class="avatar" style="width:38px;height:38px;font-size:.85rem;background:' + avatarColor(init) + '">' + init + "</div>" +
            '<div class="stu-info">' +
            '<div class="stu-name">' + p.studentName + "</div>" +
            '<div class="stu-project">' + Utils.truncate(p.title || "Untitled", 60) + "</div>" +
            '<div class="stu-progress">' +
            '<div class="progress-track" style="flex:1"><div class="progress-fill blue" style="width:' + p.completionPercent + '%"></div></div>' +
            '<span class="stu-pct">' + p.completionPercent + "%</span>" +
            "</div></div>" +
            badge(p.status) +
            "</div>";
        }).join("");
  }
}

/* ══════════════════════════════════════
   STUDENTS PAGE
══════════════════════════════════════ */
async function initStudents(user) {
  var grid = document.getElementById("studentsGrid");
  if (!grid) return;

  try {
    var results = await Promise.all([
      Api.get("/projects"),
      Api.get("/users/supervisor/" + user.id + "/students"),
      Api.get("/submissions"),
      Api.get("/feedback"),
    ]);
    var projects   = results[0].projects   || [];
    var students     = results[1].students   || [];
    var submissions  = results[2].submissions|| [];
    var feedbackList = results[3].feedback   || [];

    if (students.length === 0) {
      grid.innerHTML = '<div class="empty-state"><i class="fa-solid fa-user-graduate"></i><p>No students assigned yet.</p></div>';
      return;
    }

    var projectByStudent = {};
    projects.forEach(function (p) { projectByStudent[p.studentId] = p; });

    grid.innerHTML = students.map(function (s) {
      var project  = projectByStudent[s.id];
      var pct      = project ? project.completionPercent : 0;
      var subCount = submissions.filter(function (x) { return String(x.studentId) === String(s.id); }).length;
      var fbCount  = feedbackList.filter(function (x) { return String(x.studentId) === String(s.id); }).length;
      var init     = Utils.initials(s.name);

      return '<div class="student-card">' +
        '<div class="student-card-header">' +
        '<div class="avatar" style="width:46px;height:46px;font-size:1rem;background:' + avatarColor(init) + ';">' + init + "</div>" +
        '<div class="stu-details">' +
        '<div class="stu-name">' + s.name + "</div>" +
        '<div class="stu-meta">' + (s.indexNumber || "–") + " &nbsp;·&nbsp; " + (s.department || "–") + "</div>" +
        "</div>" +
        (project ? badge(project.status) : badge("Pending")) +
        "</div>" +
        '<div class="student-card-body">' +
        '<div class="project-title">' + (project ? project.title : "No project assigned") + "</div>" +
        '<div class="student-card-progress">' +
        '<div class="progress-header"><span>Progress</span><strong>' + pct + "%</strong></div>" +
        '<div class="progress-track"><div class="progress-fill blue" style="width:' + pct + '%"></div></div>' +
        "</div>" +
        '<div style="display:flex;gap:16px;font-size:var(--font-size-xs);color:var(--gray-600);">' +
        '<span><i class="fa-solid fa-upload"></i> ' + subCount + " submission" + (subCount !== 1 ? "s" : "") + "</span>" +
        '<span><i class="fa-solid fa-comments"></i> ' + fbCount + " feedback</span>" +
        "</div></div>" +
        '<div class="student-card-actions">' +
        '<a href="review.html"   class="btn btn-outline btn-sm"><i class="fa-solid fa-pen-to-square"></i> Review</a>' +
        '<a href="schedule.html" class="btn btn-outline btn-sm"><i class="fa-solid fa-calendar-days"></i> Meeting</a>' +
        '<a href="progress.html" class="btn btn-ghost btn-sm"><i class="fa-solid fa-chart-bar"></i> Progress</a>' +
        "</div></div>";
    }).join("");
  } catch (err) {
    apiErrorToast(err, "Could not load your students.");
  }
}

/* ══════════════════════════════════════
   REVIEW PAGE
══════════════════════════════════════ */
var activeSubmissionId   = null;
var reviewStudentsCache  = [];
var reviewSubsCache      = [];

async function initReview(user) {
  try {
    var res = await Api.get("/users/supervisor/" + user.id + "/students");
    reviewStudentsCache = res.students || [];
  } catch (err) {
    apiErrorToast(err, "Could not load your students.");
  }

  var filterStu = document.getElementById("filterStudent");
  if (filterStu) {
    reviewStudentsCache.forEach(function (s) {
      var opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.name;
      filterStu.appendChild(opt);
    });
    filterStu.addEventListener("change", renderReviewList);
  }

  var filterStatus = document.getElementById("filterStatus");
  if (filterStatus) filterStatus.addEventListener("change", renderReviewList);

  await renderReviewList();
  initFeedbackModal();
}

async function renderReviewList() {
  var listEl = document.getElementById("reviewList");
  if (!listEl) return;

  try {
    var res = await Api.get("/submissions");
    reviewSubsCache = res.submissions || [];
  } catch (err) {
    apiErrorToast(err, "Could not load submissions.");
    return;
  }

  var filterStu    = document.getElementById("filterStudent");
  var filterStatus = document.getElementById("filterStatus");
  var stuFilter     = filterStu    ? filterStu.value    : "all";
  var statusFilter  = filterStatus ? filterStatus.value : "all";

  var items = reviewSubsCache.filter(function (s) {
    if (stuFilter !== "all" && String(s.studentId) !== stuFilter) return false;
    if (statusFilter !== "all" && s.status !== statusFilter) return false;
    return true;
  });

  if (items.length === 0) {
    listEl.innerHTML = '<div class="empty-state"><i class="fa-solid fa-pen-to-square"></i><p>No submissions match the selected filters.</p></div>';
    return;
  }

  /* The highest version of a chapter is the one the submission rule
     reads, so only that row can be reopened. */
  function isLatestVersion(sub) {
    return !reviewSubsCache.some(function (other) {
      return String(other.studentId) === String(sub.studentId) &&
        other.chapterId === sub.chapterId &&
        Number(other.version) > Number(sub.version);
    });
  }

  listEl.innerHTML = items.map(function (sub) {
    var student = reviewStudentsCache.find(function (s) { return String(s.id) === String(sub.studentId); });
    var ch      = DB.getChapterById(sub.chapterId);
    var name    = student ? student.name : "Student";
    var init    = Utils.initials(name);

    /* Approving a chapter closes it. This is the way back — the
       student cannot submit again until it is pressed. */
    var reopenBtn = "";
    if (sub.status === "Approved" && isLatestVersion(sub)) {
      reopenBtn = sub.reopenedAt
        ? '<span class="rc-meta">Reopened — awaiting a revised version</span>'
        : '<button class="btn btn-outline btn-sm" data-reopen-id="' + sub.id +
          '"><i class="fa-solid fa-rotate-left"></i> Reopen for resubmission</button>';
    }

    return '<div class="review-card">' +
      '<div class="review-card-header">' +
      '<div class="avatar" style="width:38px;height:38px;font-size:.85rem;background:' + avatarColor(init) + ';">' + init + "</div>" +
      '<div class="rc-info">' +
      '<div class="rc-title">' + name + " — " + (ch ? ch.label + ": " + ch.title : sub.chapterId) + "</div>" +
      '<div class="rc-meta">Submitted: ' + Utils.formatDateTime(sub.submittedAt) + " &nbsp;·&nbsp; Version: v" + sub.version + " &nbsp;·&nbsp; " + sub.fileSize + "</div>" +
      "</div>" +
      badge(sub.status) +
      "</div>" +
      '<div class="review-card-body">' +
      '<div class="file-row">' +
      '<div class="file-info"><i class="fa-solid fa-file-lines"></i> ' + sub.fileName + "</div>" +
      '<button class="btn btn-outline btn-sm" data-dl-id="' + sub.id + '" data-dl-name="' + sub.fileName + '"><i class="fa-solid fa-download"></i> Download</button>' +
      "</div>" +
      '<div class="feedback-actions">' +
      '<button class="btn btn-primary btn-sm" data-fb-id="' + sub.id + '"><i class="fa-solid fa-comments"></i> Give Feedback</button>' +
      reopenBtn +
      "</div></div></div>";
  }).join("");

  listEl.querySelectorAll("button[data-dl-id]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      downloadFile(Api.baseUrl + "/submissions/" + btn.dataset.dlId + "/download", btn.dataset.dlName);
    });
  });

  listEl.querySelectorAll("button[data-reopen-id]").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      var reason = window.prompt(
        "Why are you reopening this chapter? (optional — the student sees this)"
      );
      /* Cancel is null; an empty string is "no reason given". */
      if (reason === null) return;

      btn.disabled = true;
      try {
        var res = await Api.post("/submissions/" + btn.dataset.reopenId + "/reopen", {
          reason: reason.trim() || null,
        });
        showToast(res.message || "Chapter reopened.", "success", 4500);
        await renderReviewList();
      } catch (err) {
        apiErrorToast(err, "Could not reopen that chapter.");
        btn.disabled = false;
      }
    });
  });

  listEl.querySelectorAll("button[data-fb-id]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      activeSubmissionId = btn.dataset.fbId;
      var sub     = reviewSubsCache.find(function (s) { return String(s.id) === String(activeSubmissionId); });
      var student = sub ? reviewStudentsCache.find(function (s) { return String(s.id) === String(sub.studentId); }) : null;
      var ch      = sub ? DB.getChapterById(sub.chapterId) : null;
      var info = document.getElementById("feedbackModalInfo");
      if (info) {
        info.innerHTML =
          '<p style="font-size:var(--font-size-sm);color:var(--gray-700);margin-bottom:var(--space-md);padding:10px 14px;background:var(--gray-50);border-radius:var(--radius);">' +
          "Student: <strong>" + (student ? student.name : "–") + "</strong> &nbsp;·&nbsp; " +
          (ch ? ch.label + " – " + ch.title : (sub ? sub.chapterId : "")) + "</p>";
      }
      openModal("feedbackModal");
    });
  });
}

function initFeedbackModal() {
  var closeBtn  = document.getElementById("closeFeedbackModal");
  var cancelBtn = document.getElementById("cancelFeedbackBtn");
  var submitBtn = document.getElementById("submitFeedbackBtn");

  if (closeBtn)  closeBtn.addEventListener("click",  function () { closeModal("feedbackModal"); });
  if (cancelBtn) cancelBtn.addEventListener("click", function () { closeModal("feedbackModal"); });

  if (submitBtn) {
    submitBtn.addEventListener("click", async function () {
      var comment  = document.getElementById("feedbackComment").value.trim();
      var decision = document.getElementById("feedbackDecision").value;

      if (!comment) { showToast("Please enter your feedback comments.", "warning"); return; }
      if (!activeSubmissionId) return;

      var sub = reviewSubsCache.find(function (s) { return String(s.id) === String(activeSubmissionId); });
      var ch  = sub ? DB.getChapterById(sub.chapterId) : null;

      submitBtn.disabled = true;
      try {
        var payload = { submissionId: activeSubmissionId, comment: comment, rating: decision };
        if (ch) payload.chapterLabel = ch.label + " – " + ch.title;

        await Api.post("/feedback", payload);
        closeModal("feedbackModal");
        showToast("Feedback submitted successfully! Student has been notified.", "success", 4000);
        document.getElementById("feedbackComment").value  = "";
        document.getElementById("feedbackDecision").value = "Approved";
        activeSubmissionId = null;
        await renderReviewList();
        await updateReviewBadge();
      } catch (err) {
        apiErrorToast(err, "Could not submit feedback.");
      } finally {
        submitBtn.disabled = false;
      }
    });
  }
}

/* ══════════════════════════════════════
   PROGRESS MONITOR PAGE
══════════════════════════════════════ */
async function initProgress(user) {
  var listEl = document.getElementById("progressMonitorList");
  if (!listEl) return;

  try {
    var results = await Promise.all([
      Api.get("/projects"),
      Api.get("/submissions"),
    ]);
    var projects    = results[0].projects    || [];
    var submissions = results[1].submissions || [];

    if (projects.length === 0) {
      listEl.innerHTML = '<div class="empty-state"><i class="fa-solid fa-chart-bar"></i><p>No students assigned.</p></div>';
      return;
    }

    listEl.innerHTML = projects.map(function (p) {
      var subs = submissions.filter(function (s) { return String(s.studentId) === String(p.studentId); });
      var chapterMap = {};
      subs.forEach(function (s) { chapterMap[s.chapterId] = s.status; });

      var init = Utils.initials(p.studentName || "?");
      var chapterDots = DB_CHAPTERS.map(function (ch) {
        var status = chapterMap[ch.id] || "Pending";
        var cls  = status === "Approved" ? "approved" : status === "Under Review" ? "review" : status === "Needs Revision" ? "revision" : "pending";
        var icon = status === "Approved" ? '<i class="fa-solid fa-circle-check"></i>' : status === "Under Review" ? '<i class="fa-solid fa-eye"></i>' : status === "Needs Revision" ? '<i class="fa-solid fa-pen"></i>' : '<i class="fa-solid fa-hourglass-half"></i>';
        return '<div class="monitor-chapter ' + cls + '"><div class="mc-label">' + ch.label.replace("Chapter ", "Ch.") + "</div><div>" + icon + "</div></div>";
      }).join("");

      return '<div class="monitor-card">' +
        '<div class="monitor-card-header">' +
        '<div class="avatar" style="width:42px;height:42px;font-size:.9rem;background:' + avatarColor(init) + ';">' + init + "</div>" +
        '<div class="mc-info">' +
        '<div class="mc-name">' + (p.studentName || "–") + " &nbsp; " + badge(p.status) + "</div>" +
        '<div class="mc-project">' + Utils.truncate(p.title || "Untitled", 70) + "</div>" +
        "</div></div>" +
        '<div class="progress-track" style="margin-bottom:var(--space-sm);"><div class="progress-fill blue" style="width:' + p.completionPercent + '%;"></div></div>' +
        '<div style="font-size:var(--font-size-xs);color:var(--gray-600);margin-bottom:var(--space-sm);">' +
        p.completionPercent + "% complete" + (p.deadline ? " &nbsp;·&nbsp; Deadline: " + Utils.shortDate(p.deadline) : "") +
        "</div>" +
        '<div class="monitor-chapters">' + chapterDots + "</div></div>";
    }).join("");
  } catch (err) {
    apiErrorToast(err, "Could not load progress data.");
  }
}

/* ══════════════════════════════════════
   SCHEDULE PAGE
══════════════════════════════════════ */
async function initSchedule(user) {
  var upcomingEl = document.getElementById("supUpcomingMeetings");
  var pastEl     = document.getElementById("supPastMeetings");

  async function load() {
    try {
      var res = await Api.get("/meetings");
      var meetings = res.meetings || [];
      renderMeetings(upcomingEl, meetings.filter(function (m) { return m.status === "Upcoming"; }), false);
      renderMeetings(pastEl,     meetings.filter(function (m) { return m.status === "Completed"; }), true);
    } catch (err) {
      apiErrorToast(err, "Could not load meetings.");
    }
  }

  function renderMeetings(el, meetings, isPast) {
    if (!el) return;
    if (meetings.length === 0) {
      el.innerHTML = '<div class="empty-state"><i class="fa-solid ' + (isPast ? "fa-clock-rotate-left" : "fa-calendar-days") + '"></i><p>' + (isPast ? "No past meetings." : "No upcoming meetings.") + "</p></div>";
      return;
    }
    var esc = Utils.escapeHtml;

    el.innerHTML = meetings.map(function (m) {
      var d = new Date(m.date);
      var day = d.getDate();
      var mon = d.toLocaleString("en-GB", { month: "short" }).toUpperCase();
      var participantNames = (m.participants || []).map(function (p) { return p.name; }).join(", ");

      /* Shared with the student portal, so both sides of a meeting
         read the same state: a real Join link, In-Person, or
         "Link pending". */
      var actionBtn = Utils.meetingJoin(m, isPast);

      /* The supervisor is the one who can do something about a
         pending link, so they get the way to add it. Without this
         the honest "Link pending" state is a dead end. */
      var addLink = (!isPast && !Utils.safeUrl(m.link) && !Utils.isInPerson(m.platform))
        ? '<div class="meeting-link-add">' +
            '<button type="button" class="btn btn-ghost btn-sm" data-add-link="' + esc(m.id) + '">' +
              '<i class="fa-solid fa-link"></i> Add link</button>' +
            '<form class="meeting-link-form hidden" data-link-form="' + esc(m.id) + '">' +
              '<input type="url" class="input-sm" name="link" placeholder="https://zoom.us/j/…" required />' +
              '<button type="submit" class="btn btn-primary btn-sm">Save</button>' +
            "</form>" +
          "</div>"
        : "";

      return '<div class="meeting-card' + (isPast ? " past-meeting-card" : "") + '">' +
        '<div class="meeting-date-box"><div class="mday">' + day + '</div><div class="mmon">' + mon + "</div></div>" +
        '<div class="meeting-info"><h4>' + esc(m.title) + "</h4>" +
        '<div class="meeting-meta"><span><i class="fa-solid fa-clock"></i> ' + esc(m.time) + '</span><span><i class="fa-solid fa-stopwatch"></i> ' + esc(m.duration) + "</span></div>" +
        '<div class="meeting-meta"><span><i class="fa-solid fa-user-graduate"></i> ' + esc(participantNames || "–") + "</span></div>" +
        '<div class="meeting-meta"><span><i class="fa-solid fa-video"></i> ' + esc(m.platform) + "</span></div>" +
        actionBtn + addLink + "</div></div>";
    }).join("");

    wireAddLink(el);
  }

  /* One flag for the whole page rather than one per card: a
     background refresh must not repaint a form that is mid-save,
     and two saves cannot be in flight at once anyway. */
  var savingLink = false;

  function wireAddLink(root) {
    root.querySelectorAll("[data-add-link]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var form = root.querySelector('[data-link-form="' + CSS.escape(btn.dataset.addLink) + '"]');
        if (!form) return;
        btn.classList.add("hidden");
        form.classList.remove("hidden");
        var input = form.querySelector("input");
        if (input) input.focus();
      });
    });

    root.querySelectorAll("[data-link-form]").forEach(function (form) {
      form.addEventListener("submit", async function (e) {
        e.preventDefault();
        if (savingLink) return;

        var input = form.querySelector("input");
        var save = form.querySelector("button[type=submit]");
        var value = (input && input.value.trim()) || "";
        if (!Utils.safeUrl(value)) {
          showToast("Enter a full http(s) meeting link.", "warning");
          return;
        }

        savingLink = true;
        if (save) save.disabled = true;
        try {
          await Api.put("/meetings/" + form.dataset.linkForm, { link: value });
          showToast("Meeting link added. Everyone invited has been notified.", "success", 4500);
          await load();
        } catch (err) {
          apiErrorToast(err, "Could not save the meeting link.");
        } finally {
          savingLink = false;
          if (save) save.disabled = false;
        }
      });
    });
  }

  /* Held so "All my students" can expand to their ids on submit.
     The <option> only ever carries the sentinel, never a list. */
  var myStudentIds = [];

  var stuSelect = document.getElementById("mtgStudents");
  if (stuSelect) {
    var allOption = document.getElementById("mtgAllStudentsOption");
    try {
      var res = await Api.get("/users/supervisor/" + user.id + "/students");
      var students = res.students || [];

      /* "All" expands to the ids the API will actually accept — it
         refuses a meeting containing a student who is not active, and
         one suspended account would otherwise fail the whole booking
         with nothing on screen explaining which student caused it. */
      myStudentIds = students
        .filter(function (s) { return s.status === "active"; })
        .map(function (s) { return s.id; });

      students.forEach(function (s) {
        var opt = document.createElement("option");
        opt.value = s.id;
        opt.textContent = s.name;
        stuSelect.appendChild(opt);
      });

      /* Offered whenever there is anyone to invite. It was previously
         hidden below two students, on the reasoning that "all" and
         "that one student" are the same click — but a supervisor who
         has one student today and four next term then finds the
         option missing and concludes the feature does not exist. */
      if (allOption) {
        allOption.hidden = myStudentIds.length === 0;
        allOption.textContent = "All my students (" + myStudentIds.length + ")";
      }
    } catch (err) {
      /* The dropdown is the whole form: a supervisor staring at an
         empty picker needs to know the list failed to load, not be
         left to conclude they have no students. */
      apiErrorToast(err, "Could not load your students. Please reload the page.");
    }
  }

  var newBtn    = document.getElementById("newMeetingBtn");
  var closeBtn  = document.getElementById("closeScheduleModal");
  var cancelBtn = document.getElementById("cancelScheduleBtn");
  var submitBtn = document.getElementById("submitScheduleBtn");

  if (newBtn)    newBtn.addEventListener("click",    function () { openModal("scheduleMeetingModal"); });
  if (closeBtn)  closeBtn.addEventListener("click",  function () { closeModal("scheduleMeetingModal"); });
  if (cancelBtn) cancelBtn.addEventListener("click", function () { closeModal("scheduleMeetingModal"); });

  if (submitBtn) {
    submitBtn.addEventListener("click", async function () {
      var title     = document.getElementById("mtgTitle").value.trim();
      var studentId = document.getElementById("mtgStudents").value;
      var date      = document.getElementById("mtgDate").value;
      var time      = document.getElementById("mtgTime").value;
      var duration  = document.getElementById("mtgDuration").value;
      var platform  = document.getElementById("mtgPlatform").value;
      var link      = document.getElementById("mtgLink").value.trim();
      var notes     = document.getElementById("mtgAgenda").value.trim();

      if (!title || !studentId || !date || !time) {
        showToast("Please fill in all required fields.", "warning");
        return;
      }

      var studentIds = studentId === "__all__" ? myStudentIds.slice() : [studentId];
      if (studentIds.length === 0) {
        showToast("You have no students assigned yet.", "warning");
        return;
      }

      submitBtn.disabled = true;
      try {
        var created = await Api.post("/meetings", {
          title: title, date: date, time: time, duration: duration,
          platform: platform, link: link || null, notes: notes || null,
          studentIds: studentIds,
        });
        closeModal("scheduleMeetingModal");
        /* The API counts the invitations it actually sent, so the
           toast says "8 students" rather than guessing. */
        showToast(created.message || "Meeting scheduled successfully.", "success", 4500);
        document.getElementById("scheduleMeetingForm").reset();
        await load();
      } catch (err) {
        apiErrorToast(err, "Could not schedule the meeting.");
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  await load();
}

/* ══════════════════════════════════════
   NOTIFICATIONS PAGE
══════════════════════════════════════ */
async function initNotifications(user) {
  var listEl  = document.getElementById("notifList");
  var markBtn = document.getElementById("markAllReadBtn");
  if (!listEl) return;

  var notifs = [];

  function render() {
    if (notifs.length === 0) {
      listEl.innerHTML = '<div class="empty-state"><i class="fa-solid fa-bell"></i><p>No notifications.</p></div>';
      return;
    }
    listEl.innerHTML = notifs.map(function (n) {
      return '<div class="notif-item ' + (n.read ? "" : "unread") + '" data-id="' + n.id + '">' +
        '<span class="notif-icon">' + Utils.notifIcon(n.type) + "</span><div>" +
        '<div class="notif-msg">' + Utils.escapeHtml(n.message) + "</div>" +
        '<div class="notif-time">' + Utils.formatDateTime(n.date) + "</div></div></div>";
    }).join("");

    listEl.querySelectorAll(".notif-item").forEach(function (item) {
      item.addEventListener("click", async function () {
        await NotificationSystem.markRead(item.dataset.id);
        var n = notifs.find(function (x) { return String(x.id) === item.dataset.id; });
        if (n) n.read = true;
        item.classList.remove("unread");
      });
    });
  }

  async function load() {
    try {
      var res = await Api.get("/notifications");
      notifs = res.notifications || [];
      render();
    } catch (err) {
      apiErrorToast(err, "Could not load notifications.");
    }
  }

  if (markBtn) {
    markBtn.addEventListener("click", async function () {
      await NotificationSystem.markAllRead();
      notifs.forEach(function (n) { n.read = true; });
      render();
    });
  }

  await load();
}

/* ══════════════════════════════════════
   PROFILE PAGE
══════════════════════════════════════ */
async function initProfile(user) {
  var avEl = document.getElementById("profileAvatar");
  if (avEl) {
    var init = Utils.initials(user.name);
    avEl.textContent = init;
    avEl.style.background = avatarColor(init);
  }

  document.getElementById("profileName").textContent = user.name;
  document.getElementById("profileId").textContent   = user.staffId || "–";

  document.getElementById("profileFullName").value = user.name;
  document.getElementById("profileEmail").value    = user.email;
  document.getElementById("profileStaffId").value  = user.staffId || "";
  document.getElementById("profileDept").value     = user.department || "";
  document.getElementById("profileSpec").value     = user.specialization || "";

  var saveBtn = document.getElementById("saveProfileBtn");
  if (saveBtn) {
    saveBtn.addEventListener("click", async function () {
      var fullName = document.getElementById("profileFullName").value.trim();
      var parts = fullName.split(" ");
      var firstName = parts.shift() || fullName;
      var lastName  = parts.join(" ") || firstName;
      var specialization = document.getElementById("profileSpec").value.trim();

      try {
        var res = await Api.put("/users/" + user.id, { firstName: firstName, lastName: lastName, specialization: specialization });
        Utils.saveSession(Object.assign({}, user, res.user), Utils.getToken());
        showToast("Profile updated successfully!", "success");
      } catch (err) {
        apiErrorToast(err, "Could not update your profile.");
      }
    });
  }

  var pwBtn = document.getElementById("changePasswordBtn");
  if (pwBtn) {
    pwBtn.addEventListener("click", async function () {
      var curr = document.getElementById("currentPassword").value;
      var newP = document.getElementById("newPassword").value;
      var conf = document.getElementById("confirmPassword").value;
      if (!curr || !newP || !conf) { showToast("Please fill in all password fields.", "warning"); return; }
      if (newP.length < 8)         { showToast("New password must be at least 8 characters.", "warning"); return; }
      if (newP !== conf)           { showToast("Passwords do not match.", "warning"); return; }

      try {
        var pwRes = await Api.post("/auth/change-password", { currentPassword: curr, newPassword: newP });
        /* The API retires every old token on a password change and returns
           a fresh one — store it, or the very next request would 401. */
        if (pwRes && pwRes.token) {
          user.mustChangePassword = false;
          Utils.saveSession(user, pwRes.token);
        }
        showToast("Password changed successfully!", "success");
        document.getElementById("currentPassword").value = "";
        document.getElementById("newPassword").value     = "";
        document.getElementById("confirmPassword").value = "";
      } catch (err) {
        apiErrorToast(err, "Could not change your password.");
      }
    });
  }
}

/* ══════════════════════════════════════
   ROUTE
══════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", async function () {
  var user = initApp("supervisor");
  if (!user) return;

  updateReviewBadge();

  var page = currentPage();
  if      (page === "dashboard.html")     await initDashboard(user);
  else if (page === "students.html")      await initStudents(user);
  else if (page === "review.html")        await initReview(user);
  else if (page === "progress.html")      await initProgress(user);
  else if (page === "schedule.html")      await initSchedule(user);
  else if (page === "notifications.html") await initNotifications(user);
  else if (page === "profile.html")       await initProfile(user);
});