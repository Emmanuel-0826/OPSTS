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
   CONFIRM DIALOG
   window.confirm() is OS chrome: it ignores the theme, cannot be
   styled, freezes the page while it is up, and on most mobile
   browsers renders as a grey system sheet with the site's URL
   printed above the question. Signing out is the one destructive
   action on every page in the app, so it gets a real dialog built
   from the same .modal parts as every other dialog here.

   Returns a Promise<boolean>: false for Cancel, Escape, or a
   click on the backdrop.

   The dialog is created at runtime, which means a11y.js has
   already finished wiring the page's static .modal-overlay
   elements and will not see this one. Focus, the Tab trap and
   Escape are therefore handled here rather than borrowed.
══════════════════════════════════════ */
function confirmAction(options) {
  var opts         = options || {};
  var title        = opts.title || "Are you sure?";
  var message      = opts.message || "";
  var confirmLabel = opts.confirmLabel || "Confirm";
  var cancelLabel  = opts.cancelLabel || "Cancel";
  var tone         = opts.tone === "danger" ? "danger" : "primary";
  var icon         = opts.icon || "fa-circle-question";

  return new Promise(function (resolve) {
    var overlay = document.getElementById("appConfirmModal");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "appConfirmModal";
      overlay.className = "modal-overlay";
      document.body.appendChild(overlay);
    }

    overlay.innerHTML =
      '<div class="modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="appConfirmTitle" aria-describedby="appConfirmText" tabindex="-1">' +
        '<div class="modal-header">' +
          '<h2 id="appConfirmTitle">' +
            '<span class="confirm-icon confirm-icon-' + tone + '"><i class="fa-solid ' + icon + '"></i></span>' +
            Utils.escapeHtml(title) +
          "</h2>" +
        "</div>" +
        '<div class="modal-body"><p id="appConfirmText" class="confirm-text">' +
          Utils.escapeHtml(message) +
        "</p></div>" +
        '<div class="modal-footer">' +
          '<button type="button" class="btn btn-ghost" data-confirm="no">' + Utils.escapeHtml(cancelLabel) + "</button>" +
          '<button type="button" class="btn btn-' + tone + '" data-confirm="yes">' + Utils.escapeHtml(confirmLabel) + "</button>" +
        "</div>" +
      "</div>";

    var opener  = document.activeElement;
    var buttons = overlay.querySelectorAll("button[data-confirm]");
    var settled = false;

    function finish(answer) {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKey, true);
      overlay.classList.remove("open");
      /* Focus goes back to whatever opened the dialog, or a
         keyboard user restarts from the top of the document. */
      if (opener && document.contains(opener) && opener.focus) opener.focus();
      resolve(answer);
    }

    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
        return;
      }
      if (e.key !== "Tab") return;

      /* Two buttons, so the trap is just "wrap at either end". */
      var first = buttons[0];
      var last  = buttons[buttons.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        finish(btn.dataset.confirm === "yes");
      });
    });

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) finish(false);
    });

    document.addEventListener("keydown", onKey, true);
    overlay.classList.add("open");

    /* Land on the confirming button — it is what the dialog is
       for — but Cancel is one Shift+Tab away and Escape always
       works, so nothing destructive is a single stray Enter. */
    var confirmBtn = overlay.querySelector('button[data-confirm="yes"]');
    if (confirmBtn) confirmBtn.focus();
  });
}

/* ══════════════════════════════════════
   LOGOUT
══════════════════════════════════════ */
function initLogout() {
  var btn = document.getElementById("logoutBtn");
  if (!btn) return;

  btn.addEventListener("click", function () {
    confirmAction({
      title: "Sign out of OPSTS?",
      message: "You will be returned to the sign-in page. Anything you have typed but not saved will be lost.",
      confirmLabel: "Sign out",
      cancelLabel: "Stay signed in",
      tone: "danger",
      icon: "fa-right-from-bracket",
    }).then(function (confirmed) {
      if (confirmed) Utils.logout();
    });
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
   Injects a small chevron into the sidebar-brand area (no HTML
   changes needed on any page) that shrinks the sidebar to
   icon-only width. Preference persists for the session.

   Desktop only: below 1024px the sidebar is an off-canvas drawer
   opened by the hamburger below, and there is nothing to collapse.
   compat.css hides the chevron there.
══════════════════════════════════════ */
function initSidebarToggle() {
  var sidebar = document.querySelector(".sidebar");
  var brand   = document.querySelector(".sidebar-brand");
  if (!sidebar || !brand || brand.querySelector(".sidebar-toggle-btn")) return;

  if (!sidebar.id) sidebar.id = "app-sidebar";
  brand.style.position = "relative";

  var toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "sidebar-toggle-btn";
  toggleBtn.setAttribute("aria-controls", sidebar.id);
  brand.appendChild(toggleBtn);

  var collapsed = sessionStorage.getItem("opsts_sidebar_collapsed") === "1";
  applyState(collapsed);

  toggleBtn.addEventListener("click", function () {
    collapsed = !collapsed;
    sessionStorage.setItem("opsts_sidebar_collapsed", collapsed ? "1" : "0");
    applyState(collapsed);
  });

  function applyState(isCollapsed) {
    /* One state, two hooks: .collapsed on the sidebar hides the
       labels, .nav-collapsed on <html> narrows the column.

       The width itself stays in compat.css, as an override of
       --nav-width — the token .app-shell actually sizes its first
       grid column from. This used to write an inline
       --sidebar-width instead, which no rule in the stylesheet
       reads, so pressing the button changed precisely nothing. */
    sidebar.classList.toggle("collapsed", isCollapsed);
    document.documentElement.classList.toggle("nav-collapsed", isCollapsed);

    var label = isCollapsed ? "Show navigation labels" : "Hide navigation labels";
    toggleBtn.innerHTML = isCollapsed
      ? '<i class="fa-solid fa-angles-right"></i>'
      : '<i class="fa-solid fa-angles-left"></i>';
    toggleBtn.title = label;
    toggleBtn.setAttribute("aria-label", label);
    toggleBtn.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
  }
}

/* ══════════════════════════════════════
   MOBILE NAVIGATION
   Below 1024px the sidebar is an off-canvas drawer (compat.css).
   This injects the hamburger that opens it plus a tap-away scrim —
   no page markup required. The button is display:none above that
   breakpoint, where the sidebar is docked and a hamburger would
   only be a second way to do nothing.
══════════════════════════════════════ */
function initMobileNav() {
  var sidebar = document.querySelector(".sidebar");
  var left    = document.querySelector(".topbar-left");
  if (!sidebar || !left || left.querySelector(".mobile-nav-btn")) return;

  if (!sidebar.id) sidebar.id = "app-sidebar";

  var burger = document.createElement("button");
  burger.type = "button";
  burger.className = "mobile-nav-btn";
  burger.setAttribute("aria-controls", sidebar.id);
  burger.innerHTML = '<i class="fa-solid fa-bars"></i>';
  left.insertBefore(burger, left.firstChild);

  var scrim = document.querySelector(".sidebar-scrim");
  if (!scrim) {
    scrim = document.createElement("div");
    scrim.className = "sidebar-scrim";
    document.body.appendChild(scrim);
  }

  function setOpen(open) {
    sidebar.classList.toggle("mobile-open", open);
    scrim.classList.toggle("show", open);
    /* Without this the page behind keeps scrolling under the
       drawer, which reads as the drawer itself being broken. */
    document.body.classList.toggle("nav-drawer-open", open);

    burger.setAttribute("aria-expanded", open ? "true" : "false");
    var label = open ? "Close navigation" : "Open navigation";
    burger.title = label;
    burger.setAttribute("aria-label", label);
  }

  function close() { setOpen(false); }

  setOpen(false);

  burger.addEventListener("click", function (e) {
    e.stopPropagation();
    setOpen(!sidebar.classList.contains("mobile-open"));
  });

  scrim.addEventListener("click", close);

  /* Tapping a destination should dismiss the drawer, not leave it
     hanging over the page while the next one loads. */
  sidebar.querySelectorAll(".nav-item").forEach(function (item) {
    item.addEventListener("click", close);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && sidebar.classList.contains("mobile-open")) {
      close();
      burger.focus();
    }
  });

  /* Widening past the breakpoint docks the sidebar again. Leaving
     the open state behind would strand a full-screen scrim over an
     app that no longer has a drawer to dismiss. */
  window.addEventListener("resize", function () {
    if (window.innerWidth > 1024 && sidebar.classList.contains("mobile-open")) close();
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