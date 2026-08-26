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
  /* Delegates to Utils so every portal colours a given set of
     initials identically (see Utils.AVATAR_PALETTE). */
  return Utils.avatarColor(initials);
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
var TOAST_ICONS = {
  success: '<i class="fa-solid fa-circle-check"></i>',
  error:   '<i class="fa-solid fa-circle-exclamation"></i>',
  warning: '<i class="fa-solid fa-triangle-exclamation"></i>',
  info:    '<i class="fa-solid fa-circle-info"></i>',
};

function showToast(message, type, duration) {
  type     = type     || "info";
  duration = duration || 3500;

  var container = document.getElementById("toast-container");
  if (!container) return;

  var toast = document.createElement("div");
  toast.className = "toast toast-" + type;

  /* Lead with a status icon, but only when the caller has not
     already supplied one of their own inside the message. */
  var leadIcon = message.indexOf("<i ") === -1 ? (TOAST_ICONS[type] || "") : "";
  toast.innerHTML = leadIcon + "<span>" + message + "</span>";

  container.appendChild(toast);

  setTimeout(function () {
    toast.style.opacity   = "0";
    toast.style.transform = "translateX(48px) scale(0.94)";
  }, duration);
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

    /* Expanded is whatever --sidebar-width is defined as in
       style.css — clear the override rather than restating the
       number here, so the two cannot drift apart. */
    if (isCollapsed) {
      document.documentElement.style.setProperty("--sidebar-width", "76px");
    } else {
      document.documentElement.style.removeProperty("--sidebar-width");
    }

    toggleBtn.innerHTML = isCollapsed
      ? '<i class="fa-solid fa-angles-right"></i>'
      : '<i class="fa-solid fa-angles-left"></i>';
  }
}

/* ══════════════════════════════════════
   MOBILE NAVIGATION
   Below 768px the sidebar is translated off-screen by the
   stylesheet. Until now nothing could bring it back, so the whole
   nav was unreachable on a phone. This injects a hamburger into
   the topbar plus a tap-away scrim — no page markup required.
══════════════════════════════════════ */
function initMobileNav() {
  var sidebar = document.querySelector(".sidebar");
  var left    = document.querySelector(".topbar-left");
  if (!sidebar || !left || left.querySelector(".mobile-nav-btn")) return;

  var burger = document.createElement("button");
  burger.type = "button";
  burger.className = "mobile-nav-btn";
  burger.title = "Menu";
  burger.setAttribute("aria-label", "Open navigation");
  burger.innerHTML = '<i class="fa-solid fa-bars"></i>';
  left.insertBefore(burger, left.firstChild);

  var scrim = document.createElement("div");
  scrim.className = "sidebar-scrim";
  document.body.appendChild(scrim);

  function close() {
    sidebar.classList.remove("mobile-open");
    scrim.classList.remove("show");
  }

  burger.addEventListener("click", function (e) {
    e.stopPropagation();
    var opening = !sidebar.classList.contains("mobile-open");
    sidebar.classList.toggle("mobile-open", opening);
    scrim.classList.toggle("show", opening);
  });

  scrim.addEventListener("click", close);

  /* Tapping a destination should dismiss the drawer, not leave it
     hanging over the page while the next one loads. */
  sidebar.querySelectorAll(".nav-item").forEach(function (item) {
    item.addEventListener("click", close);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") close();
  });
}

/* ══════════════════════════════════════
   ENTRANCE CHOREOGRAPHY
   Fades the page's top-level blocks in with a short stagger so a
   dashboard assembles itself instead of appearing all at once.
══════════════════════════════════════ */
function initReveal() {
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var content = document.querySelector(".page-content");
  if (!content) return;

  var blocks = content.children;
  for (var i = 0; i < blocks.length; i++) {
    blocks[i].style.setProperty("--reveal-delay", (i * 70) + "ms");
    blocks[i].classList.add("reveal");
  }
}

/* ══════════════════════════════════════
   ANIMATED STAT COUNTERS
   The portal scripts fill .stat-val asynchronously once their API
   calls land. Rather than ask every one of them to animate, watch
   the elements and roll the number up whenever it changes.

   Non-numeric values ("–", "N/A") are left exactly as written.
══════════════════════════════════════ */
function initStatCounters() {
  var cells = document.querySelectorAll(".stat-val");
  if (!cells.length || typeof MutationObserver === "undefined") return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var NUMERIC = /^(-?\d+(?:\.\d+)?)(\D*)$/;

  /* Every write below re-enters the observer. The guard has to stay
     set for the whole animation, not just the instant of the write,
     because MutationObserver callbacks are delivered asynchronously
     — a flag cleared on the same tick is always gone by the time
     the callback actually runs, and each frame would then kick off
     a fresh roll of its own. A WeakSet keeps that state off the DOM. */
  var rolling = new WeakSet();

  function rollTo(el, target, suffix, decimals) {
    var from     = 0;
    var start    = null;
    var duration = 900;
    var settled  = false;
    var final    = target.toFixed(decimals) + suffix;

    rolling.add(el);

    /* Safety net. requestAnimationFrame does not fire while the tab
       is in the background, so a dashboard opened in a background
       tab would otherwise freeze mid-count and leave a partial
       number on screen for good. Timers still run there, so this
       guarantees the cell ends up showing the real value. */
    var failsafe = setTimeout(function () { finish(); }, duration + 600);

    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(failsafe);
      el.textContent = final;
      /* Release only after the observer has drained this last
         write, or it would read it as a fresh value and restart. */
      setTimeout(function () { rolling.delete(el); }, 0);
    }

    function step(now) {
      if (settled) return;

      if (start === null) start = now;
      var t = Math.min((now - start) / duration, 1);

      if (t >= 1) { finish(); return; }

      var eased = 1 - Math.pow(1 - t, 3); /* ease-out cubic */
      el.textContent = (from + (target - from) * eased).toFixed(decimals) + suffix;
      requestAnimationFrame(step);
    }

    requestAnimationFrame(step);
  }

  var observer = new MutationObserver(function (records) {
    records.forEach(function (record) {
      var el = record.target.nodeType === 3 ? record.target.parentNode : record.target;
      if (!el || !el.classList || !el.classList.contains("stat-val")) return;
      if (rolling.has(el)) return; /* our own frame-by-frame writes */

      var text = (el.textContent || "").trim();
      if (el.dataset.counted === text) return;

      var match = NUMERIC.exec(text);
      if (!match) {
        delete el.dataset.counted; /* "–" while loading, then a real number */
        return;
      }

      var target   = parseFloat(match[1]);
      var suffix   = match[2] || "";
      var decimals = (match[1].split(".")[1] || "").length;

      el.dataset.counted = text;
      rollTo(el, target, suffix, decimals);
    });
  });

  cells.forEach(function (cell) {
    observer.observe(cell, { childList: true, characterData: true, subtree: true });
  });
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
  initMobileNav();
  initReveal();
  initStatCounters();
  warnIfDefaultPassword(user);

  /* Real-time notifications: fetches unread count + list from the
     API and keeps the bell badge / dropdown in sync (see notifications.js) */
  if (typeof NotificationSystem !== "undefined") {
    NotificationSystem.init(user.id);
  }

  return user;
}