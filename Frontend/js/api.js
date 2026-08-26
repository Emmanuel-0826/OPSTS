/* ============================================================
   js/api.js — API client
   OPSTS — GCTU

   One wrapper over fetch, mirroring the contract in
   Backend/src/routes/. Three things it guarantees:

     * The bearer token goes on every authenticated call.
     * A 401 ends the session once, here, rather than in forty
       call sites.
     * The server's own `message` is what reaches the caller.
       Every error the API returns is already written for a human
       — replacing it with "Something went wrong" throws away the
       only sentence that told the user what to do.

   Load order: config.js → session.js → api.js.
============================================================ */

"use strict";

/** Thrown for any non-2xx or `success: false` response. */
class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }

  /** True when the account exists but has not been approved. The
      login route answers 403 for this, and it is not a failure —
      it is a state with a screen of its own. */
  get isPendingApproval() {
    return this.status === 403 && /not been approved/i.test(this.message);
  }

  /** True when the request never reached the server. */
  get isOffline() {
    return this.status === 0;
  }
}

const Api = {
  baseUrl: Config.apiBaseUrl,

  /**
   * @param {string} method
   * @param {string} path      e.g. "/auth/login"
   * @param {object|FormData} [body]
   * @param {object} [opts]
   * @param {boolean} [opts.anonymous] do not send the token
   * @param {boolean} [opts.keepSessionOn401] treat a 401 as an
   *        ordinary error instead of an expired session. The login
   *        route needs this: there, 401 means "wrong password",
   *        not "your session ended".
   */
  async request(method, path, body, opts = {}) {
    const headers = {};
    const token = Session.token;

    if (token && !opts.anonymous) headers.Authorization = "Bearer " + token;

    const init = { method, headers };

    if (body instanceof FormData) {
      /* Let the browser set Content-Type, so it can add the
         multipart boundary. Setting it by hand breaks the upload. */
      init.body = body;
    } else if (body !== undefined && body !== null) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    let response;
    try {
      response = await fetch(this.baseUrl + path, init);
    } catch {
      throw new ApiError(
        "Cannot reach the server. Check your connection, or make sure the API is running.",
        0,
        null
      );
    }

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null; /* 204, or an empty body */
    }

    if (response.status === 401 && !opts.keepSessionOn401) {
      Session.signOut("Your session has expired. Please sign in again.");
      /* signOut navigates; this never resolves for the caller. */
      return new Promise(() => {});
    }

    if (!response.ok || (data && data.success === false)) {
      throw new ApiError(
        (data && data.message) || `Request failed (HTTP ${response.status}).`,
        response.status,
        data
      );
    }

    return data;
  },

  get(path, opts) {
    return this.request("GET", path, null, opts);
  },
  post(path, body, opts) {
    return this.request("POST", path, body, opts);
  },
  put(path, body, opts) {
    return this.request("PUT", path, body, opts);
  },
  patch(path, body, opts) {
    return this.request("PATCH", path, body, opts);
  },
  delete(path, opts) {
    return this.request("DELETE", path, null, opts);
  },

  /**
   * Downloads are authenticated streams, not static URLs — the
   * uploads directory has no static handler pointed at it. So the
   * file is fetched with the auth header, turned into a blob, and
   * handed to the browser.
   *
   * The backend exposes Content-Disposition through CORS, which is
   * where the real filename comes from.
   */
  async download(path, fallbackName = "download") {
    const response = await fetch(this.baseUrl + path, {
      headers: { Authorization: "Bearer " + Session.token },
    }).catch(() => {
      throw new ApiError("Cannot reach the server. Check your connection.", 0, null);
    });

    if (response.status === 401) {
      Session.signOut("Your session has expired. Please sign in again.");
      return new Promise(() => {});
    }

    if (!response.ok) {
      /* An error on this route still answers JSON, so the server's
         message survives even though the happy path is a stream. */
      let message = `Download failed (HTTP ${response.status}).`;
      try {
        const data = await response.json();
        if (data && data.message) message = data.message;
      } catch {
        /* not JSON; keep the generic line */
      }
      throw new ApiError(message, response.status, null);
    }

    const disposition = response.headers.get("Content-Disposition") || "";
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
    const name = match ? decodeURIComponent(match[1]) : fallbackName;

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    /* Revoking immediately can cancel the save in some browsers. */
    setTimeout(() => URL.revokeObjectURL(url), 10000);

    return name;
  },
};
