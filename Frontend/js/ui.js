/* ============================================================
   js/ui.js — Shared interface behaviour
   OPSTS — GCTU

   Icons, toasts, busy buttons, and form error plumbing. No API
   calls and no session state — this file is presentation only.

   Icons are inline SVG, not an icon font and never emoji. An icon
   font is a network dependency that renders as a blank box when it
   fails, on a page where the blank box might be the only thing
   telling a student their chapter was rejected.
============================================================ */

"use strict";

const Icons = {
  check:
    '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  alert:
    '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.4" stroke="currentColor" stroke-width="1.7"/><path d="M8 4.6v3.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="8" cy="11" r="0.9" fill="currentColor"/></svg>',
  warning:
    '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.8L14.4 13.2H1.6L8 2.8z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8 6.6v2.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="8" cy="11.2" r="0.85" fill="currentColor"/></svg>',
  info:
    '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.4" stroke="currentColor" stroke-width="1.7"/><path d="M8 7.4v3.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="8" cy="5.1" r="0.9" fill="currentColor"/></svg>',
  eye:
    '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M1.8 10S4.9 4.6 10 4.6 18.2 10 18.2 10 15.1 15.4 10 15.4 1.8 10 1.8 10z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="10" cy="10" r="2.6" stroke="currentColor" stroke-width="1.6"/></svg>',
  eyeOff:
    '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M7.4 5.2A7.9 7.9 0 0110 4.6c5.1 0 8.2 5.4 8.2 5.4a15 15 0 01-2.6 3.2M4.6 6.4A15 15 0 001.8 10s3.1 5.4 8.2 5.4c1 0 1.9-.2 2.7-.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 3l14 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  student:
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4L2.5 8.5 12 13l9.5-4.5L12 4z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M6.5 10.7v4.6c0 1.4 2.5 2.7 5.5 2.7s5.5-1.3 5.5-2.7v-4.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M21.5 8.5v5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  supervisor:
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8" r="3.4" stroke="currentColor" stroke-width="1.6"/><path d="M4.5 20a7.5 7.5 0 0115 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  admin:
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3l7 2.6v5.2c0 4.3-2.9 8.2-7 9.2-4.1-1-7-4.9-7-9.2V5.6L12 3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 12l2.2 2.2L15.5 10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  mail:
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M3.8 7l7.2 5.2a1.7 1.7 0 002 0L20.2 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  lock:
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4.5" y="10" width="15" height="10" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M8 10V7.5a4 4 0 018 0V10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  clock:
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.6"/><path d="M12 7v5.3l3.2 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  back:
    '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M9.5 3.5L5 8l4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  upload:
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 15.5V4.8M8 8.2L12 4.5l4 3.7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.5 15v3a1.5 1.5 0 001.5 1.5h12A1.5 1.5 0 0019.5 18v-3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  comment:
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4.5 5.5h15v11h-9l-4 3v-3h-2v-11z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  chart:
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 20V10M10 20V4.5M16 20v-7M22 20H2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  calendar:
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="15" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M3.5 10h17M8 3.5v4M16 3.5v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
};

const UI = {
  /* ══════════════════════════════════════
     TOASTS
     One live region per page, created on demand. `polite` for
     confirmations, `assertive` for failures — a failed save
     should interrupt; a saved draft should not.
  ══════════════════════════════════════ */
  toastRegion() {
    let region = document.getElementById("toastRegion");
    if (!region) {
      region = document.createElement("div");
      region.id = "toastRegion";
      region.className = "toast-region";
      region.setAttribute("role", "status");
      region.setAttribute("aria-live", "polite");
      document.body.appendChild(region);
    }
    return region;
  },

  /**
   * @param {string} message
   * @param {"ok"|"risk"|"warn"|"info"} [tone]
   * @param {number} [duration] ms. Failures stay longer, because
   *        the sentence usually says what to do next.
   */
  toast(message, tone = "info", duration) {
    const region = this.toastRegion();
    region.setAttribute("aria-live", tone === "risk" ? "assertive" : "polite");

    const icon =
      tone === "ok" ? Icons.check : tone === "risk" ? Icons.alert : tone === "warn" ? Icons.warning : Icons.info;

    const el = document.createElement("div");
    el.className = "toast toast-" + tone;
    el.innerHTML = icon;
    const text = document.createElement("span");
    text.textContent = message;
    el.appendChild(text);
    region.appendChild(el);

    const ms = duration || (tone === "risk" ? 8000 : 4500);
    setTimeout(() => {
      el.setAttribute("data-leaving", "true");
      setTimeout(() => el.remove(), 200);
    }, ms);
  },

  /* ══════════════════════════════════════
     BUSY BUTTONS
     The label stays visible; only the spinner is added. A button
     that blanks its own text loses its accessible name mid-action.
  ══════════════════════════════════════ */
  busy(button, isBusy) {
    if (!button) return;
    if (isBusy) {
      button.setAttribute("data-busy", "true");
      button.setAttribute("aria-busy", "true");
      button.disabled = true;
    } else {
      button.removeAttribute("data-busy");
      button.removeAttribute("aria-busy");
      button.disabled = false;
    }
  },

  /* ══════════════════════════════════════
     FORM ERRORS
     Tied to the field by aria-describedby, announced by
     aria-invalid, and focus moves to the first one. The three go
     together — an error that is only red is an error a screen
     reader never hears.
  ══════════════════════════════════════ */

  /** @param {HTMLElement} input @param {string} message */
  fieldError(input, message) {
    if (!input) return;
    const id = input.id + "-error";
    let slot = document.getElementById(id);

    if (!slot) {
      slot = document.createElement("p");
      slot.id = id;
      slot.className = "field-error";
      const field = input.closest(".field") || input.parentElement;
      field.appendChild(slot);
    }

    slot.innerHTML = Icons.alert;
    const text = document.createElement("span");
    text.textContent = message;
    slot.appendChild(text);

    input.setAttribute("aria-invalid", "true");
    const described = (input.getAttribute("aria-describedby") || "")
      .split(/\s+/)
      .filter(Boolean);
    if (!described.includes(id)) {
      input.setAttribute("aria-describedby", described.concat(id).join(" "));
    }
  },

  clearFieldErrors(form) {
    form.querySelectorAll("[aria-invalid='true']").forEach((input) => {
      input.removeAttribute("aria-invalid");
    });
    form.querySelectorAll(".field-error").forEach((slot) => {
      /* Static markup owns some of these; only clear what we wrote. */
      if (slot.id.endsWith("-error")) slot.textContent = "";
    });
  },

  /** Focus the first invalid control, so a keyboard user is not
      left hunting for what went wrong. */
  focusFirstError(form) {
    const first = form.querySelector("[aria-invalid='true']");
    if (first) first.focus();
  },

  /* ══════════════════════════════════════
     FORM-LEVEL MESSAGE
     For the response to a submit — the server's own sentence,
     shown where the form is, not only as a toast that may have
     already faded by the time the user looks back.
  ══════════════════════════════════════ */

  /** @param {"ok"|"risk"|"warn"|"info"} tone */
  message(slot, tone, text) {
    if (!slot) return;
    const icon =
      tone === "ok" ? Icons.check : tone === "risk" ? Icons.alert : tone === "warn" ? Icons.warning : Icons.info;

    slot.className = "message message-" + tone;
    slot.hidden = false;
    slot.innerHTML = icon;

    const body = document.createElement("div");
    body.textContent = text;
    slot.appendChild(body);
  },

  clearMessage(slot) {
    if (!slot) return;
    slot.hidden = true;
    slot.textContent = "";
  },

  /* ══════════════════════════════════════
     PASSWORD REVEAL
     Wires every .password-field on the page.
  ══════════════════════════════════════ */
  wirePasswordFields(scope = document) {
    scope.querySelectorAll(".password-field").forEach((field) => {
      const input = field.querySelector("input");
      const button = field.querySelector(".password-reveal");
      if (!input || !button || button.dataset.wired) return;

      button.dataset.wired = "1";
      const sync = () => {
        const shown = input.type === "text";
        button.innerHTML = shown ? Icons.eyeOff : Icons.eye;
        button.setAttribute("aria-label", shown ? "Hide password" : "Show password");
      };
      sync();

      button.addEventListener("click", () => {
        input.type = input.type === "password" ? "text" : "password";
        sync();
        input.focus();
      });
    });
  },

  /** Read `?name=` from the current URL. */
  query(name) {
    return new URLSearchParams(location.search).get(name);
  },
};
