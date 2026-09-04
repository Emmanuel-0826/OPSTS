/* ============================================================
   js/admin.js — Admin Portal Logic
   OPSTS – Online Project Supervision & Tracking System

   ONE SINGLE FILE — implements exactly the four documented
   Admin Dashboard requirements:
     1. Manage users      → users.html
     2. Manage projects   → projects.html
     3. Assign supervisors→ assign.html
     4. Generate reports  → reports.html
   Plus a simple overview on dashboard.html, notifications.html,
   and profile.html. All backed by the real API.
============================================================ */

"use strict";

/* ══════════════════════════════════════
   SHARED HELPERS
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
    "Assigned":       { cls: "badge-success",   icon: '<i class="fa-solid fa-link"></i>' },
    "Rejected":       { cls: "badge-danger",    icon: '<i class="fa-solid fa-circle-xmark"></i>' },
    "Active":         { cls: "badge-success",   icon: '<i class="fa-solid fa-circle-check"></i>' },
  };
  var b = map[status] || { cls: "badge-secondary", icon: "•" };
  return '<span class="badge ' + b.cls + '">' + b.icon + " " + status + "</span>";
}

function currentPage() {
  var parts = window.location.pathname.split("/");
  return parts[parts.length - 1];
}

function makeAvatar(name, w, fs) {
  var init  = Utils.initials(name || "?");
  var color = avatarColor(init);
  return '<div class="avatar" style="width:' + w + ';height:' + w +
    ';font-size:' + fs + ';background:' + color + ';">' + init + "</div>";
}

function apiErrorToast(err, fallback) {
  showToast((err && err.message) || fallback || "Something went wrong. Please try again.", "error", 4500);
}

/* Generates a random, easy-to-read temporary password
   (avoids ambiguous characters like 0/O and 1/l/I). */
function generateRandomPassword(length) {
  length = length || 10;
  var chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  var pwd = "";
  for (var i = 0; i < length; i++) {
    pwd += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pwd;
}

/* ══════════════════════════════════════
   DASHBOARD (simple overview + quick links)
══════════════════════════════════════ */
async function initDashboard(user) {
  var sub = document.getElementById("topbarSub");
  if (sub) sub.textContent = "Welcome back, " + user.name.split(" ")[0] + "!";

  try {
    var results = await Promise.all([
      Api.get("/reports/summary"),
      Api.get("/users?status=pending"),
    ]);
    var summary = results[0].summary || {};
    var pending = results[1].users || [];

    document.getElementById("statStudents").textContent    = summary.totalStudents    != null ? summary.totalStudents    : "–";
    document.getElementById("statSupervisors").textContent = summary.totalSupervisors != null ? summary.totalSupervisors : "–";
    document.getElementById("statProjects").textContent    = summary.totalProjects    != null ? summary.totalProjects    : "–";
    document.getElementById("statPending").textContent     = pending.length;
  } catch (err) {
    apiErrorToast(err, "Could not load dashboard summary.");
  }
}

/* ══════════════════════════════════════
   1. MANAGE USERS  (users.html)
══════════════════════════════════════ */
async function initUsers(user) {
  var roleFilter = "all";
  var searchTerm = "";
  var allUsers   = [];

  var tabs = document.querySelectorAll(".role-filter-tab");
  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      tabs.forEach(function (t) { t.classList.remove("active"); });
      tab.classList.add("active");
      roleFilter = tab.dataset.role;
      loadUsers();
    });
  });

  var searchEl = document.getElementById("userSearch");
  if (searchEl) {
    searchEl.addEventListener("input", Utils.debounce(function () {
      searchTerm = searchEl.value.trim();
      loadUsers();
    }, 300));
  }

  var addBtn    = document.getElementById("addUserBtn");
  var closeBtn  = document.getElementById("closeUserModal");
  var cancelBtn = document.getElementById("cancelUserBtn");
  var submitBtn = document.getElementById("submitUserBtn");

  if (addBtn)    addBtn.addEventListener("click",    function () { openModal("userModal"); });
  if (closeBtn)  closeBtn.addEventListener("click",  function () { closeModal("userModal"); });
  if (cancelBtn) cancelBtn.addEventListener("click", function () { closeModal("userModal"); });

  if (submitBtn) {
    submitBtn.addEventListener("click", async function () {
      var first    = document.getElementById("uFirstName").value.trim();
      var last     = document.getElementById("uLastName").value.trim();
      var email    = document.getElementById("uEmail").value.trim();
      var role     = document.getElementById("uRole").value;
      var idNum    = document.getElementById("uId").value.trim();
      var dept     = document.getElementById("uDept").value;
      var pwdInput = document.getElementById("uPassword").value.trim();

      if (!first || !last || !email || !role || !idNum || !dept) {
        showToast("Please fill in all required fields.", "warning");
        return;
      }
      if (!Utils.isValidEmail(email)) {
        showToast("Please enter a valid email address.", "warning");
        return;
      }

      var wasGenerated  = !pwdInput;
      var finalPassword = pwdInput || generateRandomPassword();

      var payload = { role: role, firstName: first, lastName: last, email: email, department: dept, password: finalPassword };
      if (role === "student") payload.indexNumber = idNum;
      else payload.staffId = idNum;

      submitBtn.disabled = true;
      try {
        await Api.post("/users", payload);
        closeModal("userModal");
        document.getElementById("userForm").reset();
        await loadUsers();

        if (wasGenerated) {
          window.alert(
            "Account created!\n\n" +
            "Email: " + email + "\n" +
            "Password: " + finalPassword + "\n\n" +
            "Share these credentials with " + first + ". They should change their password after logging in (Profile → Change Password)."
          );
        } else {
          showToast(first + " " + last + " added successfully!", "success");
        }
      } catch (err) {
        apiErrorToast(err, "Could not add this user.");
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  async function loadUsers() {
    var tbody = document.getElementById("usersTable");
    try {
      var params = [];
      if (roleFilter !== "all") params.push("role=" + encodeURIComponent(roleFilter));
      if (searchTerm) params.push("search=" + encodeURIComponent(searchTerm));
      var qs = params.length ? "?" + params.join("&") : "";

      var res = await Api.get("/users" + qs);
      allUsers = (res.users || []).filter(function (u) { return u.role !== "admin"; });
      renderUsers();
    } catch (err) {
      apiErrorToast(err, "Could not load users.");
      if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center text-gray-600" style="padding:32px;">Failed to load users.</td></tr>';
    }
  }

  function renderUsers() {
    var tbody = document.getElementById("usersTable");
    if (!tbody) return;

    if (allUsers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-gray-600" style="padding:32px;">No users found.</td></tr>';
      return;
    }

    tbody.innerHTML = allUsers.map(function (u) {
      var idStr = u.indexNumber || u.staffId || "–";
      /* A student's registered topic becomes their project title on
         approval, so the admin sees what they are approving before
         they approve it. Free text, so it is escaped. */
      var topicLine = u.projectTopic
        ? "<div style='font-size:var(--font-size-xs);color:var(--gray-600);'>" +
          Utils.escapeHtml(u.projectTopic) + "</div>"
        : "";
      return "<tr>" +
        "<td><div style='display:flex;align-items:center;gap:10px;'>" + makeAvatar(u.name, "32px", "0.75rem") +
        "<div><span style='font-weight:600;'>" + u.name + "</span>" + topicLine + "</div></div></td>" +
        "<td>" + badge(Utils.titleCase(u.role)) + "</td>" +
        "<td>" + idStr + "</td>" +
        "<td>" + (u.department || "–") + "</td>" +
        "<td>" + u.email + "</td>" +
        "<td>" + badge(Utils.titleCase(u.status || "active")) + "</td>" +
        '<td><div class="user-actions">' +
        (u.status === "pending" ? '<button class="btn btn-success btn-sm" data-approve-id="' + u.id + '"><i class="fa-solid fa-circle-check"></i> Approve</button>' : "") +
        '<button class="btn btn-danger btn-sm" data-del-id="' + u.id + '"><i class="fa-solid fa-trash"></i> Remove</button>' +
        "</div></td></tr>";
    }).join("");

    tbody.querySelectorAll("button[data-approve-id]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        try {
          await Api.patch("/users/" + btn.dataset.approveId + "/approve");
          showToast("User approved.", "success");
          await loadUsers();
        } catch (err) {
          apiErrorToast(err, "Could not approve this user.");
        }
      });
    });

    tbody.querySelectorAll("button[data-del-id]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        var u = allUsers.find(function (x) { return String(x.id) === btn.dataset.delId; });
        if (!u) return;

        /* The same styled dialog the sign-out button uses. Deleting a
           person cascades to their project, submissions, feedback and
           notifications, so the prompt says so rather than asking a
           one-line question in browser chrome. */
        var ok = await confirmAction({
          title: "Remove " + u.name + "?",
          message: "This permanently deletes their account along with their project, " +
            "submissions, feedback and notifications. It cannot be undone.",
          confirmLabel: "Remove account",
          cancelLabel: "Keep account",
          tone: "danger",
          icon: "fa-user-xmark",
        });
        if (!ok) return;

        try {
          await Api.delete("/users/" + btn.dataset.delId);
          showToast(u.name + " has been removed.", "info");
          await loadUsers();
        } catch (err) {
          apiErrorToast(err, "Could not remove this user.");
        }
      });
    });
  }

  await loadUsers();
}

/* ══════════════════════════════════════
   2. MANAGE PROJECTS  (projects.html)
══════════════════════════════════════ */
async function initProjects() {
  var statusFilter    = "all";
  var searchTerm      = "";
  var allProjects     = [];
  var activeProjectId = null;

  document.querySelectorAll(".role-filter-tab[data-status]").forEach(function (tab) {
    tab.addEventListener("click", function () {
      document.querySelectorAll(".role-filter-tab[data-status]").forEach(function (t) { t.classList.remove("active"); });
      tab.classList.add("active");
      statusFilter = tab.dataset.status;
      renderProjects();
    });
  });

  var searchEl = document.getElementById("projectSearch");
  if (searchEl) {
    searchEl.addEventListener("input", function () {
      searchTerm = searchEl.value.trim().toLowerCase();
      renderProjects();
    });
  }

  /* ── Project Detail modal (view + edit start/deadline dates) ── */
  function openProjectDetail(p) {
    activeProjectId = p.id;
    document.getElementById("pdTitle").value      = p.title || "";
    document.getElementById("pdTopic").value      = p.topic || "–";
    document.getElementById("pdStudent").value    = p.studentName || "–";
    document.getElementById("pdSupervisor").value = p.supervisorName || "–";
    document.getElementById("pdStartDate").value  = p.startDate ? String(p.startDate).slice(0, 10) : "";
    document.getElementById("pdDeadline").value   = p.deadline  ? String(p.deadline).slice(0, 10)  : "";
    document.getElementById("pdProgress").value   = p.completionPercent + "%";
    openModal("projectDetailModal");
  }

  var closeDetailBtn  = document.getElementById("closeProjectDetailModal");
  var cancelDetailBtn = document.getElementById("cancelProjectDetailBtn");
  var saveDatesBtn    = document.getElementById("saveProjectDatesBtn");

  if (closeDetailBtn)  closeDetailBtn.addEventListener("click",  function () { closeModal("projectDetailModal"); });
  if (cancelDetailBtn) cancelDetailBtn.addEventListener("click", function () { closeModal("projectDetailModal"); });

  if (saveDatesBtn) {
    saveDatesBtn.addEventListener("click", async function () {
      if (!activeProjectId) return;
      var startDate = document.getElementById("pdStartDate").value;
      var deadline  = document.getElementById("pdDeadline").value;

      if (!startDate && !deadline) {
        showToast("Please set a start date or deadline first.", "warning");
        return;
      }

      var payload = {};
      if (startDate) payload.startDate = startDate;
      if (deadline)  payload.deadline  = deadline;

      saveDatesBtn.disabled = true;
      try {
        await Api.put("/projects/" + activeProjectId, payload);
        showToast("Project dates updated.", "success");
        closeModal("projectDetailModal");
        await loadProjects();
      } catch (err) {
        apiErrorToast(err, "Could not update project dates.");
      } finally {
        saveDatesBtn.disabled = false;
      }
    });
  }

  async function loadProjects() {
    var tbody = document.getElementById("projectsTable");
    try {
      var res = await Api.get("/projects");
      allProjects = res.projects || [];
      renderProjects();
    } catch (err) {
      apiErrorToast(err, "Could not load projects.");
      if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="text-center text-gray-600" style="padding:32px;">Failed to load projects.</td></tr>';
    }
  }

  function renderProjects() {
    var tbody = document.getElementById("projectsTable");
    if (!tbody) return;

    var filtered = allProjects.filter(function (p) {
      var matchStatus = statusFilter === "all" || p.status === statusFilter;
      var matchSearch = !searchTerm ||
        (p.title && p.title.toLowerCase().includes(searchTerm)) ||
        (p.studentName && p.studentName.toLowerCase().includes(searchTerm));
      return matchStatus && matchSearch;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center text-gray-600" style="padding:32px;">No projects found.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(function (p) {
      var actionBtns = '<button class="btn btn-outline btn-sm" data-view-id="' + p.id + '"><i class="fa-solid fa-eye"></i> View</button>';

      if (p.status === "Pending") {
        actionBtns += ' <button class="btn btn-success btn-sm" data-approve-id="' + p.id + '"><i class="fa-solid fa-circle-check"></i> Approve</button>';
      } else if (p.status === "In Progress") {
        actionBtns += ' <button class="btn btn-outline btn-sm" data-complete-id="' + p.id + '"><i class="fa-solid fa-flag-checkered"></i> Mark Completed</button>';
      }

      return "<tr>" +
        "<td><div class='project-row-title'>" + Utils.truncate(p.title || "Untitled", 55) + "</div></td>" +
        "<td>" + (p.studentName || "–") + "</td>" +
        "<td>" + (p.supervisorName || "–") + "</td>" +
        "<td>" + (p.startDate ? Utils.shortDate(p.startDate) : "–") + "</td>" +
        "<td><div style='display:flex;align-items:center;gap:8px;'><div class='progress-track' style='flex:1;min-width:80px;'>" +
        "<div class='progress-fill blue' style='width:" + p.completionPercent + "%;'></div></div>" +
        "<span style='font-size:var(--font-size-xs);font-weight:700;'>" + p.completionPercent + "%</span></div></td>" +
        "<td>" + (p.deadline ? Utils.shortDate(p.deadline) : "–") + "</td>" +
        "<td>" + badge(p.status) + "</td>" +
        "<td><div class='user-actions'>" + actionBtns + "</div></td></tr>";
    }).join("");

    tbody.querySelectorAll("button[data-view-id]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var p = allProjects.find(function (x) { return String(x.id) === btn.dataset.viewId; });
        if (!p) return;
        openProjectDetail(p);
      });
    });

    tbody.querySelectorAll("button[data-approve-id]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        btn.disabled = true;
        try {
          await Api.put("/projects/" + btn.dataset.approveId, { status: "In Progress" });
          showToast("Project approved and moved to In Progress.", "success");
          await loadProjects();
        } catch (err) {
          apiErrorToast(err, "Could not approve this project.");
          btn.disabled = false;
        }
      });
    });

    tbody.querySelectorAll("button[data-complete-id]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        btn.disabled = true;
        try {
          await Api.put("/projects/" + btn.dataset.completeId, { status: "Completed" });
          showToast("Project marked as completed.", "success");
          await loadProjects();
        } catch (err) {
          apiErrorToast(err, "Could not update this project.");
          btn.disabled = false;
        }
      });
    });
  }

  await loadProjects();
}

/* ══════════════════════════════════════
   3. ASSIGN SUPERVISORS  (assign.html)
══════════════════════════════════════ */
async function initAssign(user) {
  var students = [], supervisors = [], projectByStudent = {};

  try {
    var results = await Promise.all([
      Api.get("/users?role=student"),
      Api.get("/users?role=supervisor"),
      Api.get("/projects"),
    ]);
    students    = results[0].users    || [];
    supervisors = results[1].users    || [];
    (results[2].projects || []).forEach(function (p) { projectByStudent[p.studentId] = p; });
  } catch (err) {
    apiErrorToast(err, "Could not load assignment data.");
    return;
  }

  renderAssignList(students, supervisors, projectByStudent);
  renderWorkload(supervisors, Object.values(projectByStudent));
}

function renderAssignList(students, supervisors, projectByStudent) {
  var listEl = document.getElementById("assignList");
  if (!listEl) return;

  if (students.length === 0) {
    listEl.innerHTML = '<div class="empty-state"><i class="fa-solid fa-user-graduate"></i><p>No students yet. Add students from Manage Users.</p></div>';
    return;
  }
  if (supervisors.length === 0) {
    listEl.innerHTML = '<div class="empty-state"><i class="fa-solid fa-chalkboard-user"></i><p>No supervisors yet. Add supervisors from Manage Users first.</p></div>';
    return;
  }

  listEl.innerHTML = students.map(function (s) {
    var project      = projectByStudent[s.id];
    var currentSupId = project ? project.supervisorId : "";
    var currentTitle = project ? (project.title || "") : "";

    var opts = '<option value="">— Select supervisor —</option>' +
      supervisors.map(function (sup) {
        var sel = String(sup.id) === String(currentSupId) ? "selected" : "";
        return '<option value="' + sup.id + '" ' + sel + ">" + sup.name + "</option>";
      }).join("");

    return '<div class="assign-card">' +
      '<div class="assign-card-header">' +
      makeAvatar(s.name, "38px", ".85rem") +
      '<div class="ac-info">' +
      '<div class="ac-name">' + s.name + "</div>" +
      '<div class="ac-meta">' + (s.indexNumber || "–") + " &nbsp;·&nbsp; " + (s.department || "–") + "</div>" +
      "</div>" +
      (currentSupId ? badge("Assigned") : badge("Pending")) +
      "</div>" +
      '<div class="assign-card-body">' +
      "<label>Supervisor:</label>" +
      '<select data-student-id="' + s.id + '" class="assign-sup-select">' + opts + "</select>" +
      '<input type="text" data-student-id="' + s.id + '" class="assign-title-input" ' +
      'placeholder="Project title (optional)" value="' + currentTitle.replace(/"/g, "&quot;") + '" style="flex:1;min-width:180px;" />' +
      '<button class="btn btn-primary btn-sm" data-save-id="' + s.id + '"><i class="fa-solid fa-floppy-disk"></i> Save</button>' +
      "</div></div>";
  }).join("");

  listEl.querySelectorAll("button[data-save-id]").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      var sid       = btn.dataset.saveId;
      var select     = listEl.querySelector('.assign-sup-select[data-student-id="' + sid + '"]');
      var titleInput = listEl.querySelector('.assign-title-input[data-student-id="' + sid + '"]');
      var supId  = select.value;
      var title  = titleInput.value.trim();

      if (!supId) { showToast("Please select a supervisor first.", "warning"); return; }

      btn.disabled = true;
      var original = btn.innerHTML;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

      try {
        var payload = { studentId: sid, supervisorId: supId };
        if (title) payload.title = title;
        await Api.post("/projects/assign-supervisor", payload);
        showToast("Supervisor assigned successfully.", "success");
        await initAssign();
      } catch (err) {
        apiErrorToast(err, "Could not assign supervisor.");
        btn.disabled = false;
        btn.innerHTML = original;
      }
    });
  });
}

function renderWorkload(supervisors, projects) {
  var wlEl = document.getElementById("workloadList");
  if (!wlEl) return;

  if (supervisors.length === 0) {
    wlEl.innerHTML = '<div class="empty-state"><i class="fa-solid fa-chalkboard-user"></i><p>No supervisors yet.</p></div>';
    return;
  }

  wlEl.innerHTML = supervisors.map(function (sup) {
    var count = projects.filter(function (p) { return String(p.supervisorId) === String(sup.id); }).length;
    return '<div class="workload-item">' +
      makeAvatar(sup.name, "32px", ".75rem") +
      '<span class="wi-name">' + sup.name + "</span>" +
      '<span class="wi-count">' + count + " student" + (count !== 1 ? "s" : "") + "</span>" +
      "</div>";
  }).join("");
}

/* ══════════════════════════════════════
   4. GENERATE REPORTS  (reports.html)
══════════════════════════════════════ */
async function initReports() {
  var progressCard   = document.getElementById("reportProgress");
  var workloadCard    = document.getElementById("reportWorkload");
  var completionCard  = document.getElementById("reportCompletion");

  if (progressCard)   progressCard.addEventListener("click",  function () { scrollToSection("projectsSection"); });
  if (workloadCard)   workloadCard.addEventListener("click",  function () { scrollToSection("workloadSection"); });
  if (completionCard) completionCard.addEventListener("click",function () { scrollToSection("completionSection"); });

  function scrollToSection(id) {
    var el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* The export is an authenticated stream, not a link — the reports
     routes are admin-only and a plain <a href> carries no token. One
     download at a time, and the button says so while it runs: these
     queries cover every project in the system and a second click
     would just start the same work again. */
  var downloading = false;

  document.querySelectorAll("[data-export]").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      if (downloading) return;
      downloading = true;

      var original = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Preparing…';

      try {
        var name = await Api.download(
          "/reports/export/" + btn.dataset.export,
          btn.dataset.export + "-report.csv"
        );
        showToast("Downloaded " + name, "success", 4000);
      } catch (err) {
        apiErrorToast(err, "Could not download that report.");
      } finally {
        downloading = false;
        btn.disabled = false;
        btn.innerHTML = original;
      }
    });
  });

  try {
    var results = await Promise.all([
      Api.get("/reports/summary"),
      Api.get("/reports/completion"),
      Api.get("/reports/projects"),
      Api.get("/reports/workload"),
    ]);

    var summary    = results[0].summary || {};
    var completion = results[1].report  || [];
    var projects   = results[2].report  || [];
    var workload   = results[3].report  || [];

    var summaryEl = document.getElementById("systemSummary");
    if (summaryEl) {
      var rows = [
        { label: "Total Students",            value: summary.totalStudents },
        { label: "Total Supervisors",         value: summary.totalSupervisors },
        { label: "Total Projects",            value: summary.totalProjects },
        { label: "Projects In Progress",      value: summary.projectsInProgress },
        { label: "Projects Completed",        value: summary.projectsCompleted },
        { label: "Total Chapter Submissions", value: summary.totalSubmissions },
        { label: "Approved Submissions",      value: summary.approvedSubmissions },
        { label: "Total Feedback Given",      value: summary.totalFeedbackGiven },
      ];
      summaryEl.innerHTML = rows.map(function (r) {
        return '<div class="report-stat-row"><span class="rs-label">' + r.label + '</span><span class="rs-value">' + (r.value != null ? r.value : "–") + "</span></div>";
      }).join("");
    }

    var compTbody = document.getElementById("reportCompletionTable");
    if (compTbody) {
      compTbody.innerHTML = completion.length === 0
        ? '<tr><td colspan="3" class="text-center text-gray-600" style="padding:24px;">No projects yet.</td></tr>'
        : completion.map(function (c) {
            return "<tr><td>" + badge(c.status) + "</td><td>" + c.count + "</td><td>" + c.percent + "%</td></tr>";
          }).join("");
    }

    var projTbody = document.getElementById("reportProjectTable");
    if (projTbody) {
      projTbody.innerHTML = projects.length === 0
        ? '<tr><td colspan="6" class="text-center text-gray-600" style="padding:24px;">No projects yet.</td></tr>'
        : projects.map(function (p) {
            return "<tr><td>" + p.studentName + "</td><td>" + Utils.truncate(p.title, 50) + "</td><td>" + p.supervisorName + "</td>" +
              "<td><div style='display:flex;align-items:center;gap:8px;'><div class='progress-track' style='width:100px;'>" +
              "<div class='progress-fill blue' style='width:" + p.completionPercent + "%;'></div></div>" +
              "<span style='font-size:var(--font-size-xs);font-weight:700;'>" + p.completionPercent + "%</span></div></td>" +
              "<td>" + badge(p.status) + "</td><td>" + (p.deadline ? Utils.shortDate(p.deadline) : "–") + "</td></tr>";
          }).join("");
    }

    var wlTbody = document.getElementById("reportWorkloadTable");
    if (wlTbody) {
      wlTbody.innerHTML = workload.length === 0
        ? '<tr><td colspan="5" class="text-center text-gray-600" style="padding:24px;">No supervisors yet.</td></tr>'
        : workload.map(function (w) {
            return "<tr><td><div style='display:flex;align-items:center;gap:8px;'>" + makeAvatar(w.name, "28px", "0.65rem") + w.name + "</div></td>" +
              "<td>" + w.department + "</td><td>" + w.studentsAssigned + "</td>" +
              "<td>" + (w.pendingReviews > 0 ? w.pendingReviews + " pending" : "–") + "</td>" +
              "<td>" + w.avgProgress + "%</td></tr>";
          }).join("");
    }
  } catch (err) {
    apiErrorToast(err, "Could not load reports.");
  }
}

/* ══════════════════════════════════════
   NOTIFICATIONS PAGE (system-wide for admin)
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
        try {
          await Api.patch("/notifications/" + item.dataset.id + "/read");
          var n = notifs.find(function (x) { return String(x.id) === item.dataset.id; });
          if (n) n.read = true;
          item.classList.remove("unread");
        } catch (err) { /* non-fatal */ }
      });
    });
  }

  async function load() {
    try {
      /* The administrator sees their own notifications, the same as
         everyone else. This used to request ?scope=all, which
         returned every notification in the system — private
         messages addressed to individual students and supervisors. */
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
      await load();
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
  document.getElementById("profileId").textContent   = user.staffId || "Administrator";

  document.getElementById("profileFullName").value = user.name;
  document.getElementById("profileEmail").value    = user.email;
  document.getElementById("profileStaffId").value  = user.staffId || "";
  document.getElementById("profileDept").value     = user.department || "";

  var saveBtn = document.getElementById("saveProfileBtn");
  if (saveBtn) {
    saveBtn.addEventListener("click", async function () {
      var fullName = document.getElementById("profileFullName").value.trim();
      var parts = fullName.split(" ");
      var firstName = parts.shift() || fullName;
      var lastName  = parts.join(" ") || firstName;

      try {
        var res = await Api.put("/users/" + user.id, { firstName: firstName, lastName: lastName });
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
  var user = initApp("admin");
  if (!user) return;

  var page = currentPage();
  if      (page === "dashboard.html")     await initDashboard(user);
  else if (page === "users.html")         await initUsers(user);
  else if (page === "projects.html")      await initProjects();
  else if (page === "assign.html")        await initAssign(user);
  else if (page === "reports.html")       await initReports();
  else if (page === "notifications.html") await initNotifications(user);
  else if (page === "profile.html")       await initProfile(user);
});