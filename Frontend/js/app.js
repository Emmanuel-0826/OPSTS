/* ============================================================
   js/app.js — Shared App Bootstrap
   Handles: session guard, sidebar population, logout,
            notification badges, nav link wiring, toast,
            sidebar collapse/minimize toggle
============================================================ */

"use strict";

/* ══════════════════════════════════════
   SESSION GUARD
   Call on every protected page to ensure
   the user is logged in with the right role.
══════════════════════════════════════ */
function requireAuth(expectedRole) {
  var user  = Utils.getSession();
  var token = Utils.getToken();

  if (!user || !token) {
    window.location.href = "../../index.html";
    return null;
  }

  if (expectedRole && user.role !== expectedRole) {
    window.location.href = "../../index.html";
    return null;
  }

  return user;
}

/* ══════════════════════════════════════
   AVATAR COLOUR HELPER
══════════════════════════════════════ */
function avatarColor(initials) {
  var palette = [
    "#1a73e8", "#34a853", "#ea4335", "#fbbc04",
    "#0d47a1", "#00897b", "#e65100", "#6a1b9a"
  ];
  return palette[initials.charCodeAt(0) % palette.length];
}

/* ══════════════════════════════════════
   POPULATE SIDEBAR USER STRIP
══════════════════════════════════════ */
function populateSidebar(user) {
  var avatarEl = document.getElementById("sideAvatar");
  var nameEl   = document.getElementById("sideUserName");
  var metaEl   = document.getElementById("sideUserMeta");

  if (!avatarEl || !nameEl || !metaEl) return;

  var initials = Utils.initials(user.name);
  avatarEl.textContent      = initials;
  avatarEl.style.background = avatarColor(initials);
  avatarEl.style.width      = "36px";
  avatarEl.style.height     = "36px";
  avatarEl.style.fontSize   = "0.85rem";

  nameEl.textContent = user.name;
  metaEl.textContent = Utils.titleCase(user.role) +
    (user.department ? " · " + user.department.split(" ")[0] : "");
}

/* ══════════════════════════════════════
   NOTIFICATION BADGES (legacy/manual use —
   NotificationSystem in notifications.js is the
   real-time source of truth; this stays for
   any page that hasn't loaded that script)
══════════════════════════════════════ */
function updateNotifBadges(userId) {
  if (typeof DB === "undefined" || !DB.getUnreadCount) return;
  var count = DB.getUnreadCount(userId);
  var badge = document.getElementById("ntfBadge");
  var dot   = document.getElementById("ntfDot");

  if (badge) {
    if (count > 0) { badge.textContent = count; badge.classList.remove("hidden"); }
    else badge.classList.add("hidden");
  }
  if (dot) {
    if (count > 0) dot.classList.remove("hidden");
    else dot.classList.add("hidden");
  }
}

/* ══════════════════════════════════════
   SIDEBAR NAV LINKS
   Navigates to sibling page files.
══════════════════════════════════════ */
function initNavLinks() {
  var items = document.querySelectorAll(".nav-item[data-page]");
  items.forEach(function (item) {
    item.addEventListener("click", function () {
      var page = item.dataset.page;
      if (page) window.location.href = page;
    });
  });
}

/* ══════════════════════════════════════
   TOPBAR QUICK BUTTONS
══════════════════════════════════════ */
function initTopbarButtons() {
  var profileBtn = document.getElementById("profileBtn");
  if (profileBtn) {
    profileBtn.addEventListener("click", function () {
      window.location.href = "profile.html";
    });
  }
  /* notifBtn's click behaviour (open/close the dropdown) is wired
     by NotificationSystem in notifications.js. Deliberately NOT
     attaching a second "navigate away" handler here — the two
     used to fight each other and the bell would misbehave. */
}

/* ══════════════════════════════════════
   LOGOUT
══════════════════════════════════════ */
function initLogout() {
  var btn = document.getElementById("logoutBtn");
  if (!btn) return;

  btn.addEventListener("click", function () {
    if (window.confirm("Are you sure you want to sign out?")) {
      Utils.logout();
    }
  });
}

/* ══════════════════════════════════════
   TOAST
   Uses innerHTML (not textContent) since many callers pass
   Font Awesome icon markup inside the message string.
══════════════════════════════════════ */
function showToast(message, type, duration) {
  type     = type     || "info";
  duration = duration || 3500;

  var container = document.getElementById("toast-container");
  if (!container) return;

  var toast = document.createElement("div");
  toast.className = "toast toast-" + type;
  toast.innerHTML = message;
  container.appendChild(toast);

  setTimeout(function () { toast.style.opacity = "0"; }, duration);
  setTimeout(function () {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, duration + 350);
}

/* ══════════════════════════════════════
   MODAL HELPERS
══════════════════════════════════════ */
function openModal(id) {
  var el = document.getElementById(id);
  if (el) el.classList.add("open");
}

function closeModal(id) {
  var el = document.getElementById(id);
  if (el) el.classList.remove("open");
}

function initModalBackdrops() {
  var overlays = document.querySelectorAll(".modal-overlay");
  overlays.forEach(function (overlay) {
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) overlay.classList.remove("open");
    });
  });
}

/* ══════════════════════════════════════
   SIDEBAR COLLAPSE / MINIMIZE TOGGLE
   Injects a small toggle button into the sidebar-brand area
   (no HTML changes needed on any page) that shrinks the sidebar
   to icon-only width. Preference persists for the session.
══════════════════════════════════════ */
function initSidebarToggle() {
  var sidebar = document.querySelector(".sidebar");
  var brand   = document.querySelector(".sidebar-brand");
  if (!sidebar || !brand || brand.querySelector(".sidebar-toggle-btn")) return;

  brand.style.position = "relative";

  var toggleBtn = document.createElement("button");
  toggleBtn.className = "sidebar-toggle-btn";
  toggleBtn.title = "Toggle sidebar";
  brand.appendChild(toggleBtn);

  var collapsed = sessionStorage.getItem("opsts_sidebar_collapsed") === "1";
  applyState(collapsed);

  toggleBtn.addEventListener("click", function () {
    collapsed = !collapsed;
    sessionStorage.setItem("opsts_sidebar_collapsed", collapsed ? "1" : "0");
    applyState(collapsed);
  });

  function applyState(isCollapsed) {
    sidebar.classList.toggle("collapsed", isCollapsed);
    document.documentElement.style.setProperty("--sidebar-width", isCollapsed ? "68px" : "250px");
    toggleBtn.innerHTML = isCollapsed
      ? '<i class="fa-solid fa-angles-right"></i>'
      : '<i class="fa-solid fa-angles-left"></i>';
  }
}

/* ══════════════════════════════════════
   INITIAL-PASSWORD PROMPT
   The API sets user.mustChangePassword while an account still uses a
   password someone else chose for it — the default administrator
   seeded on first boot, or an account an admin created with a
   generated password. Both are known to more people than the owner,
   so prompt until it's replaced. The flag clears server-side on the
   next successful password change.
══════════════════════════════════════ */
function warnIfDefaultPassword(user) {
  if (!user || !user.mustChangePassword) return;

  /* Once per browser session, not once per page view — a banner on
     every navigation stops being read. */
  if (sessionStorage.getItem("opsts_pw_warned") === "1") return;
  sessionStorage.setItem("opsts_pw_warned", "1");

  var onProfile = window.location.pathname.indexOf("profile.html") !== -1;

  setTimeout(function () {
    if (typeof showToast !== "function") return;
    showToast(
      '<i class="fa-solid fa-triangle-exclamation"></i> ' +
        "You are signed in with an initial password." +
        (onProfile ? " Set a new one below." : " Please change it in My Profile."),
      "warning",
      9000
    );
  }, 700);
}

/* ══════════════════════════════════════
   SHARED APP INIT
   Called by every portal page's own JS
   after role-specific setup.
══════════════════════════════════════ */
function initApp(expectedRole) {
  var user = requireAuth(expectedRole);
  if (!user) return null;

  populateSidebar(user);
  initNavLinks();
  initTopbarButtons();
  initLogout();
  initModalBackdrops();
  initSidebarToggle();
  warnIfDefaultPassword(user);

  /* Real-time notifications: fetches unread count + list from the
     API and keeps the bell badge / dropdown in sync (see notifications.js) */
  if (typeof NotificationSystem !== "undefined") {
    NotificationSystem.init(user.id);
  }

  return user;
}