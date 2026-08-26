/* ============================================================
   js/student.js — Student Portal Logic
   Now backed by the real API (js/api.js) instead of the mock
   DB_USERS/DB_PROJECTS/... arrays. DB_CHAPTERS stays local
   (it's static reference data, not stored server-side).
   Handles: dashboard, submissions, feedback,
            progress, meetings, notifications, profile
============================================================ */

"use strict";

/* ══════════════════════════════════════
   HELPERS
══════════════════════════════════════ */
function getAvatarColor(initials) {
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

/** Fetch a protected file as a blob (so the Authorization header
 *  can be attached) and trigger a browser download. Plain <a href>
 *  links can't carry auth headers, so downloads must go through fetch. */
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

function renderMeetingCard(m, isPast) {
  var d   = new Date(m.date);
  var day = d.getDate();
  var mon = d.toLocaleString("en-GB", { month: "short" }).toUpperCase();
  var joinBtn = (!isPast && m.link)
    ? '<a href="' + m.link + '" target="_blank" class="btn btn-primary btn-sm"><i class="fa-solid fa-link"></i> Join</a>'
    : isPast
      ? badge("Completed")
      : '<span class="badge badge-secondary"><i class="fa-solid fa-location-dot"></i> In-Person</span>';

  return '<div class="meeting-card' + (isPast ? " past-meeting-card" : "") + '">' +
    '<div class="meeting-date-box"><div class="mday">' + day + '</div><div class="mmon">' + mon + '</div></div>' +
    '<div class="meeting-info">' +
    '<h4>' + m.title + '</h4>' +
    '<div class="meeting-meta"><span><i class="fa-solid fa-clock"></i> ' + m.time + '</span><span><i class="fa-solid fa-stopwatch"></i> ' + m.duration + '</span><span>' + m.type + '</span></div>' +
    '<div class="meeting-meta"><span><i class="fa-solid fa-video"></i> ' + m.platform + '</span></div>' +
    (m.notes ? '<div class="meeting-meta"><span><i class="fa-regular fa-note-sticky"></i> ' + m.notes + '</span></div>' : "") +
    joinBtn +
    '</div></div>';
}

/* ══════════════════════════════════════
   DASHBOARD PAGE
══════════════════════════════════════ */
async function initDashboard(user) {
  var el = function (id) { return document.getElementById(id); };

  var sub = el("topbarSub");
  if (sub) sub.textContent = "Welcome back, " + user.name.split(" ")[0] + "!";

  var project = null, subs = [], feedback = [], meetings = [];

  try {
    var results = await Promise.all([
      Api.get("/projects"),
      Api.get("/submissions"),
      Api.get("/feedback"),
      Api.get("/meetings"),
    ]);
    project  = (results[0].projects  && results[0].projects[0])  || null;
    subs     = results[1].submissions || [];
    feedback = results[2].feedback    || [];
    meetings = results[3].meetings    || [];
  } catch (err) {
    apiErrorToast(err, "Could not load your dashboard data.");
  }

  el("statCompletion").textContent  = project ? project.completionPercent + "%" : "–";
  el("statSubmissions").textContent = subs.length;
  el("statFeedback").textContent    = feedback.length;

  if (project && project.deadline) {
    var days = Utils.daysUntil(project.deadline);
    el("statDays").textContent = days >= 0 ? days : "Overdue";
  } else {
    el("statDays").textContent = "–";
  }

  if (project) {
    el("projectTitle").textContent = project.title;
    el("projectDesc").textContent  = project.topic || "";
    el("projectStatusBadge").innerHTML = badge(project.status);
    el("topicStatusBadge").innerHTML   = badge(project.topicStatus);
    el("progressPct").textContent      = project.completionPercent + "%";
    el("progressBar").style.width      = project.completionPercent + "%";
    el("projectMeta").innerHTML =
      '<span><i class="fa-solid fa-calendar-days"></i> Started: ' + (project.startDate ? Utils.shortDate(project.startDate) : "–") + '</span>' +
      '<span><i class="fa-solid fa-clock"></i> Due: '             + (project.deadline  ? Utils.shortDate(project.deadline)  : "–") + '</span>';

    var supInit = Utils.initials(project.supervisorName || "? ?");
    var supAv   = el("supAvatar");
    supAv.textContent      = supInit;
    supAv.style.background = getAvatarColor(supInit);
    el("supName").textContent  = project.supervisorName || "–";
    el("supSpec").innerHTML    = '<i class="fa-solid fa-book"></i> '                + (project.supervisorSpecialization || "–");
    el("supDept").innerHTML    = '<i class="fa-solid fa-building-columns"></i> '    + (project.supervisorDepartment || "–");
    el("supEmail").innerHTML   = '<i class="fa-solid fa-envelope"></i> '            + (project.supervisorEmail || "–");
  } else {
    el("projectTitle").textContent = "No project assigned yet";
    el("projectDesc").textContent  = "Your administrator hasn't set up a project for you yet. Check back soon.";
    el("projectStatusBadge").innerHTML = badge("Pending");
    el("topicStatusBadge").innerHTML   = badge("Pending");
  }

  var tbody = el("recentSubmissionsTable");
  if (tbody) {
    var recent = subs.slice(-3).reverse();
    tbody.innerHTML = recent.length === 0
      ? '<tr><td colspan="3" class="text-center text-gray-600">No submissions yet.</td></tr>'
      : recent.map(function (s) {
          var ch = DB.getChapterById(s.chapterId);
          return "<tr>" +
            "<td>" + (ch ? ch.label + " – " + ch.title : s.chapterId) + "</td>" +
            "<td>v" + s.version + "</td>" +
            "<td>" + badge(s.status) + "</td>" +
            "</tr>";
        }).join("");
  }

  var meetList = el("upcomingMeetingsList");
  if (meetList) {
    var upcoming = meetings.filter(function (m) { return m.status === "Upcoming"; });
    meetList.innerHTML = upcoming.length === 0
      ? '<div class="empty-state"><i class="fa-solid fa-calendar-days"></i><p>No upcoming meetings.</p></div>'
      : upcoming.slice(0, 2).map(function (m) { return renderMeetingCard(m, false); }).join("");
  }
}

/* ══════════════════════════════════════
   SUBMISSIONS PAGE
══════════════════════════════════════ */
async function initSubmissions(user) {
  var statusList = document.getElementById("chapterStatusList");
  var tbody      = document.getElementById("submissionHistoryTable");

  function renderChapterStatus(subs) {
    if (!statusList) return;
    statusList.innerHTML = DB_CHAPTERS.map(function (ch) {
      var chSubs = subs.filter(function (s) { return s.chapterId === ch.id; });
      var latest = chSubs.length > 0 ? chSubs[chSubs.length - 1] : null;
      var versions = chSubs.length > 0
        ? chSubs.length + " version" + (chSubs.length > 1 ? "s" : "")
        : "Not submitted";
      return '<div class="chapter-status-item">' +
        '<span class="ch-name">' + ch.label + " – " + ch.title + "</span>" +
        '<span class="ch-versions">' + versions + "</span>" +
        (latest ? badge(latest.status) : badge("Pending")) +
        "</div>";
    }).join("");
  }

  function renderHistory(subs) {
    if (!tbody) return;
    if (subs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-gray-600">No submissions yet.</td></tr>';
      return;
    }
    tbody.innerHTML = subs.map(function (s) {
      var ch = DB.getChapterById(s.chapterId);
      return "<tr>" +
        "<td>" + (ch ? ch.label : s.chapterId) + "</td>" +
        '<td><div class="file-name"><i class="fa-solid fa-file-lines"></i>' + s.fileName + "</div></td>" +
        "<td>v" + s.version + "</td>" +
        "<td>" + Utils.formatDateTime(s.submittedAt) + "</td>" +
        "<td>" + s.fileSize + "</td>" +
        "<td>" + badge(s.status) + "</td>" +
        '<td><button class="btn btn-outline btn-sm" data-dl-id="' + s.id + '" data-dl-name="' + s.fileName + '"><i class="fa-solid fa-download"></i> Download</button></td>' +
        "</tr>";
    }).join("");

    tbody.querySelectorAll("button[data-dl-id]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        downloadFile(Api.baseUrl + "/submissions/" + btn.dataset.dlId + "/download", btn.dataset.dlName);
      });
    });
  }

  async function loadAndRender() {
    try {
      var res  = await Api.get("/submissions");
      var subs = res.submissions || [];
      renderChapterStatus(subs);
      renderHistory(subs);
    } catch (err) {
      apiErrorToast(err, "Could not load your submissions.");
    }
  }

  initUploadZone(loadAndRender);
  await loadAndRender();
}

function initUploadZone(onSuccess) {
  var zone      = document.getElementById("uploadZone");
  var fileInput = document.getElementById("fileInput");
  var display   = document.getElementById("fileNameDisplay");
  var form      = document.getElementById("uploadForm");
  var selectedFile = null;

  if (!zone || !fileInput || !form) return;

  zone.addEventListener("click", function () { fileInput.click(); });
  zone.addEventListener("dragover", function (e) { e.preventDefault(); zone.classList.add("drag-over"); });
  zone.addEventListener("dragleave", function () { zone.classList.remove("drag-over"); });
  zone.addEventListener("drop", function (e) {
    e.preventDefault();
    zone.classList.remove("drag-over");
    var file = e.dataTransfer.files[0];
    if (file) { selectedFile = file; display.innerHTML = '<i class="fa-solid fa-paperclip"></i> ' + file.name; }
  });
  fileInput.addEventListener("change", function () {
    if (fileInput.files[0]) { selectedFile = fileInput.files[0]; display.innerHTML = '<i class="fa-solid fa-paperclip"></i> ' + selectedFile.name; }
  });

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    var chapter = document.getElementById("chapterSelect").value;
    var notes   = document.getElementById("subNotes").value.trim();

    if (!chapter)      { showToast("Please select a chapter first.", "warning"); return; }
    if (!selectedFile) { showToast("Please attach a file before submitting.", "warning"); return; }

    var submitBtn = form.querySelector('button[type="submit"]');
    var original  = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting…';

    var fd = new FormData();
    fd.append("chapterId", chapter);
    fd.append("notes", notes);
    fd.append("file", selectedFile);

    try {
      await Api.upload("/submissions", fd);
      showToast("Chapter submitted successfully! Your supervisor will be notified.", "success", 4000);
      form.reset();
      display.innerHTML = "";
      selectedFile = null;
      if (typeof onSuccess === "function") await onSuccess();
    } catch (err) {
      apiErrorToast(err, "Could not submit your chapter.");
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = original;
    }
  });
}

/* ══════════════════════════════════════
   FEEDBACK PAGE
══════════════════════════════════════ */
async function initFeedback(user) {
  var feedbackList = document.getElementById("feedbackList");
  if (!feedbackList) return;

  try {
    var res   = await Api.get("/feedback");
    var items = res.feedback || [];

    if (items.length === 0) {
      feedbackList.innerHTML =
        '<div class="feedback-empty"><i class="fa-solid fa-comments"></i>' +
        "<p>No feedback received yet. Submit a chapter to get started.</p></div>";
      return;
    }

    feedbackList.innerHTML = items.map(function (fb) {
      var supName = fb.supervisorName || "Your Supervisor";
      var init    = Utils.initials(supName);
      var color   = getAvatarColor(init);

      return '<div class="feedback-card">' +
        '<div class="feedback-card-head">' +
        '<div class="avatar" style="width:38px;height:38px;font-size:.85rem;background:' + color + '">' + init + '</div>' +
        '<div class="fh-info">' +
        '<div class="fh-name">' + supName + "</div>" +
        '<div class="fh-meta">' + fb.chapterLabel + " &nbsp;·&nbsp; " + Utils.formatDate(fb.date) + "</div>" +
        "</div>" +
        badge(fb.rating) +
        "</div>" +
        '<div class="feedback-card-body">' + fb.comment + "</div>" +
        "</div>";
    }).join("");
  } catch (err) {
    apiErrorToast(err, "Could not load your feedback.");
  }
}

/* ══════════════════════════════════════
   PROGRESS PAGE
══════════════════════════════════════ */
async function initProgress(user) {
  var pctEl  = document.getElementById("completionPercent");
  var listEl = document.getElementById("chapterProgressList");
  var dlEl   = document.getElementById("deadlineInfo");
  var tlEl   = document.getElementById("milestoneTimeline");

  try {
    var projRes = await Api.get("/projects");
    var project = (projRes.projects && projRes.projects[0]) || null;

    if (pctEl) pctEl.textContent = project ? project.completionPercent + "%" : "–";

    var subs = [];
    try {
      var subRes = await Api.get("/submissions");
      subs = subRes.submissions || [];
    } catch (e) { /* non-fatal for this page */ }

    if (listEl) {
      listEl.innerHTML = DB_CHAPTERS.map(function (ch) {
        var chSubs = subs.filter(function (s) { return s.chapterId === ch.id; });
        var latest = chSubs.length > 0 ? chSubs[chSubs.length - 1] : null;
        var pct = !latest ? 0
          : latest.status === "Approved"       ? 100
          : latest.status === "Under Review"   ? 60
          : latest.status === "Needs Revision" ? 40
          : 0;
        var barColor = pct === 100 ? "green" : pct > 0 ? "blue" : "gray";
        var pctColor = pct === 100 ? "var(--secondary)" : pct > 0 ? "var(--primary)" : "var(--gray-400)";
        return '<div class="chapter-progress-item">' +
          '<div class="chapter-progress-header">' +
          '<span class="ch-title">' + ch.label + " – " + ch.title + "</span>" +
          '<span class="ch-pct" style="color:' + pctColor + '">' + pct + "%</span>" +
          "</div>" +
          '<div class="progress-track"><div class="progress-fill ' + barColor + '" style="width:' + pct + '%"></div></div>' +
          "</div>";
      }).join("");
    }

    if (dlEl) {
      var days = project && project.deadline ? Utils.daysUntil(project.deadline) : null;
      dlEl.innerHTML =
        '<div class="deadline-row"><span><i class="fa-solid fa-clock"></i> Deadline</span><strong>' +
        (project && project.deadline ? Utils.formatDate(project.deadline) : "–") + "</strong></div>" +
        '<div class="deadline-row"><span><i class="fa-solid fa-calendar-days"></i> Days Remaining</span><strong>' +
        (days !== null ? (days >= 0 ? days + " days" : "Overdue") : "–") + "</strong></div>";
    }

    if (tlEl) {
      if (!project) {
        tlEl.innerHTML = '<p class="text-gray-600 text-sm">No project assigned yet.</p>';
      } else {
        var msRes = await Api.get("/projects/milestones/" + project.id);
        var milestones = msRes.milestones || [];
        tlEl.innerHTML = milestones.length === 0
          ? '<p class="text-gray-600 text-sm">No milestones set yet.</p>'
          : milestones.map(function (ms) {
              var dotClass = ms.status === "Completed" ? "done" : ms.status === "In Progress" ? "active" : "pending";
              return '<div class="tl-item">' +
                '<div class="tl-dot ' + dotClass + '"></div>' +
                '<div class="tl-label">' + ms.label + "</div>" +
                '<div class="tl-date"><i class="fa-solid fa-calendar-days"></i> ' +
                (ms.due_date ? Utils.shortDate(ms.due_date) : "–") + " &nbsp;·&nbsp; " + badge(ms.status) + "</div>" +
                "</div>";
            }).join("");
      }
    }
  } catch (err) {
    apiErrorToast(err, "Could not load your progress.");
  }
}

/* ══════════════════════════════════════
   MEETINGS PAGE
══════════════════════════════════════ */
async function initMeetings(user) {
  var upcomingEl = document.getElementById("upcomingMeetingsList");
  var pastEl     = document.getElementById("pastMeetingsList");

  function renderList(el, meetings, isPast) {
    if (!el) return;
    el.innerHTML = meetings.length === 0
      ? '<div class="empty-state"><i class="fa-solid ' + (isPast ? "fa-clock-rotate-left" : "fa-calendar-days") + '"></i>' +
        "<p>" + (isPast ? "No past meetings." : "No upcoming meetings.") + "</p></div>"
      : meetings.map(function (m) { return renderMeetingCard(m, isPast); }).join("");
  }

  async function load() {
    try {
      var res = await Api.get("/meetings");
      var meetings = res.meetings || [];
      renderList(upcomingEl, meetings.filter(function (m) { return m.status === "Upcoming"; }), false);
      renderList(pastEl,     meetings.filter(function (m) { return m.status === "Completed"; }), true);
    } catch (err) {
      apiErrorToast(err, "Could not load your meetings.");
    }
  }

  var reqBtn    = document.getElementById("requestMeetingBtn");
  var closeBtn  = document.getElementById("closeMeetingModal");
  var cancelBtn = document.getElementById("cancelMeetingBtn");
  var submitBtn = document.getElementById("submitMeetingBtn");

  if (reqBtn)    reqBtn.addEventListener("click",    function () { openModal("meetingModal"); });
  if (closeBtn)  closeBtn.addEventListener("click",  function () { closeModal("meetingModal"); });
  if (cancelBtn) cancelBtn.addEventListener("click", function () { closeModal("meetingModal"); });

  if (submitBtn) {
    submitBtn.addEventListener("click", async function () {
      var topic    = document.getElementById("mtgTopic").value.trim();
      var date     = document.getElementById("mtgDate").value;
      var time     = document.getElementById("mtgTime").value;
      var platform = document.getElementById("mtgPlatform").value;
      var notes    = document.getElementById("mtgNotes").value.trim();

      if (!topic || !date || !time) {
        showToast("Please fill in all required fields.", "warning");
        return;
      }

      var original = submitBtn.innerHTML;
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending…';

      try {
        await Api.post("/meetings/request", { topic: topic, date: date, time: time, platform: platform, notes: notes });
        closeModal("meetingModal");
        showToast("Meeting request sent to your supervisor.", "success", 4500);
        document.getElementById("meetingRequestForm").reset();
      } catch (err) {
        apiErrorToast(err, "Could not send your meeting request.");
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = original;
      }
    });
  }

  await load();
}

/* ══════════════════════════════════════
   NOTIFICATIONS PAGE
   (Uses NotificationSystem for the actual read/read-all API
   calls so the sidebar badge + bell dropdown stay in sync.)
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
        '<span class="notif-icon">' + Utils.notifIcon(n.type) + "</span>" +
        "<div>" +
        '<div class="notif-msg">' + n.message + "</div>" +
        '<div class="notif-time">' + Utils.formatDateTime(n.date) + "</div>" +
        "</div></div>";
    }).join("");

    listEl.querySelectorAll(".notif-item").forEach(function (item) {
      item.addEventListener("click", async function () {
        var id = item.dataset.id;
        await NotificationSystem.markRead(id);
        var n = notifs.find(function (x) { return String(x.id) === String(id); });
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
    avEl.textContent      = init;
    avEl.style.background = getAvatarColor(init);
  }

  document.getElementById("profileName").textContent = user.name;
  document.getElementById("profileId").textContent   = user.indexNumber || user.staffId || "–";

  document.getElementById("profileFullName").value = user.name;
  document.getElementById("profileEmail").value    = user.email;
  document.getElementById("profileIndex").value    = user.indexNumber || "";
  document.getElementById("profileDept").value     = user.department || "";
  document.getElementById("profileLevel").value    = user.level || "";

  var saveBtn = document.getElementById("saveProfileBtn");
  if (saveBtn) {
    saveBtn.addEventListener("click", async function () {
      var fullName  = document.getElementById("profileFullName").value.trim();
      var parts     = fullName.split(" ");
      var firstName = parts.shift() || fullName;
      var lastName  = parts.join(" ") || firstName;

      if (!fullName) {
        showToast("Please enter your full name.", "warning");
        return;
      }

      try {
        var res = await Api.put("/users/" + user.id, { firstName: firstName, lastName: lastName });
        var updatedUser = Object.assign({}, user, res.user);
        Utils.saveSession(updatedUser, Utils.getToken());
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
      if (newP !== conf)           { showToast("New passwords do not match.", "warning"); return; }

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
   ROUTE TO CORRECT PAGE INIT
══════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", async function () {
  var user = initApp("student");
  if (!user) return;

  var page = currentPage();

  if      (page === "dashboard.html")     await initDashboard(user);
  else if (page === "submissions.html")   await initSubmissions(user);
  else if (page === "feedback.html")      await initFeedback(user);
  else if (page === "progress.html")      await initProgress(user);
  else if (page === "meetings.html")      await initMeetings(user);
  else if (page === "notifications.html") await initNotifications(user);
  else if (page === "profile.html")       await initProfile(user);
});