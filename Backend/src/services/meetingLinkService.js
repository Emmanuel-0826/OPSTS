/* ============================================================
   src/services/meetingLinkService.js — Requirement 7

   Resolves the join link for a meeting, in priority order:

     1. A link the supervisor typed in — always wins. If someone
        pasted a working room URL, do not overwrite it.
     2. A real Zoom meeting, created through the Zoom API, when
        Server-to-Server OAuth credentials are configured.
     3. No link.

   Step 3 is deliberate. Inventing a plausible-looking zoom.us URL
   that leads nowhere is worse than an empty field: the student
   would click it, fail to join, and only then discover the meeting
   has no room. An absent link is visible to the supervisor while
   there is still time to add one.
============================================================ */

"use strict";

const config = require("../config/env");

const ZOOM_TOKEN_URL = "https://zoom.us/oauth/token";
const ZOOM_API_URL = "https://api.zoom.us/v2";
const REQUEST_TIMEOUT_MS = 8000;

const isZoomConfigured = Boolean(
  config.zoom.accountId && config.zoom.clientId && config.zoom.clientSecret
);

/* Access tokens last an hour; cache and reuse rather than
   re-authenticating on every scheduled meeting. */
let cachedToken = null; // { value: string, expiresAt: number }

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }

  const basic = Buffer.from(
    `${config.zoom.clientId}:${config.zoom.clientSecret}`
  ).toString("base64");

  const url =
    `${ZOOM_TOKEN_URL}?grant_type=account_credentials` +
    `&account_id=${encodeURIComponent(config.zoom.accountId)}`;

  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}` },
  });

  if (!res.ok) {
    throw new Error(`Zoom token request failed with HTTP ${res.status}`);
  }

  const data = await res.json();
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
  return cachedToken.value;
}

/** "1.5 hours" / "45 mins" → minutes, for the Zoom `duration` field. */
function parseDurationMinutes(duration) {
  if (!duration) return 60;
  const match = String(duration).match(/([\d.]+)\s*(min|hour|hr)/i);
  if (!match) return 60;
  const value = Number.parseFloat(match[1]);
  if (Number.isNaN(value)) return 60;
  return /hour|hr/i.test(match[2]) ? Math.round(value * 60) : Math.round(value);
}

/**
 * Create a Zoom meeting.
 * @returns {Promise<{link: string, meetingId: string}>}
 */
async function createZoomMeeting({ title, date, time, duration, notes }) {
  const token = await getAccessToken();

  const res = await fetchWithTimeout(`${ZOOM_API_URL}/users/me/meetings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      topic: title.slice(0, 200),
      type: 2, // scheduled meeting
      start_time: `${date}T${time}:00`,
      duration: parseDurationMinutes(duration),
      timezone: "Africa/Accra",
      agenda: (notes || "").slice(0, 2000),
      settings: {
        join_before_host: false,
        waiting_room: true,
        mute_upon_entry: true,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Zoom meeting creation failed with HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return { link: data.join_url, meetingId: String(data.id) };
}

/**
 * Resolve the link for a meeting about to be saved.
 * Never throws: a Zoom outage downgrades to "no link", it does not
 * stop the meeting from being scheduled.
 *
 * @returns {Promise<{link: string|null, meetingId: string|null, generated: boolean, warning: string|null}>}
 */
async function resolveMeetingLink({ platform, providedLink, title, date, time, duration, notes }) {
  const empty = { link: null, meetingId: null, generated: false, warning: null };

  if (providedLink) {
    return { ...empty, link: providedLink };
  }

  if (platform === "In-Person") {
    return empty;
  }

  if (platform === "Zoom" && isZoomConfigured) {
    try {
      const { link, meetingId } = await createZoomMeeting({ title, date, time, duration, notes });
      return { link, meetingId, generated: true, warning: null };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[zoom]", err.message);
      return {
        ...empty,
        warning:
          "The meeting was scheduled, but the Zoom link could not be generated. " +
          "Please add a link manually.",
      };
    }
  }

  return {
    ...empty,
    warning:
      platform === "Zoom"
        ? "Zoom is not connected, so no link was generated. Add a meeting link manually."
        : `No ${platform} link was provided. Add one so the student can join.`,
  };
}

module.exports = { isZoomConfigured, resolveMeetingLink, parseDurationMinutes };
