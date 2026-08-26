/* ============================================================
   js/theme.js — Light / dark
   OPSTS — GCTU

   Loaded in <head>, before the stylesheet paints. Anything later
   and a dark-mode user gets a white flash on every navigation.

   With no stored choice nothing is written at all, which is what
   lets the OS preference apply — see the @media block in
   src/tokens.css.
============================================================ */

(function () {
  "use strict";

  var KEY = "opsts-theme";

  try {
    var stored = localStorage.getItem(KEY);
    if (stored === "dark" || stored === "light") {
      document.documentElement.setAttribute("data-theme", stored);
    }
  } catch (e) {
    /* Private mode, or storage blocked. The OS preference still
       works, so there is nothing to recover from. */
  }

  window.Theme = {
    get current() {
      return document.documentElement.getAttribute("data-theme") || "system";
    },

    /** What the user actually sees right now. */
    get resolved() {
      var explicit = document.documentElement.getAttribute("data-theme");
      if (explicit) return explicit;
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    },

    set: function (value) {
      var root = document.documentElement;

      /* Suppress transitions across the swap. Without this, any
         property that transitions a var() keeps its old computed
         colour and never re-resolves — see base.css. */
      root.setAttribute("data-theme-switching", "");
      /* Force the suppression to apply before the tokens change. */
      void root.offsetHeight;

      if (value === "system") {
        root.removeAttribute("data-theme");
        try {
          localStorage.removeItem(KEY);
        } catch (e) {}
      } else {
        root.setAttribute("data-theme", value);
        try {
          localStorage.setItem(KEY, value);
        } catch (e) {}
      }

      /* Two frames: one for the new tokens to paint, one to hand
         transitions back before anything else can change. */
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          root.removeAttribute("data-theme-switching");
        });
      });
    },

    toggle: function () {
      this.set(this.resolved === "dark" ? "light" : "dark");
      return this.resolved;
    },
  };
})();
