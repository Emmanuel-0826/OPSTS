/* ============================================================
   js/auth.js — The signed-out screens
   OPSTS — GCTU

   One controller per page, dispatched from data-auth-page on
   <body>. Every one of them follows the same three rules:

     * The server's `message` is what the user reads. It is
       already written for a human.
     * A validation failure marks the field, describes it, and
       moves focus there.
     * Nothing is decided on the client that the server decides.
       The role picker sends a claim; the API checks it.

   Load order: config → session → api → ui → auth.
============================================================ */

"use strict";

/* ══════════════════════════════════════
   RADIOGROUP
   Real buttons with role="radio", plus the arrow-key behaviour
   the role implies. Roving tabindex, so the group is one tab stop.
══════════════════════════════════════ */
function wireRadioGroup(group, onChange) {
  if (!group) return null;
  const options = [...group.querySelectorAll('[role="radio"]')];

  function select(option, focus) {
    options.forEach((o) => {
      const on = o === option;
      o.setAttribute("aria-checked", String(on));
      o.tabIndex = on ? 0 : -1;
    });
    if (focus) option.focus();
    if (onChange) onChange(option.dataset.value);
  }

  options.forEach((option, index) => {
    option.tabIndex = option.getAttribute("aria-checked") === "true" ? 0 : -1;
    option.addEventListener("click", () => select(option, false));
    option.addEventListener("keydown", (event) => {
      const step =
        event.key === "ArrowRight" || event.key === "ArrowDown"
          ? 1
          : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
      if (!step) return;
      event.preventDefault();
      select(options[(index + step + options.length) % options.length], true);
    });
  });

  return {
    get value() {
      const checked = options.find((o) => o.getAttribute("aria-checked") === "true");
      return checked ? checked.dataset.value : null;
    },
    select,
  };
}

/**
 * `?next=` is attacker-controllable, and handing it straight to
 * location.replace() turns the sign-in page into an open redirect:
 * a link to index.html?next=https://evil.example lands the user
 * there the moment they authenticate. Only a same-origin absolute
 * path is accepted, and "//evil.example" — which a browser reads
 * as protocol-relative — is rejected with it.
 */
function safeNext(value) {
  if (!value) return null;
  /* One leading slash, and the character after it must not be
     another slash or a backslash — "//evil.example" is a
     protocol-relative URL and "/\evil.example" is normalised into
     one by every browser. */
  if (!/^\/(?![/\\])[A-Za-z0-9._~\-/]*$/.test(value)) return null;
  return value;
}

/** Populate a <select> from Config.departments. */
function fillDepartments(select) {
  if (!select) return;
  Config.departments.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  });
}

/** The two rules the API enforces on a password, and no others. */
function passwordProblem(value) {
  if (!value) return "A password is required.";
  if (value.length < Config.password.min)
    return `Password must be at least ${Config.password.min} characters.`;
  if (value.length > Config.password.max)
    return `Password must be ${Config.password.max} characters or fewer.`;
  return null;
}

function wirePasswordRule(input, rule) {
  if (!input || !rule) return;
  const sync = () => {
    const met = input.value.length >= Config.password.min;
    rule.setAttribute("data-met", String(met));
    rule.querySelector("[data-rule-icon]").innerHTML = met ? Icons.check : Icons.info;
  };
  sync();
  input.addEventListener("input", sync);
}

/* ══════════════════════════════════════
   SIGN IN / REGISTER
══════════════════════════════════════ */
function initSignIn() {
  if (Session.redirectIfSignedIn()) return;

  const tabs = [...document.querySelectorAll(".tab[data-panel]")];
  const panels = {
    login: document.getElementById("loginForm"),
    register: document.getElementById("registerForm"),
  };
  const heading = document.getElementById("authHeading");
  const slot = document.getElementById("authMessage");

  const HEADINGS = {
    login: {
      title: "Sign in",
      note: "Use the account your department registered you with.",
    },
    register: {
      title: "Create an account",
      note: "Registration is for students and supervisors. An administrator approves it before you can sign in.",
    },
  };

  function showPanel(name, focus) {
    tabs.forEach((tab) => {
      const on = tab.dataset.panel === name;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
    });
    Object.entries(panels).forEach(([key, form]) => {
      form.hidden = key !== name;
    });
    heading.querySelector("h2").textContent = HEADINGS[name].title;
    heading.querySelector("p").textContent = HEADINGS[name].note;
    UI.clearMessage(slot);
    if (focus) {
      const first = panels[name].querySelector("input, select, [role='radio'][aria-checked='true']");
      if (first) first.focus();
    }
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => showPanel(tab.dataset.panel, false));
    tab.addEventListener("keydown", (event) => {
      const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const next = tabs[(index + step + tabs.length) % tabs.length];
      showPanel(next.dataset.panel, false);
      next.focus();
    });
  });

  /* A session that ended on its own says why, once, at the top. */
  const reason = UI.query("reason");
  if (reason) UI.message(slot, "info", reason);

  /* ── Sign in ─────────────────────────────────────────── */
  const loginRoles = wireRadioGroup(document.getElementById("loginRoles"));
  const loginForm = panels.login;

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    UI.clearFieldErrors(loginForm);
    UI.clearMessage(slot);

    const email = document.getElementById("loginEmail");
    const password = document.getElementById("loginPassword");
    let ok = true;

    if (!email.value.trim()) {
      UI.fieldError(email, "Email address is required.");
      ok = false;
    }
    if (!password.value) {
      UI.fieldError(password, "Please enter your password.");
      ok = false;
    }
    if (!ok) return UI.focusFirstError(loginForm);

    const button = loginForm.querySelector("[type=submit]");
    UI.busy(button, true);

    try {
      const data = await Api.post(
        "/auth/login",
        {
          email: email.value.trim(),
          password: password.value,
          role: loginRoles ? loginRoles.value : undefined,
        },
        { anonymous: true, keepSessionOn401: true }
      );

      Session.save(data.user, data.token);

      if (data.user.mustChangePassword) {
        location.replace("change-password.html?forced=1");
        return;
      }
      const next = safeNext(UI.query("next"));
      location.replace(next || Config.home[data.user.role] || Config.home.student);
    } catch (error) {
      UI.busy(button, false);

      /* Not an error state. An account awaiting approval has a
         screen of its own, and it is a calm one. */
      if (error.isPendingApproval) {
        sessionStorage.setItem(Session.KEY_PENDING, email.value.trim());
        sessionStorage.setItem("opsts_pending_message", error.message);
        location.href = "pending.html";
        return;
      }

      UI.message(slot, "risk", error.message);
      slot.focus();
    }
  });

  /* ── Register ────────────────────────────────────────── */
  const registerForm = panels.register;
  fillDepartments(document.getElementById("registerDepartment"));

  const indexField = document.getElementById("indexNumberField");
  const staffField = document.getElementById("staffIdField");
  const topicField = document.getElementById("projectTopicField");

  const registerRoles = wireRadioGroup(document.getElementById("registerRoles"), (role) => {
    /* One identifier field or the other, never both — the API
       stores index_number for students and staff_id for
       supervisors, and requires whichever matches the role. */
    const isStudent = role === "student";
    indexField.hidden = !isStudent;
    staffField.hidden = isStudent;
    document.getElementById("indexNumber").required = isStudent;
    document.getElementById("staffId").required = !isStudent;
    /* A supervisor has no project of their own to name. */
    topicField.hidden = !isStudent;
    document.getElementById("projectTopic").required = isStudent;
  });

  wirePasswordRule(
    document.getElementById("registerPassword"),
    document.getElementById("registerPasswordRule")
  );

  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    UI.clearFieldErrors(registerForm);
    UI.clearMessage(slot);

    const role = registerRoles ? registerRoles.value : "student";
    const firstName = document.getElementById("firstName");
    const lastName = document.getElementById("lastName");
    const email = document.getElementById("registerEmail");
    const department = document.getElementById("registerDepartment");
    const password = document.getElementById("registerPassword");
    const indexNumber = document.getElementById("indexNumber");
    const staffId = document.getElementById("staffId");
    const projectTopic = document.getElementById("projectTopic");

    let ok = true;
    if (!firstName.value.trim()) {
      UI.fieldError(firstName, "First name is required.");
      ok = false;
    }
    if (!lastName.value.trim()) {
      UI.fieldError(lastName, "Last name is required.");
      ok = false;
    }
    if (!email.value.trim()) {
      UI.fieldError(email, "Email address is required.");
      ok = false;
    }
    if (!department.value) {
      UI.fieldError(department, "Please choose your department.");
      ok = false;
    }
    const passwordIssue = passwordProblem(password.value);
    if (passwordIssue) {
      UI.fieldError(password, passwordIssue);
      ok = false;
    }
    if (role === "student" && !indexNumber.value.trim()) {
      UI.fieldError(indexNumber, "Your student index number is required.");
      ok = false;
    }
    if (role === "supervisor" && !staffId.value.trim()) {
      UI.fieldError(staffId, "Your staff ID is required.");
      ok = false;
    }
    /* Same floor the API enforces, so a topic that is too short is
       caught before the round trip. */
    if (role === "student" && projectTopic.value.trim().length < 5) {
      UI.fieldError(
        projectTopic,
        projectTopic.value.trim()
          ? "Please describe your project topic in at least 5 characters."
          : "Your project topic is required."
      );
      ok = false;
    }
    if (!ok) return UI.focusFirstError(registerForm);

    const button = registerForm.querySelector("[type=submit]");
    UI.busy(button, true);

    const body = {
      role,
      firstName: firstName.value.trim(),
      lastName: lastName.value.trim(),
      email: email.value.trim(),
      password: password.value,
      department: department.value,
    };
    if (role === "student") {
      body.indexNumber = indexNumber.value.trim();
      body.projectTopic = projectTopic.value.trim();
    } else {
      body.staffId = staffId.value.trim();
    }

    try {
      const data = await Api.post("/auth/register", body, { anonymous: true });
      sessionStorage.setItem(Session.KEY_PENDING, body.email);
      sessionStorage.setItem("opsts_pending_message", data.message);
      sessionStorage.setItem("opsts_pending_role", role);
      location.href = "pending.html?new=1";
    } catch (error) {
      UI.busy(button, false);
      UI.message(slot, "risk", error.message);
      slot.focus();
    }
  });

  showPanel(UI.query("tab") === "register" ? "register" : "login", false);
  UI.wirePasswordFields();
}

/* ══════════════════════════════════════
   FORGOT PASSWORD
   The API answers identically whether or not the address exists,
   so the UI must too — anything else turns this form into a way
   of testing which addresses are registered.
══════════════════════════════════════ */
function initForgotPassword() {
  const form = document.getElementById("forgotForm");
  const slot = document.getElementById("authMessage");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    UI.clearFieldErrors(form);
    UI.clearMessage(slot);

    const email = document.getElementById("forgotEmail");
    if (!email.value.trim()) {
      UI.fieldError(email, "Email address is required.");
      return UI.focusFirstError(form);
    }

    const button = form.querySelector("[type=submit]");
    UI.busy(button, true);

    try {
      const data = await Api.post(
        "/auth/forgot-password",
        { email: email.value.trim() },
        { anonymous: true }
      );
      UI.message(slot, "ok", data.message);
      form.hidden = true;
      document.getElementById("forgotDone").hidden = false;
      slot.focus();
    } catch (error) {
      UI.busy(button, false);
      UI.message(slot, "risk", error.message);
      slot.focus();
    }
  });
}

/* ══════════════════════════════════════
   RESET PASSWORD
   Reached from the link in the email, which the backend builds as
   APP_URL/reset-password.html?token=… — that path is a contract,
   so this file stays at the frontend root.
══════════════════════════════════════ */
function initResetPassword() {
  const form = document.getElementById("resetForm");
  const slot = document.getElementById("authMessage");
  const token = UI.query("token");

  if (!token) {
    form.hidden = true;
    UI.message(
      slot,
      "risk",
      "That password reset link is missing its token. Please request a new link."
    );
    document.getElementById("resetNoToken").hidden = false;
    return;
  }

  wirePasswordRule(
    document.getElementById("newPassword"),
    document.getElementById("resetPasswordRule")
  );
  UI.wirePasswordFields();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    UI.clearFieldErrors(form);
    UI.clearMessage(slot);

    const password = document.getElementById("newPassword");
    const confirm = document.getElementById("confirmPassword");

    const issue = passwordProblem(password.value);
    if (issue) {
      UI.fieldError(password, issue);
      return UI.focusFirstError(form);
    }
    if (password.value !== confirm.value) {
      UI.fieldError(confirm, "The two passwords do not match.");
      return UI.focusFirstError(form);
    }

    const button = form.querySelector("[type=submit]");
    UI.busy(button, true);

    try {
      const data = await Api.post(
        "/auth/reset-password",
        { token, newPassword: password.value },
        { anonymous: true }
      );
      form.hidden = true;
      UI.message(slot, "ok", data.message);
      document.getElementById("resetDone").hidden = false;
      slot.focus();
    } catch (error) {
      UI.busy(button, false);
      UI.message(slot, "risk", error.message);
      slot.focus();
    }
  });
}

/* ══════════════════════════════════════
   CHANGE PASSWORD
   Two ways in: a signed-in user choosing to, or an account whose
   password was set by somebody else being required to. The second
   is a locked door, not a suggestion — session.js sends every
   other page here until it is done.
══════════════════════════════════════ */
function initChangePassword() {
  const user = Session.requireAuth();
  if (!user) return;

  const forced = UI.query("forced") === "1" || user.mustChangePassword;
  const form = document.getElementById("changeForm");
  const slot = document.getElementById("authMessage");

  document.getElementById("changeForcedBanner").hidden = !forced;
  document.getElementById("changeBackLink").hidden = forced;
  document.getElementById("changeWho").textContent = `${user.name} · ${user.email}`;

  wirePasswordRule(
    document.getElementById("changeNewPassword"),
    document.getElementById("changePasswordRule")
  );
  UI.wirePasswordFields();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    UI.clearFieldErrors(form);
    UI.clearMessage(slot);

    const current = document.getElementById("currentPassword");
    const next = document.getElementById("changeNewPassword");
    const confirm = document.getElementById("changeConfirmPassword");

    if (!current.value) {
      UI.fieldError(current, "Enter your current password.");
      return UI.focusFirstError(form);
    }
    const issue = passwordProblem(next.value);
    if (issue) {
      UI.fieldError(next, issue);
      return UI.focusFirstError(form);
    }
    if (next.value === current.value) {
      UI.fieldError(next, "Choose a password different from your current one.");
      return UI.focusFirstError(form);
    }
    if (next.value !== confirm.value) {
      UI.fieldError(confirm, "The two passwords do not match.");
      return UI.focusFirstError(form);
    }

    const button = form.querySelector("[type=submit]");
    UI.busy(button, true);

    try {
      const data = await Api.post("/auth/change-password", {
        currentPassword: current.value,
        newPassword: next.value,
      });

      /* The server bumped token_version, which retires every token
         it had issued — including the one in this tab. Swap it
         before the next call, or the very next request 401s. */
      Session.updateToken(data.token);

      /* Re-read the user so mustChangePassword is cleared from the
         source rather than assumed here. */
      const me = await Api.get("/auth/me");
      Session.save(me.user, data.token);

      UI.toast(data.message, "ok");
      setTimeout(() => location.replace(Session.homeFor(me.user.role)), 600);
    } catch (error) {
      UI.busy(button, false);
      UI.message(slot, "risk", error.message);
      slot.focus();
    }
  });
}

/* ══════════════════════════════════════
   WAITING ROOM
   An account that exists but is not approved. Nothing is broken
   and nothing is required of the person reading it, so the page
   says what is happening, who is doing it, and what will tell
   them it is done.
══════════════════════════════════════ */
function initPending() {
  const email = sessionStorage.getItem(Session.KEY_PENDING);
  const message = sessionStorage.getItem("opsts_pending_message");
  const role = sessionStorage.getItem("opsts_pending_role");
  const isNew = UI.query("new") === "1";

  document.getElementById("pendingHeading").textContent = isNew
    ? "Your account has been created"
    : "Your account is waiting for approval";

  if (email) {
    document.getElementById("pendingEmail").textContent = email;
    document.getElementById("pendingIdentity").hidden = false;
  }

  if (role) {
    document.getElementById("pendingRole").textContent =
      role === "supervisor" ? "Supervisor" : "Student";
  }

  /* The server's own sentence, verbatim — it is the one that
     explains what happens next. */
  if (message) {
    UI.message(document.getElementById("authMessage"), "info", message);
  }

  document.getElementById("pendingSignOut").addEventListener("click", () => {
    sessionStorage.removeItem(Session.KEY_PENDING);
    sessionStorage.removeItem("opsts_pending_message");
    sessionStorage.removeItem("opsts_pending_role");
    Session.clear();
    location.replace("index.html");
  });
}

/* ══════════════════════════════════════
   DISPATCH
══════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.authPage;
  const routes = {
    signin: initSignIn,
    forgot: initForgotPassword,
    reset: initResetPassword,
    change: initChangePassword,
    pending: initPending,
  };
  if (routes[page]) routes[page]();
});
