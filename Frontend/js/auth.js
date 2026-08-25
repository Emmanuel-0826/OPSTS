/* ============================================================
   js/auth.js — Authentication Logic for OPSTS
   Now talks to the real backend via Api (js/api.js) instead of
   the in-memory DB_USERS mock array.
   Handles: login, register, role selection, forgot password,
            tab switching, session management
============================================================ */

"use strict";

/* ── Role redirect map ── */
const ROLE_REDIRECT = {
  student:    "pages/student/dashboard.html",
  supervisor: "pages/supervisor/dashboard.html",
  admin:      "pages/admin/dashboard.html",
};

/* ── Register form department code → full label the backend expects ── */
const DEPT_LABELS = {
  cs: "Computer Science",
  it: "Information Technology",
  ce: "Computer Engineering",
  se: "Software Engineering",
  cy: "Cybersecurity",
};

/* ── Active role selections ── */
let loginRole    = "student";
let registerRole = "student";

/* ═══════════════════════════════════════
   TAB SWITCHING
═══════════════════════════════════════ */
function initTabs() {
  const tabLogin    = document.getElementById("tab-login");
  const tabRegister = document.getElementById("tab-register");
  const formLogin   = document.getElementById("loginForm");
  const formReg     = document.getElementById("registerForm");

  tabLogin.addEventListener("click", function () {
    tabLogin.classList.add("active");
    tabRegister.classList.remove("active");
    formLogin.classList.add("active");
    formReg.classList.remove("active");
    clearAlert();
  });

  tabRegister.addEventListener("click", function () {
    tabRegister.classList.add("active");
    tabLogin.classList.remove("active");
    formReg.classList.add("active");
    formLogin.classList.remove("active");
    clearAlert();
  });
}

/* ═══════════════════════════════════════
   ROLE SELECTORS
═══════════════════════════════════════ */
function initRoleSelectors() {
  const loginOptions = document.querySelectorAll("#loginRoleSelector .role-option");
  loginOptions.forEach(function (opt) {
    opt.addEventListener("click", function () {
      loginOptions.forEach(function (o) { o.classList.remove("selected"); });
      opt.classList.add("selected");
      loginRole = opt.dataset.role;
    });
  });

  const regOptions = document.querySelectorAll("#registerRoleSelector .role-option");
  regOptions.forEach(function (opt) {
    opt.addEventListener("click", function () {
      regOptions.forEach(function (o) { o.classList.remove("selected"); });
      opt.classList.add("selected");
      registerRole = opt.dataset.role;
    });
  });
}

/* ═══════════════════════════════════════
   ALERT HELPERS
═══════════════════════════════════════ */
function showAlert(message, type) {
  const box = document.getElementById("authAlert");
  box.textContent = message;
  box.className   = "auth-alert show " + type;
}

function clearAlert() {
  const box = document.getElementById("authAlert");
  box.className   = "auth-alert";
  box.textContent = "";
}

/* ── Helper: toggle a submit button's loading state ── */
function setButtonLoading(btn, loading, loadingText, originalText) {
  if (loading) {
    btn.dataset.originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ' + loadingText;
  } else {
    btn.disabled = false;
    btn.innerHTML = originalText || btn.dataset.originalText || btn.innerHTML;
  }
}

/* ═══════════════════════════════════════
   LOGIN FORM
═══════════════════════════════════════ */
function initLoginForm() {
  const form = document.getElementById("loginForm");

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    clearAlert();

    const email    = document.getElementById("loginEmail").value.trim().toLowerCase();
    const password = document.getElementById("loginPassword").value;

    if (!email || !password) {
      showAlert("Please enter your email and password.", "error");
      return;
    }
    if (!Utils.isValidEmail(email)) {
      showAlert("Please enter a valid email address.", "error");
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    setButtonLoading(submitBtn, true, "Signing in…");

    try {
      const res = await Api.post(
        "/auth/login",
        { email: email, password: password, role: loginRole },
        { skipAuthRedirect: true }
      );

      Utils.saveSession(res.user, res.token);
      showAlert("Login successful! Redirecting…", "success");

      setTimeout(function () {
        window.location.href = ROLE_REDIRECT[res.user.role];
      }, 800);
    } catch (err) {
      showAlert(err.message || "Login failed. Please try again.", "error");
      setButtonLoading(submitBtn, false);
    }
  });
}

/* ═══════════════════════════════════════
   FORGOT PASSWORD
═══════════════════════════════════════ */
function initForgotPassword() {
  const link = document.getElementById("forgotLink");

  link.addEventListener("click", async function (e) {
    e.preventDefault();

    const email = document.getElementById("loginEmail").value.trim();

    if (!email) {
      showAlert("Please enter your email address above, then click Forgot password.", "error");
      return;
    }
    if (!Utils.isValidEmail(email)) {
      showAlert("Please enter a valid email address.", "error");
      return;
    }

    try {
      const res = await Api.post("/auth/forgot-password", { email: email }, { skipAuthRedirect: true });
      showAlert(res.message, "success");
    } catch (err) {
      showAlert(err.message || "Something went wrong. Please try again.", "error");
    }
  });
}

/* ═══════════════════════════════════════
   REGISTER FORM
═══════════════════════════════════════ */
function initRegisterForm() {
  const form = document.getElementById("registerForm");

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    clearAlert();

    const firstName = document.getElementById("regFirstName").value.trim();
    const lastName  = document.getElementById("regLastName").value.trim();
    const email     = document.getElementById("regEmail").value.trim();
    const idNumber  = document.getElementById("regId").value.trim();
    const deptCode  = document.getElementById("regDept").value;
    const password  = document.getElementById("regPassword").value;
    const confirm   = document.getElementById("regConfirm").value;

    if (!firstName || !lastName || !email || !idNumber || !deptCode || !password || !confirm) {
      showAlert("Please fill in all fields.", "error");
      return;
    }
    if (!Utils.isValidEmail(email)) {
      showAlert("Please enter a valid email address.", "error");
      return;
    }
    if (password.length < 8) {
      showAlert("Password must be at least 8 characters.", "error");
      return;
    }
    if (password !== confirm) {
      showAlert("Passwords do not match. Please try again.", "error");
      return;
    }

    const payload = {
      role:       registerRole,
      firstName:  firstName,
      lastName:   lastName,
      email:      email,
      password:   password,
      department: DEPT_LABELS[deptCode] || deptCode,
    };
    if (registerRole === "student")    payload.indexNumber = idNumber;
    if (registerRole === "supervisor") payload.staffId      = idNumber;

    const submitBtn = form.querySelector('button[type="submit"]');
    setButtonLoading(submitBtn, true, "Creating account…");

    try {
      const res = await Api.post("/auth/register", payload, { skipAuthRedirect: true });

      showAlert(
        res.message || "Account created! Awaiting admin approval before you can sign in.",
        "success"
      );

      form.reset();
      const regOptions = document.querySelectorAll("#registerRoleSelector .role-option");
      regOptions.forEach(function (o) { o.classList.remove("selected"); });
      regOptions[0].classList.add("selected");
      registerRole = "student";

      setTimeout(function () {
        document.getElementById("tab-login").click();
      }, 2800);
    } catch (err) {
      showAlert(err.message || "Registration failed. Please try again.", "error");
    } finally {
      setButtonLoading(submitBtn, false);
    }
  });
}

/* ═══════════════════════════════════════
   GUARD: Redirect if already logged in
═══════════════════════════════════════ */
function checkExistingSession() {
  const user  = Utils.getSession();
  const token = Utils.getToken();
  if (user && token && ROLE_REDIRECT[user.role]) {
    window.location.href = ROLE_REDIRECT[user.role];
  }
}

/* ═══════════════════════════════════════
   INIT
═══════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", function () {
  checkExistingSession();
  initTabs();
  initRoleSelectors();
  initLoginForm();
  initForgotPassword();
  initRegisterForm();
});