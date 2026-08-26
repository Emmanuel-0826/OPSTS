/* ============================================================
   js/session.js — Session state and route guards
   OPSTS — GCTU

   The token lives in sessionStorage, not localStorage: closing the
   tab ends the session, which is the right default on the shared
   lab machines this is used from.

   Guards run before anything renders. Every page states what it
   requires; nothing decides for itself.
============================================================ */

"use strict";

const Session = {
  KEY_USER: "opsts_user",
  KEY_TOKEN: "opsts_token",
  /* Survives the tab so a returning user lands on the waiting room
     rather than a login form that will just refuse them again. */
  KEY_PENDING: "opsts_pending_email",

  /* ── Read ─────────────────────────────────────────────── */

  get token() {
    return sessionStorage.getItem(this.KEY_TOKEN);
  },

  get user() {
    try {
      return JSON.parse(sessionStorage.getItem(this.KEY_USER));
    } catch {
      return null;
    }
  },

  get isSignedIn() {
    return Boolean(this.token && this.user);
  },

  /* ── Write ────────────────────────────────────────────── */

  save(user, token) {
    if (user) sessionStorage.setItem(this.KEY_USER, JSON.stringify(user));
    if (token) sessionStorage.setItem(this.KEY_TOKEN, token);
  },

  /** Replace the token only — change-password issues a fresh one
      because it bumps token_version and retires the old. */
  updateToken(token) {
    if (token) sessionStorage.setItem(this.KEY_TOKEN, token);
  },

  clear() {
    sessionStorage.removeItem(this.KEY_USER);
    sessionStorage.removeItem(this.KEY_TOKEN);
  },

  /* ── Paths ────────────────────────────────────────────── */

  /** Depth-independent: pages sit at the root or two levels down. */
  get rootPrefix() {
    return location.pathname.includes("/pages/") ? "../../" : "";
  },

  homeFor(role) {
    return this.rootPrefix + (Config.home[role] || Config.home.student);
  },

  go(path) {
    location.replace(this.rootPrefix + path);
  },

  /* ── Guards ───────────────────────────────────────────── */

  /**
   * For a page inside the portal.
   *
   * @param {string|string[]} [roles] roles allowed here. Omit for
   *        any signed-in user.
   * @returns {object|null} the user, or null when a redirect has
   *          already been issued and the caller must stop.
   */
  requireAuth(roles) {
    const user = this.user;

    if (!this.isSignedIn) {
      this.go("index.html?next=" + encodeURIComponent(location.pathname));
      return null;
    }

    /* An account that has not been approved has no business inside
       the portal, and the API would refuse every call anyway. */
    if (user.status !== "active") {
      this.go("pending.html");
      return null;
    }

    /* A password someone else set is a credential the owner does
       not control. Everything is closed until they replace it. */
    if (user.mustChangePassword && !location.pathname.endsWith("change-password.html")) {
      this.go("change-password.html?forced=1");
      return null;
    }

    const allowed = roles == null ? null : [].concat(roles);
    if (allowed && !allowed.includes(user.role)) {
      /* Not an error — send them to their own portal rather than
         to a page telling them off for a link they followed. */
      location.replace(this.homeFor(user.role));
      return null;
    }

    return user;
  },

  /** For the signed-out screens: nobody signed in should see them. */
  redirectIfSignedIn() {
    if (!this.isSignedIn) return false;
    const user = this.user;
    if (user.status !== "active") {
      this.go("pending.html");
      return true;
    }
    if (user.mustChangePassword) {
      this.go("change-password.html?forced=1");
      return true;
    }
    location.replace(this.homeFor(user.role));
    return true;
  },

  /** Sign out. `reason` shows on the login screen when the session
      ended for the user rather than by their choice. */
  signOut(reason) {
    this.clear();
    const query = reason ? "?reason=" + encodeURIComponent(reason) : "";
    location.replace(this.rootPrefix + "index.html" + query);
  },
};
