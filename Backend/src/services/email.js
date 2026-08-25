/* ============================================================
   src/services/email.js — Outbound mail

   Email is an enhancement to in-app notifications, never a
   dependency of them. If SMTP is unconfigured or the provider is
   down, the action still succeeds and the message is logged
   instead — a supervisor's feedback must not fail to save because
   a mail server refused a connection.
============================================================ */

"use strict";

const nodemailer = require("nodemailer");
const config = require("../config/env");

let transporter = null;
let warnedUnconfigured = false;

const isConfigured = Boolean(config.email.host && config.email.user);

function getTransporter() {
  if (!isConfigured) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.secure,
      auth: { user: config.email.user, pass: config.email.pass },
    });
  }
  return transporter;
}

/** Escape anything interpolated into an HTML mail body. */
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function layout(heading, bodyHtml) {
  return `
  <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#202124;">
    <div style="background:#1a73e8;color:#fff;padding:18px 24px;border-radius:8px 8px 0 0;">
      <h2 style="margin:0;font-size:18px;">OPSTS</h2>
      <p style="margin:4px 0 0;font-size:12px;opacity:.85;">
        Online Project Supervision &amp; Tracking System
      </p>
    </div>
    <div style="border:1px solid #e0e0e0;border-top:0;border-radius:0 0 8px 8px;padding:24px;">
      <h3 style="margin-top:0;font-size:16px;">${escapeHtml(heading)}</h3>
      ${bodyHtml}
      <p style="margin-top:24px;font-size:12px;color:#5f6368;">
        This is an automated message from OPSTS. Please do not reply.
      </p>
    </div>
  </div>`;
}

/**
 * Send an email. Resolves either way — check `.sent` if the caller cares.
 * @returns {Promise<{sent: boolean, reason?: string}>}
 */
async function send({ to, subject, heading, html, text }) {
  const mailer = getTransporter();

  if (!mailer) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      // eslint-disable-next-line no-console
      console.warn(
        "[email] SMTP is not configured (EMAIL_HOST/EMAIL_USER unset). " +
          "Emails will be logged instead of sent."
      );
    }
    // eslint-disable-next-line no-console
    console.log(`[email:skipped] to=${to} subject="${subject}"`);
    return { sent: false, reason: "not_configured" };
  }

  try {
    await mailer.sendMail({
      from: config.email.from,
      to,
      subject,
      text: text || subject,
      html: html || layout(heading || subject, `<p>${escapeHtml(text || subject)}</p>`),
    });
    return { sent: true };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[email] failed to send to ${to}: ${err.message}`);
    return { sent: false, reason: err.message };
  }
}

/* ══════════════════════════════════════
   Templates
══════════════════════════════════════ */

function passwordReset({ to, name, token }) {
  const url = `${config.email.appUrl}/reset-password.html?token=${encodeURIComponent(token)}`;
  const minutes = config.auth.resetTtlMinutes;

  return send({
    to,
    subject: "Reset your OPSTS password",
    heading: `Hello ${name},`,
    text:
      `Use this link to reset your OPSTS password (valid for ${minutes} minutes): ${url}\n\n` +
      "If you did not request a reset, you can ignore this email — your password has not changed.",
    html: layout(
      `Hello ${escapeHtml(name)},`,
      `<p>We received a request to reset your OPSTS password.</p>
       <p style="margin:24px 0;">
         <a href="${escapeHtml(url)}"
            style="background:#1a73e8;color:#fff;text-decoration:none;padding:11px 22px;
                   border-radius:6px;display:inline-block;font-weight:600;">Reset password</a>
       </p>
       <p style="font-size:13px;color:#5f6368;">
         This link expires in ${minutes} minutes. If you did not request a reset,
         ignore this email — your password has not changed.
       </p>`
    ),
  });
}

function accountApproved({ to, name }) {
  return send({
    to,
    subject: "Your OPSTS account has been approved",
    heading: `Welcome, ${name}!`,
    text: `Your OPSTS account has been approved. You can now sign in at ${config.email.appUrl}.`,
    html: layout(
      `Welcome, ${escapeHtml(name)}!`,
      `<p>An administrator has approved your OPSTS account. You can sign in now.</p>
       <p style="margin:24px 0;">
         <a href="${escapeHtml(config.email.appUrl)}"
            style="background:#1a73e8;color:#fff;text-decoration:none;padding:11px 22px;
                   border-radius:6px;display:inline-block;font-weight:600;">Sign in</a>
       </p>`
    ),
  });
}

function accountCreated({ to, name, temporaryPassword }) {
  return send({
    to,
    subject: "Your OPSTS account is ready",
    heading: `Welcome, ${name}!`,
    text:
      `An OPSTS account has been created for you.\n\nEmail: ${to}\n` +
      `Temporary password: ${temporaryPassword}\n\n` +
      `Sign in at ${config.email.appUrl} and change your password from Profile → Change Password.`,
    html: layout(
      `Welcome, ${escapeHtml(name)}!`,
      `<p>An administrator has created an OPSTS account for you.</p>
       <table style="font-size:14px;margin:16px 0;">
         <tr><td style="padding:4px 12px 4px 0;color:#5f6368;">Email</td>
             <td><strong>${escapeHtml(to)}</strong></td></tr>
         <tr><td style="padding:4px 12px 4px 0;color:#5f6368;">Temporary password</td>
             <td><strong>${escapeHtml(temporaryPassword)}</strong></td></tr>
       </table>
       <p style="font-size:13px;color:#5f6368;">
         Please change this password immediately after signing in
         (Profile → Change Password).
       </p>`
    ),
  });
}

/** Generic "something happened" mail that mirrors an in-app notification. */
function activityAlert({ to, name, subject, heading, lines = [], ctaLabel, ctaPath }) {
  const url = ctaPath ? `${config.email.appUrl}/${ctaPath.replace(/^\//, "")}` : null;
  const body =
    lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("") +
    (url && ctaLabel
      ? `<p style="margin:24px 0;">
           <a href="${escapeHtml(url)}"
              style="background:#1a73e8;color:#fff;text-decoration:none;padding:11px 22px;
                     border-radius:6px;display:inline-block;font-weight:600;">
             ${escapeHtml(ctaLabel)}</a>
         </p>`
      : "");

  return send({
    to,
    subject,
    heading: heading || `Hello ${name},`,
    text: lines.join("\n\n") + (url ? `\n\n${url}` : ""),
    html: layout(heading || `Hello ${name},`, body),
  });
}

module.exports = {
  isConfigured,
  send,
  escapeHtml,
  passwordReset,
  accountApproved,
  accountCreated,
  activityAlert,
};
