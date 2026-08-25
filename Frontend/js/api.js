/* ============================================================
   js/api.js — Frontend API Client
   OPSTS – Online Project Supervision & Tracking System

   Centralised fetch wrapper used by every portal script to talk
   to the Node/Express backend. Handles:
     - base URL
     - attaching the JWT Authorization header
     - normalising success/error responses
     - auto-logout + redirect on 401 (expired/invalid token)
     - multipart file uploads (chapter submissions)

   Load order requirement: data.js, utils.js, api.js, app.js, ...
   (api.js depends on Utils.getToken/logout being defined first)
============================================================ */

"use strict";

/* ══════════════════════════════════════
   CONFIG
   Change this if your backend runs on a
   different host/port in production.
══════════════════════════════════════ */
const API_BASE_URL = "http://localhost:5000/api";

/* ══════════════════════════════════════
   CUSTOM ERROR TYPE
   Thrown on any non-2xx / success:false response.
   err.message  -> human-readable message from the server
   err.status   -> HTTP status code (0 = network/offline)
   err.data     -> full parsed JSON body, if any
══════════════════════════════════════ */
function ApiError(message, status, data) {
  this.name    = "ApiError";
  this.message = message;
  this.status  = status;
  this.data    = data;
}
ApiError.prototype = Object.create(Error.prototype);
ApiError.prototype.constructor = ApiError;

/* ══════════════════════════════════════
   Api — public client
══════════════════════════════════════ */
const Api = {

  baseUrl: API_BASE_URL,

  /**
   * Core request method. Not usually called directly —
   * use Api.get/post/put/patch/delete/upload instead.
   *
   * @param {string} method
   * @param {string} endpoint   e.g. "/auth/login"
   * @param {object|FormData} [body]
   * @param {object} [opts]     { skipAuthRedirect: true } to
   *                            suppress the auto-logout-on-401
   *                            behaviour (used by login/register
   *                            where a 401 just means "wrong
   *                            password", not "session expired").
   */
  async request(method, endpoint, body, opts) {
    opts = opts || {};

    const url     = this.baseUrl + endpoint;
    const headers = {};
    const token   = Utils.getToken();

    if (token) headers["Authorization"] = "Bearer " + token;

    const fetchOpts = { method: method, headers: headers };

    if (body instanceof FormData) {
      /* Let the browser set Content-Type (with boundary) itself */
      fetchOpts.body = body;
    } else if (body !== undefined && body !== null) {
      headers["Content-Type"] = "application/json";
      fetchOpts.body = JSON.stringify(body);
    }

    let response;
    try {
      response = await fetch(url, fetchOpts);
    } catch (networkErr) {
      throw new ApiError(
        "Cannot reach the server. Please check your connection or make sure the backend is running.",
        0,
        null
      );
    }

    let data = null;
    try {
      data = await response.json();
    } catch (parseErr) {
      data = null; /* empty body, e.g. some 204 responses */
    }

    /* Session expired / invalid token → force logout, unless caller opted out */
    if (response.status === 401 && !opts.skipAuthRedirect) {
      Utils.logout();
      return; /* logout() redirects; nothing more to do */
    }

    if (!response.ok || (data && data.success === false)) {
      const message = (data && data.message) || ("Request failed (HTTP " + response.status + ").");
      throw new ApiError(message, response.status, data);
    }

    return data;
  },

  get(endpoint, opts)         { return this.request("GET",    endpoint, null, opts); },
  post(endpoint, body, opts)  { return this.request("POST",   endpoint, body, opts); },
  put(endpoint, body, opts)   { return this.request("PUT",    endpoint, body, opts); },
  patch(endpoint, body, opts) { return this.request("PATCH",  endpoint, body, opts); },
  delete(endpoint, opts)      { return this.request("DELETE", endpoint, null, opts); },

  /**
   * Upload a file (e.g. chapter submission).
   * @param {string} endpoint
   * @param {FormData} formData  must already contain the file + fields
   */
  upload(endpoint, formData, opts) {
    return this.request("POST", endpoint, formData, opts);
  },
};