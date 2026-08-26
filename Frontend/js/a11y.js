/* ============================================================
   js/a11y.js — Accessibility Layer
   OPSTS – Online Project Supervision & Tracking System

   The static markup was upgraded in place (real <button>s for the
   sidebar, tabs and role pickers; landmarks; one <h1> per page).
   What that cannot cover is everything the portal scripts render
   at runtime — notification rows, student cards, department tabs,
   modal dialogs — and the ARIA state that has to move whenever
   those scripts toggle an "active" or "selected" class.

   This file closes that gap. It is presentation/assistive only:
   it never calls the API, never touches session state, and every
   behaviour degrades to "exactly as before" if it is removed.

   Covers:
     - Skip link to the main region
     - Dialog semantics for .modal-overlay: role, focus trap,
       Escape to close, focus restored to the opener
     - Keyboard operability for runtime-rendered clickable rows
     - ARIA state mirrored from the class names the scripts set
     - Roving tabindex for the login tablist and role radiogroups
     - Required-field marking and on-blur validity
     - Toast region announced politely
============================================================ */

"use strict";

var A11y = (function () {

  /* Elements the portal scripts render as clickable <div>s.
     Each becomes focusable and answers to Enter/Space. */
  var CLICKABLE = [
    ".notif-item",
    ".ntf-drop-item",
    ".student-summary-card",
    ".dept-tab",
    ".activity-item[data-page]",
  ].join(",");

  var FOCUSABLE = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled]):not([type=hidden])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
  ].join(",");

  /* ══════════════════════════════════════
     SKIP LINK
     First tab stop on the page. The sidebar is ~10 links deep, so
     without this a keyboard or screen-reader user walks the whole
     nav again on every single page load.
  ══════════════════════════════════════ */
  function initSkipLink() {
    var target = document.getElementById("main-content");
    if (!target || document.querySelector(".skip-link")) return;

    var link = document.createElement("a");
    link.className = "skip-link";
    link.href = "#main-content";
    link.textContent = "Skip to main content";

    link.addEventListener("click", function (e) {
      e.preventDefault();
      target.focus();
      target.scrollIntoView();
    });

    document.body.insertBefore(link, document.body.firstChild);
  }

  /* ══════════════════════════════════════
     LIVE REGIONS
     Toasts are the app's main feedback channel. Without a live
     region they are silent to a screen reader — the user gets no
     confirmation that a submission or save actually happened.
  ══════════════════════════════════════ */
  function initLiveRegions() {
    var toasts = document.getElementById("toast-container");
    if (toasts && !toasts.getAttribute("role")) {
      toasts.setAttribute("role", "status");
      toasts.setAttribute("aria-live", "polite");
      toasts.setAttribute("aria-atomic", "false");
    }
  }

  /* ══════════════════════════════════════
     DIALOGS
     Every modal is opened by a page script doing
     classList.add("open"), so watching the class is the one hook
     that catches all of them without editing four other files.
  ══════════════════════════════════════ */
  var _lastFocused = null;

  function _focusables(root) {
    return Array.prototype.filter.call(
      root.querySelectorAll(FOCUSABLE),
      function (el) { return el.offsetParent !== null || el === document.activeElement; }
    );
  }

  function _openDialog(overlay) {
    var dialog = overlay.querySelector(".modal");
    if (!dialog) return;

    _lastFocused = document.activeElement;

    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("tabindex", "-1");

    /* Name the dialog from its own heading. */
    var heading = dialog.querySelector(".modal-header h1, .modal-header h2, .modal-header h3");
    if (heading) {
      if (!heading.id) heading.id = "dlg-title-" + Math.random().toString(36).slice(2, 8);
      dialog.setAttribute("aria-labelledby", heading.id);
    }

    /* The page behind is inert to a screen reader while the
       dialog is up, so it cannot be browsed by accident. */
    var shell = document.querySelector(".app-shell");
    if (shell) shell.setAttribute("aria-hidden", "true");

    var first = _focusables(dialog)[0];
    (first || dialog).focus();
  }

  function _closeDialog() {
    var shell = document.querySelector(".app-shell");
    if (shell) shell.removeAttribute("aria-hidden");

    /* Send focus back where it came from, or the trigger is lost
       and the user restarts from the top of the document. */
    if (_lastFocused && document.contains(_lastFocused)) _lastFocused.focus();
    _lastFocused = null;
  }

  function _openOverlay() {
    var open = document.querySelectorAll(".modal-overlay.open");
    return open.length ? open[open.length - 1] : null;
  }

  function initDialogs() {
    var overlays = document.querySelectorAll(".modal-overlay");
    if (!overlays.length) return;

    var observer = new MutationObserver(function (records) {
      records.forEach(function (record) {
        var overlay = record.target;
        if (!overlay.classList || !overlay.classList.contains("modal-overlay")) return;

        var isOpen = overlay.classList.contains("open");
        var was = overlay.dataset.a11yOpen === "1";
        if (isOpen === was) return;

        overlay.dataset.a11yOpen = isOpen ? "1" : "0";
        if (isOpen) _openDialog(overlay);
        else _closeDialog();
      });
    });

    Array.prototype.forEach.call(overlays, function (overlay) {
      overlay.dataset.a11yOpen = overlay.classList.contains("open") ? "1" : "0";
      observer.observe(overlay, { attributes: true, attributeFilter: ["class"] });
    });

    document.addEventListener("keydown", function (e) {
      var overlay = _openOverlay();
      if (!overlay) return;

      /* Escape closes — previously the only way out was the mouse. */
      if (e.key === "Escape") {
        e.preventDefault();
        overlay.classList.remove("open");
        return;
      }

      /* Trap Tab inside the dialog. */
      if (e.key !== "Tab") return;

      var dialog = overlay.querySelector(".modal");
      if (!dialog) return;

      var items = _focusables(dialog);
      if (!items.length) return;

      var first = items[0];
      var last = items[items.length - 1];

      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  /* ══════════════════════════════════════
     RUNTIME-RENDERED CLICKABLE ROWS
     The portal scripts emit these as plain <div>s with a click
     handler. Rather than rewrite four render functions, give the
     elements the role and key handling they are missing.
  ══════════════════════════════════════ */
  function enhanceClickables(root) {
    var nodes = (root || document).querySelectorAll(CLICKABLE);

    Array.prototype.forEach.call(nodes, function (el) {
      if (el.dataset.a11yKeyed === "1") return;
      el.dataset.a11yKeyed = "1";

      /* A real <button> already has all of this. */
      if (el.tagName === "BUTTON" || el.tagName === "A") return;

      el.setAttribute("tabindex", "0");
      if (!el.getAttribute("role")) el.setAttribute("role", "button");

      el.addEventListener("keydown", function (e) {
        if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
        e.preventDefault();  /* Space would otherwise scroll the page */
        el.click();
      });
    });
  }

  /* ══════════════════════════════════════
     ARIA STATE ↔ CLASS NAMES
     auth.js / admin.js flip .active and .selected directly. Those
     classes are what the eye reads; these attributes are what a
     screen reader reads, and they have to agree.
  ══════════════════════════════════════ */
  function syncAriaState(root) {
    var scope = root || document;

    Array.prototype.forEach.call(scope.querySelectorAll('[role="tab"]'), function (el) {
      el.setAttribute("aria-selected", el.classList.contains("active") ? "true" : "false");
      el.tabIndex = el.classList.contains("active") ? 0 : -1;
    });

    Array.prototype.forEach.call(scope.querySelectorAll('[role="radio"]'), function (el) {
      var on = el.classList.contains("selected");
      el.setAttribute("aria-checked", on ? "true" : "false");
      el.tabIndex = on ? 0 : -1;
    });

    Array.prototype.forEach.call(scope.querySelectorAll(".role-filter-tab, .dept-tab"), function (el) {
      el.setAttribute("aria-pressed", el.classList.contains("active") ? "true" : "false");
    });

    Array.prototype.forEach.call(scope.querySelectorAll(".nav-item"), function (el) {
      if (el.classList.contains("active")) el.setAttribute("aria-current", "page");
      else el.removeAttribute("aria-current");
    });
  }

  /* ══════════════════════════════════════
     ROVING TABINDEX
     A tablist and a radiogroup are each ONE tab stop; the arrow
     keys move within them. Without this the login screen makes
     you tab through five separate controls to pick a role.
  ══════════════════════════════════════ */
  function initRovingGroups() {
    var groups = document.querySelectorAll('[role="tablist"], [role="radiogroup"]');

    Array.prototype.forEach.call(groups, function (group) {
      var isRadio = group.getAttribute("role") === "radiogroup";
      var sel = isRadio ? '[role="radio"]' : '[role="tab"]';

      group.addEventListener("keydown", function (e) {
        var items = Array.prototype.slice.call(group.querySelectorAll(sel));
        if (!items.length) return;

        var idx = items.indexOf(document.activeElement);
        if (idx === -1) return;

        var next = null;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") next = items[(idx + 1) % items.length];
        else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = items[(idx - 1 + items.length) % items.length];
        else if (e.key === "Home") next = items[0];
        else if (e.key === "End") next = items[items.length - 1];
        if (!next) return;

        e.preventDefault();
        next.focus();
        /* Both patterns select on arrow, which is what the ARIA
           authoring practices specify for a single-select group. */
        next.click();
      });
    });
  }

  /* ══════════════════════════════════════
     FORMS
     Required fields were not marked visually or programmatically,
     so neither a sighted user nor a screen reader could tell which
     ones mattered before hitting submit.
  ══════════════════════════════════════ */
  function initForms() {
    var fields = document.querySelectorAll(
      "form input[required], form select[required], form textarea[required]"
    );

    Array.prototype.forEach.call(fields, function (field) {
      field.setAttribute("aria-required", "true");

      var label = field.id ? document.querySelector('label[for="' + field.id + '"]') : null;
      if (label && !label.querySelector(".req")) {
        var star = document.createElement("span");
        star.className = "req";
        star.textContent = "*";
        /* The asterisk is decorative; aria-required carries the
           meaning, so it is not read out twice. */
        star.setAttribute("aria-hidden", "true");
        label.appendChild(star);
      }

      /* Validate on blur, never while typing — flagging a field as
         invalid halfway through the first keystroke is hostile. */
      field.addEventListener("blur", function () {
        if (!field.value.trim()) field.setAttribute("aria-invalid", "true");
        else field.removeAttribute("aria-invalid");
      });

      field.addEventListener("input", function () {
        if (field.getAttribute("aria-invalid") === "true" && field.value.trim()) {
          field.removeAttribute("aria-invalid");
        }
      });
    });
  }

  /* ══════════════════════════════════════
     WATCH FOR RENDERED CONTENT
     Everything above runs once at load, but most of the app's rows
     arrive later, after their API call resolves.
  ══════════════════════════════════════ */
  function watch() {
    if (typeof MutationObserver === "undefined") return;

    var pending = false;
    var observer = new MutationObserver(function () {
      if (pending) return;
      pending = true;
      /* Coalesce a burst of renders into one pass. */
      setTimeout(function () {
        pending = false;
        enhanceClickables(document);
        syncAriaState(document);
      }, 0);
    });

    observer.observe(document.body, { childList: true, subtree: true, attributeFilter: ["class"] });
  }

  /* ══════════════════════════════════════
     INIT
  ══════════════════════════════════════ */
  function init() {
    initSkipLink();
    initLiveRegions();
    initDialogs();
    initRovingGroups();
    initForms();
    enhanceClickables(document);
    syncAriaState(document);
    watch();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  return {
    enhanceClickables: enhanceClickables,
    syncAriaState: syncAriaState,
  };

})();
