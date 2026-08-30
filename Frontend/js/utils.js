/* =============================================================
   js/utils.js  –  Shared Helper / Utility Functions for OPSTS
   Used by student.js, supervisor.js, admin.js, notifications.js
============================================================= */

"use strict";

const Utils = {

  // ─────────────────────────────────────────
  // AVATAR PALETTE
  // ─────────────────────────────────────────

  /**
   * The colours initials-avatars are drawn from, picked to sit
   * with the indigo/violet UI palette and to keep white initials
   * legible on every entry.
   *
   * This is the single source of truth: app.js, student.js,
   * supervisor.js and admin.js all read it. Each of them used to
   * carry its own copy, which meant the same person could show up
   * in a different colour depending on which portal you were in.
   * Order matters — the index is derived from the initials, so
   * reordering reassigns everybody's colour.
   */
  AVATAR_PALETTE: [
    "#4f46e5", "#7c3aed", "#0284c7", "#0891b2",
    "#059669", "#c2410c", "#dc2626", "#be185d",
  ],

  /** Deterministic colour for a set of initials. */
  avatarColor(initials) {
    const key = (initials && initials.length) ? initials : "?";
    return this.AVATAR_PALETTE[key.charCodeAt(0) % this.AVATAR_PALETTE.length];
  },


  // ─────────────────────────────────────────
  // DATE & TIME
  // ─────────────────────────────────────────

  /** Format "2025-04-20" → "April 20, 2025" */
  formatDate(dateStr) {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  },

  /** Format "2025-04-20 10:45" → "Apr 20, 2025 · 10:45 AM" */
  formatDateTime(dateTimeStr) {
    if (!dateTimeStr) return "—";
    const d = new Date(dateTimeStr.replace(" ", "T"));
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
      + " · "
      + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  },

  /** Days remaining until a date. Negative = overdue. */
  daysUntil(dateStr) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(dateStr);
    return Math.round((target - today) / (1000 * 60 * 60 * 24));
  },

  /** "2025-04-20" → "20 Apr 2025" short label */
  shortDate(dateStr) {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  },

  /** Returns a relative time string like "2 days ago", "just now" */
  timeAgo(dateTimeStr) {
    const past = new Date(dateTimeStr.replace(" ", "T"));
    const diff = Math.floor((Date.now() - past) / 1000);
    if (diff < 60)    return "just now";
    if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  },


  // ─────────────────────────────────────────
  // STRING HELPERS
  // ─────────────────────────────────────────

  /** Capitalise first letter of each word */
  titleCase(str) {
    return str.replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
  },

  /** Get initials from full name, e.g. "Kwame Mensah" → "KM" */
  initials(name) {
    return name.split(" ").map(p => p[0]).join("").toUpperCase().slice(0, 2);
  },

  /** Truncate long text */
  truncate(str, maxLen = 80) {
    return str.length > maxLen ? str.slice(0, maxLen) + "…" : str;
  },

  /** Format file size bytes → "1.2 MB" */
  formatFileSize(bytes) {
    if (bytes < 1024)        return bytes + " B";
    if (bytes < 1048576)     return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1048576).toFixed(1) + " MB";
  },


  // ─────────────────────────────────────────
  // STATUS BADGES
  // ─────────────────────────────────────────

  /**
   * Returns an HTML <span> badge for a given status string.
   * Covers submission status, milestone status, project status.
   */
  badge(status) {
    const map = {
      "Approved":       { cls: "badge-success",  icon: '<i class="fa-solid fa-circle-check"></i>' },
      "Completed":      { cls: "badge-success",  icon: '<i class="fa-solid fa-circle-check"></i>' },
      "In Progress":    { cls: "badge-primary",  icon: '<i class="fa-solid fa-arrows-rotate"></i>' },
      "Under Review":   { cls: "badge-warning",  icon: '<i class="fa-solid fa-eye"></i>' },
      "Needs Revision": { cls: "badge-danger",   icon: '<i class="fa-solid fa-pen"></i>' },
      "Pending":        { cls: "badge-secondary",icon: '<i class="fa-solid fa-hourglass-half"></i>' },
      "Rejected":       { cls: "badge-danger",   icon: '<i class="fa-solid fa-circle-xmark"></i>' },
      "Upcoming":       { cls: "badge-primary",  icon: '<i class="fa-solid fa-calendar-days"></i>' },
      "Active":         { cls: "badge-success",  icon: '<i class="fa-solid fa-circle-check"></i>' },
      "Assigned":       { cls: "badge-success",  icon: '<i class="fa-solid fa-link"></i>' },
      "Unassigned":     { cls: "badge-warning",  icon: '<i class="fa-solid fa-triangle-exclamation"></i>' },
    };
    const b = map[status] || { cls: "badge-secondary", icon: "•" };
    return `<span class="badge ${b.cls}">${b.icon} ${status}</span>`;
  },

  /** Icon for notification type (Font Awesome) */
  notifIcon(type) {
    const icons = {
      feedback:   '<i class="fa-solid fa-comments"></i>',
      meeting:    '<i class="fa-solid fa-calendar-days"></i>',
      deadline:   '<i class="fa-solid fa-clock"></i>',
      submission: '<i class="fa-solid fa-upload"></i>',
      approval:   '<i class="fa-solid fa-circle-check"></i>',
      system:     '<i class="fa-solid fa-bell"></i>',
    };
    return icons[type] || '<i class="fa-solid fa-bell"></i>';
  },

  // ─────────────────────────────────────────
  // ESCAPING
  // Most of this app renders with innerHTML from strings the
  // portal scripts concatenate, and a good half of what goes into
  // those strings is typed by a user — project titles, meeting
  // agendas, chapter labels, notification text built from names.
  // Anything interpolated into markup goes through here first.
  // ─────────────────────────────────────────

  /** HTML-escape a value for interpolation into markup. */
  escapeHtml(value) {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return String(value === null || value === undefined ? "" : value)
      .replace(/[&<>"']/g, (c) => map[c]);
  },

  /**
   * A URL that is safe to put in an href, or null.
   *
   * Meeting join links are pasted in by supervisors, so they can be
   * anything at all — including `javascript:`, which in an
   * innerHTML-built anchor is a script that runs in this origin
   * with the signed-in user's session. Only http(s) survives.
   */
  safeUrl(value) {
    const raw = String(value === null || value === undefined ? "" : value).trim();
    if (!raw) return null;
    try {
      const parsed = new URL(raw, window.location.href);
      return (parsed.protocol === "http:" || parsed.protocol === "https:")
        ? parsed.href
        : null;
    } catch (err) {
      return null;
    }
  },


  // ─────────────────────────────────────────
  // MEETINGS
  // ─────────────────────────────────────────

  /** True for a platform that happens in a room, not a browser. */
  isInPerson(platform) {
    return /in[\s-]?person/i.test(String(platform || ""));
  },

  /**
   * The join control for a meeting card, in three honest states.
   *
   *   link present      → a real anchor: "Join Zoom"
   *   In-Person         → the location badge
   *   remote, no link   → "Link pending"
   *
   * The third state is the one that was missing. Both portals fell
   * through to the In-Person badge whenever `link` was empty, so a
   * Zoom meeting whose link had not been generated yet told the
   * student to turn up in person — for a meeting with no room.
   *
   * target=_blank without rel=noopener hands the opened tab a
   * window.opener it can navigate this one with.
   */
  meetingJoin(meeting, isPast) {
    const m = meeting || {};
    if (isPast) return this.badge("Completed");

    const platform = String(m.platform || "").trim();

    if (this.isInPerson(platform)) {
      return '<span class="badge badge-secondary">' +
        '<i class="fa-solid fa-location-dot"></i> In-Person</span>';
    }

    const href = this.safeUrl(m.link);
    if (href) {
      return '<a class="btn btn-primary btn-sm" href="' + this.escapeHtml(href) + '"' +
        ' target="_blank" rel="noopener noreferrer">' +
        '<i class="fa-solid fa-video"></i> Join ' +
        this.escapeHtml(platform || "meeting") + "</a>";
    }

    return '<span class="badge badge-warning" title="No joining link has been added to this meeting yet.">' +
      '<i class="fa-solid fa-hourglass-half"></i> Link pending</span>';
  },


  // ─────────────────────────────────────────
  // DOM HELPERS
  // ─────────────────────────────────────────

  /** Get element by ID */
  $(id) { return document.getElementById(id); },

  /** Query selector */
  $$(sel, ctx = document) { return ctx.querySelector(sel); },

  /** Query selector all → Array */
  $all(sel, ctx = document) { return [...ctx.querySelectorAll(sel)]; },

  /** Show element (remove hidden class / set display) */
  show(el) {
    const e = typeof el === "string" ? this.$(el) : el;
    if (e) e.style.display = "";
  },

  /** Hide element */
  hide(el) {
    const e = typeof el === "string" ? this.$(el) : el;
    if (e) e.style.display = "none";
  },

  /** Set inner HTML safely */
  html(id, content) {
    const el = this.$(id);
    if (el) el.innerHTML = content;
  },

  /** Set text content */
  text(id, content) {
    const el = this.$(id);
    if (el) el.textContent = content;
  },

  /** Add class to element */
  addClass(el, cls) {
    const e = typeof el === "string" ? this.$(el) : el;
    if (e) e.classList.add(cls);
  },

  /** Remove class from element */
  removeClass(el, cls) {
    const e = typeof el === "string" ? this.$(el) : el;
    if (e) e.classList.remove(cls);
  },

  /** Toggle active class on a set of sibling elements */
  setActive(items, activeEl) {
    items.forEach(i => i.classList.remove("active"));
    activeEl.classList.add("active");
  },


  // ─────────────────────────────────────────
  // PROGRESS BAR
  // ─────────────────────────────────────────

  /**
   * Renders a progress bar HTML string.
   * @param {number} pct  0–100
   * @param {string} label optional label override
   */
  progressBar(pct, label = null) {
    const clamp  = Math.min(100, Math.max(0, pct));
    const colour = clamp >= 75 ? "var(--secondary)"
                 : clamp >= 40 ? "var(--primary)"
                 : "var(--warning)";
    return `
      <div class="progress-wrap">
        <div class="progress-bar-track">
          <div class="progress-bar-fill" style="width:${clamp}%; background:${colour};"></div>
        </div>
        <span class="progress-label">${label !== null ? label : clamp + "%"}</span>
      </div>`;
  },


  // ─────────────────────────────────────────
  // AVATAR
  // ─────────────────────────────────────────

  /**
   * Returns a coloured avatar circle HTML string.
   * @param {string} initials e.g. "KM"
   * @param {string} size     CSS size e.g. "40px"
   * @param {string} bg       background color (optional)
   */
  avatar(initials, size = "40px", bg = null) {
    const col = bg || Utils.avatarColor(initials);
    return `<div class="avatar" style="width:${size};height:${size};background:${col};
            display:inline-flex;align-items:center;justify-content:center;
            color:#fff;font-weight:700;font-size:calc(${size} * 0.38);flex-shrink:0;">
              ${initials}
            </div>`;
  },


  // ─────────────────────────────────────────
  // TOAST NOTIFICATIONS
  // ─────────────────────────────────────────

  /**
   * Show a toast message on screen.
   * @param {string} msg   Message text
   * @param {string} type  "success" | "error" | "info" | "warning"
   * @param {number} dur   Duration in ms (default 3500)
   */
  toast(msg, type = "info", dur = 3500) {
    /* Prefer the shared implementation in app.js — it is the one
       the portal pages use, so both routes look identical. This
       body is the fallback for pages that never loaded app.js
       (the login screen). */
    if (typeof showToast === "function") return showToast(msg, type, dur);

    let container = document.getElementById("toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "toast-container";
      document.body.appendChild(container);
    }

    const icons = {
      success: '<i class="fa-solid fa-circle-check"></i>',
      error:   '<i class="fa-solid fa-circle-exclamation"></i>',
      warning: '<i class="fa-solid fa-triangle-exclamation"></i>',
      info:    '<i class="fa-solid fa-circle-info"></i>',
    };

    /* Styling comes from .toast / .toast-* in dashboard.css rather
       than inline hex, so the toast follows the active theme. */
    const t = document.createElement("div");
    t.className = `toast toast-${type}`;
    t.innerHTML = `${icons[type] || icons.info}<span>${msg}</span>`;
    container.appendChild(t);

    setTimeout(() => {
      t.style.opacity   = "0";
      t.style.transform = "translateX(48px) scale(0.94)";
    }, dur);
    setTimeout(() => t.remove(), dur + 350);
  },


  // ─────────────────────────────────────────
  // SESSION / AUTH
  // ─────────────────────────────────────────

  /** Save current user + JWT token to sessionStorage */
  saveSession(user, token) {
    sessionStorage.setItem("opsts_user", JSON.stringify(user));
    if (token) sessionStorage.setItem("opsts_token", token);
  },

  /** Retrieve current user from sessionStorage */
  getSession() {
    try {
      return JSON.parse(sessionStorage.getItem("opsts_user"));
    } catch { return null; }
  },

  /** Retrieve the JWT auth token from sessionStorage */
  getToken() {
    return sessionStorage.getItem("opsts_token");
  },

  /** Clear session + token and redirect to login */
  logout() {
    sessionStorage.removeItem("opsts_user");
    sessionStorage.removeItem("opsts_token");
    sessionStorage.removeItem("opsts_pw_warned");
    window.location.href = "../../index.html";
  },

  /** Redirect if not logged in, missing token, or wrong role */
  requireRole(role) {
    const user  = this.getSession();
    const token = this.getToken();
    if (!user || !token) { window.location.href = "../../index.html"; return null; }
    if (role && user.role !== role) { window.location.href = "../../index.html"; return null; }
    return user;
  },


  // ─────────────────────────────────────────
  // FORM HELPERS
  // ─────────────────────────────────────────

  /** Serialize a form into a plain object */
  serializeForm(formEl) {
    const fd = new FormData(formEl);
    const obj = {};
    fd.forEach((v, k) => { obj[k] = v; });
    return obj;
  },

  /** Simple email validator */
  isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  },

  /** Generate a simple unique ID */
  uid(prefix = "id") {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  },


  // ─────────────────────────────────────────
  // MISC
  // ─────────────────────────────────────────

  /** Debounce a function call */
  debounce(fn, delay = 300) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  },

  /** Deep clone a plain object/array (no functions) */
  clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  },

  /** Sort array of objects by a key */
  sortBy(arr, key, asc = true) {
    return [...arr].sort((a, b) => {
      if (a[key] < b[key]) return asc ? -1 : 1;
      if (a[key] > b[key]) return asc ? 1 : -1;
      return 0;
    });
  },
};