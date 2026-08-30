/* ============================================================
   js/notifications.js — Real-Time Notification System
   OPSTS – Online Project Supervision & Tracking System

   Backed by the real API (GET/PATCH /api/notifications/*).
   Notifications are created server-side (on submission, feedback,
   meeting scheduling, account approval — see the backend
   controllers), so this file only reads and marks read.

   Provides:
   - NotificationSystem.init(userId)   — call once per page
   - NotificationSystem.markRead(id)
   - NotificationSystem.markAllRead()
   - NotificationSystem.destroy()
   - Polling every 15s to keep the bell badge current
   - Bell dropdown panel

   Two rules govern where a notification is allowed to appear:

     1. The bell owns them. Nothing about a new notification is
        allowed to interrupt the page — no toast, no banner. The
        badge changes, and that is the whole announcement. Polling
        used to fire a toast for every batch of new activity, which
        put notification text at the bottom of the screen over
        whatever the user was actually doing.

     2. The panel is a popover, not page content. It lives in
        <body> but is positioned against the bell and hidden until
        .open. Give it no position and it lays out as the last
        block in the document, which is how "the notifications are
        printed at the bottom of every page" happens.
============================================================ */

"use strict";

var NotificationSystem = (function () {

  /* ── Private state ── */
  var _userId       = null;
  var _pollInterval = null;
  var _lastCount    = 0;
  var _dropdownOpen = false;
  var _cache        = []; /* last fetched notifications, for the dropdown */
  var _POLL_MS      = 15000;

  /* ── Notification type config (Font Awesome) ──
     The chip colour used to be written inline from
     --primary-light / --secondary-light / --warning-light /
     --danger-light / --gray-100. None of those tokens exist in
     this design system, so every var() was invalid at computed-
     value time: each icon rendered as an empty circle with an
     invisible glyph. The colour now comes from a class, styled
     in src/content.css out of the four status ramps the rest of
     the app uses — which also makes it follow the dark theme. */
  var TYPE_CONFIG = {
    submission: { icon: '<i class="fa-solid fa-upload"></i>',        cls: "ntf-icon-info",   label: "Submission" },
    feedback:   { icon: '<i class="fa-solid fa-comments"></i>',      cls: "ntf-icon-accent", label: "Feedback"   },
    meeting:    { icon: '<i class="fa-solid fa-calendar-days"></i>', cls: "ntf-icon-warn",   label: "Meeting"    },
    deadline:   { icon: '<i class="fa-solid fa-clock"></i>',         cls: "ntf-icon-risk",   label: "Deadline"   },
    approval:   { icon: '<i class="fa-solid fa-circle-check"></i>',  cls: "ntf-icon-ok",     label: "Approval"   },
    system:     { icon: '<i class="fa-solid fa-bell"></i>',          cls: "",               label: "System"     },
  };

  /* Messages are composed server-side from names and chapter labels
     that people typed, and they are written with innerHTML. */
  function esc(value) {
    return Utils.escapeHtml(value);
  }

  /* ══════════════════════════════════════
     PUBLIC: init
     Call once per page after session load.
  ══════════════════════════════════════ */
  async function init(userId) {
    if (!userId) return;
    _userId = userId;

    _buildDropdown();
    await _refreshUnreadCount();
    await _refreshDropdownList();
    _startPolling();
  }

  /* ══════════════════════════════════════
     PUBLIC: markRead
  ══════════════════════════════════════ */
  async function markRead(notifId) {
    try {
      await Api.patch("/notifications/" + notifId + "/read");
      var n = _cache.find(function (x) { return String(x.id) === String(notifId); });
      if (n) n.read = true;
      await _refreshUnreadCount();
      _renderDropdownList();
    } catch (err) {
      console.error("Failed to mark notification as read:", err.message);
    }
  }

  /* ══════════════════════════════════════
     PUBLIC: markAllRead
  ══════════════════════════════════════ */
  async function markAllRead() {
    try {
      await Api.patch("/notifications/read-all");
      _cache.forEach(function (n) { n.read = true; });
      await _refreshUnreadCount();
      _renderDropdownList();
    } catch (err) {
      /* A failure here is the one case worth surfacing: the user
         pressed a button and it did not do what it said. */
      if (typeof showToast === "function") {
        showToast(err.message || "Could not mark notifications as read.", "error");
      }
    }
  }

  /* ══════════════════════════════════════
     PUBLIC: destroy
  ══════════════════════════════════════ */
  function destroy() {
    if (_pollInterval) {
      clearInterval(_pollInterval);
      _pollInterval = null;
    }
  }

  /* ══════════════════════════════════════
     PRIVATE: polling
     Badge only. See rule 1 at the top of this file — a poll must
     never put a message on screen.
  ══════════════════════════════════════ */
  function _startPolling() {
    if (_pollInterval) clearInterval(_pollInterval);

    _pollInterval = setInterval(async function () {
      try {
        var res     = await Api.get("/notifications/unread-count");
        var current = res.count;

        /* Only re-fetch the list when the count actually moved; the
           panel refreshes itself on open anyway. */
        if (current !== _lastCount) await _refreshDropdownList();

        _lastCount = current;
        _updateBadges(current);
      } catch (err) {
        /* Silent fail on poll — a network hiccup shouldn't spam the user */
      }
    }, _POLL_MS);
  }

  /* ══════════════════════════════════════
     PRIVATE: fetch helpers
  ══════════════════════════════════════ */
  async function _refreshUnreadCount() {
    try {
      var res = await Api.get("/notifications/unread-count");
      _lastCount = res.count;
      _updateBadges(res.count);
    } catch (err) {
      /* ignore — badges just won't update this cycle */
    }
  }

  async function _refreshDropdownList() {
    try {
      var res = await Api.get("/notifications");
      _cache = res.notifications || [];
      _renderDropdownList();
    } catch (err) {
      /* ignore */
    }
  }

  /* ══════════════════════════════════════
     PRIVATE: _buildDropdown
  ══════════════════════════════════════ */
  function _buildDropdown() {
    /* The dropdown used to ship its own <style> block, injected here
       at runtime with colours hard-coded to #fff — which meant it
       ignored the dark theme entirely. Those rules now live in
       src/content.css (#ntf-dropdown and .ntf-drop-*), so they
       are built with the rest of the stylesheet and theme correctly. */

    if (document.getElementById("ntf-dropdown")) return;

    /* No bell means no way to open or close the panel, so building
       it would only leave an unreachable element in the document. */
    var bellBtn = document.getElementById("notifBtn") || document.getElementById("ntf-bell-btn");
    if (!bellBtn) return;

    var dropdown = document.createElement("div");
    dropdown.id  = "ntf-dropdown";
    dropdown.setAttribute("role", "dialog");
    dropdown.setAttribute("aria-label", "Notifications");
    dropdown.innerHTML =
      '<div class="ntf-drop-header">' +
      '<h4><i class="fa-solid fa-bell"></i>Notifications</h4>' +
      '<button type="button" id="ntf-mark-all">Mark all as read</button>' +
      "</div>" +
      '<div class="ntf-drop-list" id="ntf-drop-list"></div>' +
      '<div class="ntf-drop-footer">' +
      '<a href="notifications.html">View all notifications <i class="fa-solid fa-arrow-right"></i></a>' +
      "</div>";
    document.body.appendChild(dropdown);

    var markAllBtn = document.getElementById("ntf-mark-all");
    if (markAllBtn) {
      markAllBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        markAllRead();
      });
    }

    bellBtn.id = "ntf-bell-btn";
    bellBtn.setAttribute("aria-haspopup", "dialog");
    bellBtn.setAttribute("aria-expanded", "false");
    bellBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      _toggleDropdown();
    });

    /* Click-away, Escape and reflow are wired once, here, rather
       than once per init() call. */
    document.addEventListener("click", function (e) {
      if (!_dropdownOpen) return;
      if (dropdown.contains(e.target) || bellBtn.contains(e.target)) return;
      _closeDropdown();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && _dropdownOpen) {
        _closeDropdown();
        bellBtn.focus();
      }
    });

    /* The panel is anchored to the bell in viewport coordinates, so
       anything that moves the bell has to move the panel too. */
    window.addEventListener("resize", function () {
      if (_dropdownOpen) _positionDropdown();
    });
    window.addEventListener("scroll", function () {
      if (_dropdownOpen) _positionDropdown();
    }, true);
  }

  /* ══════════════════════════════════════
     PRIVATE: _renderDropdownList
  ══════════════════════════════════════ */
  function _renderDropdownList() {
    var listEl = document.getElementById("ntf-drop-list");
    if (!listEl) return;

    if (_cache.length === 0) {
      listEl.innerHTML =
        '<div class="ntf-drop-empty"><i class="fa-solid fa-bell"></i>No notifications yet.</div>';
      return;
    }

    listEl.innerHTML = _cache.slice(0, 10).map(function (n) {
      var cfg = TYPE_CONFIG[n.type] || TYPE_CONFIG.system;
      return '<div class="ntf-drop-item ' + (n.read ? "" : "unread") + '" data-ntf-id="' + esc(n.id) + '">' +
        '<div class="ntf-drop-icon ' + cfg.cls + '">' + cfg.icon + "</div>" +
        '<div style="flex:1;min-width:0;">' +
        '<div class="ntf-drop-msg">' + esc(n.message) + "</div>" +
        '<div class="ntf-drop-time">' + esc(Utils.timeAgo(n.date)) + "</div>" +
        "</div>" +
        (!n.read ? '<div class="ntf-unread-dot"></div>' : "") +
        "</div>";
    }).join("");

    listEl.querySelectorAll(".ntf-drop-item").forEach(function (item) {
      item.addEventListener("click", function () {
        var id = item.dataset.ntfId;
        var n  = _cache.find(function (x) { return String(x.id) === String(id); });

        /* Mark read, then follow the notification where it points.
           The row was a dead end before: it cleared its own badge
           and left the user to go and find the meeting or the
           feedback themselves. `link` is a bare page name written
           by the backend ("feedback.html"), and each portal keeps
           its pages in one folder, so it resolves as a sibling.
           Anything that is not a plain page name is ignored rather
           than navigated to. */
        markRead(id);
        _closeDropdown();

        var target = n && n.link;
        if (target && /^[\w.-]+\.html$/.test(target)) {
          window.location.href = target;
        }
      });
    });
  }

  /* ══════════════════════════════════════
     PRIVATE: dropdown open/close
  ══════════════════════════════════════ */
  function _toggleDropdown() {
    if (_dropdownOpen) _closeDropdown();
    else _openDropdown();
  }

  /** Hang the panel off the bell, clamped to the viewport. */
  function _positionDropdown() {
    var dropdown = document.getElementById("ntf-dropdown");
    var bell     = document.getElementById("ntf-bell-btn");
    if (!dropdown || !bell) return;

    var rect = bell.getBoundingClientRect();
    var gap  = 8;

    dropdown.style.top = (rect.bottom + gap) + "px";

    /* Below 640px the stylesheet pins the panel to both edges as a
       sheet; setting `right` here would fight it. */
    if (window.matchMedia("(max-width: 640px)").matches) {
      dropdown.style.right = "";
      return;
    }

    /* Right-aligned to the bell — `right` is measured from the
       right edge of the viewport, which is what the bell's own
       distance from that edge gives us. */
    dropdown.style.right = Math.max(gap, window.innerWidth - rect.right) + "px";
  }

  function _openDropdown() {
    var dropdown = document.getElementById("ntf-dropdown");
    if (!dropdown) return;

    _positionDropdown();
    dropdown.classList.add("open");
    _dropdownOpen = true;

    var bell = document.getElementById("ntf-bell-btn");
    if (bell) bell.setAttribute("aria-expanded", "true");

    _refreshDropdownList();
  }

  function _closeDropdown() {
    var dropdown = document.getElementById("ntf-dropdown");
    if (!dropdown) return;

    dropdown.classList.remove("open");
    _dropdownOpen = false;

    var bell = document.getElementById("ntf-bell-btn");
    if (bell) bell.setAttribute("aria-expanded", "false");
  }

  /* ══════════════════════════════════════
     PRIVATE: _updateBadges
     Syncs the sidebar badge + topbar dot.
  ══════════════════════════════════════ */
  function _updateBadges(count) {
    var ntfBadge = document.getElementById("ntfBadge");
    var ntfDot   = document.getElementById("ntfDot");

    if (ntfBadge) {
      if (count > 0) {
        ntfBadge.textContent = count;
        ntfBadge.classList.remove("hidden");
      } else {
        ntfBadge.classList.add("hidden");
      }
    }

    if (ntfDot) {
      if (count > 0) ntfDot.classList.remove("hidden");
      else ntfDot.classList.add("hidden");
    }
  }

  /* ══════════════════════════════════════
     PUBLIC API
  ══════════════════════════════════════ */
  return {
    init:        init,
    markRead:    markRead,
    markAllRead: markAllRead,
    destroy:     destroy,
  };

})();
