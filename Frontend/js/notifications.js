/* ============================================================
   js/notifications.js — Real-Time Notification System
   OPSTS – Online Project Supervision & Tracking System

   Now backed by the real API (GET/PATCH /api/notifications/*)
   instead of the DB_NOTIFICATIONS mock array. Notifications
   themselves are created server-side (on submission, feedback,
   meeting scheduling, etc. — see the backend controllers), so
   this file only reads/marks-read; it no longer needs a
   client-side create() helper.

   Provides:
   - NotificationSystem.init(userId)   — call once per page
   - NotificationSystem.markRead(id)
   - NotificationSystem.markAllRead()
   - NotificationSystem.destroy()
   - Polling every 15s for new notifications (toast + badge update)
   - Bell dropdown panel
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

  /* ── Notification type config (Font Awesome) ── */
  var TYPE_CONFIG = {
    submission: { icon: '<i class="fa-solid fa-upload"></i>',        color: "var(--primary-light)",   label: "Submission" },
    feedback:   { icon: '<i class="fa-solid fa-comments"></i>',      color: "var(--secondary-light)", label: "Feedback"   },
    meeting:    { icon: '<i class="fa-solid fa-calendar-days"></i>', color: "var(--warning-light)",   label: "Meeting"    },
    deadline:   { icon: '<i class="fa-solid fa-clock"></i>',         color: "var(--danger-light)",    label: "Deadline"   },
    approval:   { icon: '<i class="fa-solid fa-circle-check"></i>',  color: "var(--secondary-light)", label: "Approval"   },
    system:     { icon: '<i class="fa-solid fa-bell"></i>',          color: "var(--gray-100)",        label: "System"     },
  };

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

    document.addEventListener("click", function (e) {
      var dropdown = document.getElementById("ntf-dropdown");
      var bell     = document.getElementById("ntf-bell-btn");
      if (dropdown && bell &&
          !dropdown.contains(e.target) &&
          !bell.contains(e.target)) {
        _closeDropdown();
      }
    });
  }

  /* ══════════════════════════════════════
     PUBLIC: markRead
  ══════════════════════════════════════ */
  async function markRead(notifId) {
    try {
      await Api.patch("/notifications/" + notifId + "/read");
      var n = _cache.find(function (x) { return x.id === notifId; });
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
      if (typeof showToast === "function") {
        showToast("All notifications marked as read.", "success");
      }
    } catch (err) {
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
     PRIVATE: polling for new notifications
  ══════════════════════════════════════ */
  function _startPolling() {
    if (_pollInterval) clearInterval(_pollInterval);

    _pollInterval = setInterval(async function () {
      try {
        var res     = await Api.get("/notifications/unread-count");
        var current = res.count;

        if (current > _lastCount) {
          var diff = current - _lastCount;
          if (typeof showToast === "function") {
            showToast(
              '<i class="fa-solid fa-bell"></i> You have ' + diff + " new notification" + (diff > 1 ? "s" : "") + ".",
              "info",
              4000
            );
          }
          await _refreshDropdownList();
        }

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
      _cache = res.notifications;
      _renderDropdownList();
    } catch (err) {
      /* ignore */
    }
  }

  /* ══════════════════════════════════════
     PRIVATE: _buildDropdown
  ══════════════════════════════════════ */
  function _buildDropdown() {
    if (!document.getElementById("ntf-styles")) {
      var style = document.createElement("style");
      style.id  = "ntf-styles";
      style.textContent = [
        "#ntf-dropdown{position:fixed;top:66px;right:20px;width:360px;max-height:480px;",
        "background:#fff;border:1px solid var(--gray-200);border-radius:var(--radius-lg);",
        "box-shadow:var(--shadow-lg);z-index:500;display:none;flex-direction:column;",
        "overflow:hidden;animation:ntfSlideIn .2s ease;}",
        "#ntf-dropdown.open{display:flex;}",
        "@keyframes ntfSlideIn{from{opacity:0;transform:translateY(-8px);}to{opacity:1;transform:translateY(0);}}",
        ".ntf-drop-header{display:flex;align-items:center;justify-content:space-between;",
        "padding:14px 16px;border-bottom:1px solid var(--gray-200);flex-shrink:0;}",
        ".ntf-drop-header h4{font-size:var(--font-size-sm);font-weight:700;color:var(--gray-900);}",
        ".ntf-drop-header h4 i{margin-right:6px;}",
        ".ntf-drop-header button{font-size:var(--font-size-xs);color:var(--primary);",
        "background:none;border:none;cursor:pointer;font-weight:600;}",
        ".ntf-drop-header button:hover{text-decoration:underline;}",
        ".ntf-drop-list{overflow-y:auto;flex:1;}",
        ".ntf-drop-list::-webkit-scrollbar{width:4px;}",
        ".ntf-drop-list::-webkit-scrollbar-thumb{background:var(--gray-300);border-radius:4px;}",
        ".ntf-drop-item{display:flex;align-items:flex-start;gap:12px;padding:12px 16px;",
        "border-bottom:1px solid var(--gray-200);cursor:pointer;transition:background .2s ease;}",
        ".ntf-drop-item:last-child{border-bottom:none;}",
        ".ntf-drop-item:hover{background:var(--gray-50);}",
        ".ntf-drop-item.unread{background:var(--primary-light);}",
        ".ntf-drop-item.unread:hover{background:#d2e3fc;}",
        ".ntf-drop-icon{width:34px;height:34px;border-radius:50%;display:flex;",
        "align-items:center;justify-content:center;font-size:1rem;flex-shrink:0;}",
        ".ntf-drop-msg{font-size:var(--font-size-xs);color:var(--gray-800);line-height:1.5;flex:1;}",
        ".ntf-drop-time{font-size:.68rem;color:var(--gray-500);margin-top:3px;}",
        ".ntf-unread-dot{width:8px;height:8px;border-radius:50%;background:var(--primary);",
        "flex-shrink:0;margin-top:5px;}",
        ".ntf-drop-empty{text-align:center;padding:32px 20px;color:var(--gray-500);",
        "font-size:var(--font-size-sm);}",
        ".ntf-drop-empty i{font-size:1.8rem;display:block;margin-bottom:8px;color:var(--gray-400);}",
        ".ntf-drop-footer{padding:10px 16px;border-top:1px solid var(--gray-200);",
        "text-align:center;flex-shrink:0;}",
        ".ntf-drop-footer a{font-size:var(--font-size-xs);color:var(--primary);font-weight:600;}",
      ].join("");
      document.head.appendChild(style);
    }

    var dropdown = document.createElement("div");
    dropdown.id  = "ntf-dropdown";
    dropdown.innerHTML =
      '<div class="ntf-drop-header">' +
      '<h4><i class="fa-solid fa-bell"></i>Notifications</h4>' +
      '<button id="ntf-mark-all">Mark all as read</button>' +
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

    var bellBtn = document.getElementById("notifBtn");
    if (bellBtn) {
      bellBtn.id = "ntf-bell-btn";
      bellBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        _toggleDropdown();
      });
    }
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
      return '<div class="ntf-drop-item ' + (n.read ? "" : "unread") + '" data-ntf-id="' + n.id + '">' +
        '<div class="ntf-drop-icon" style="background:' + cfg.color + ';">' + cfg.icon + "</div>" +
        '<div style="flex:1;">' +
        '<div class="ntf-drop-msg">' + n.message + "</div>" +
        '<div class="ntf-drop-time">' + Utils.timeAgo(n.date) + "</div>" +
        "</div>" +
        (!n.read ? '<div class="ntf-unread-dot"></div>' : "") +
        "</div>";
    }).join("");

    listEl.querySelectorAll(".ntf-drop-item").forEach(function (item) {
      item.addEventListener("click", function () {
        markRead(item.dataset.ntfId);
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

  function _openDropdown() {
    var dropdown = document.getElementById("ntf-dropdown");
    if (dropdown) {
      dropdown.classList.add("open");
      _dropdownOpen = true;
      _refreshDropdownList();
    }
  }

  function _closeDropdown() {
    var dropdown = document.getElementById("ntf-dropdown");
    if (dropdown) {
      dropdown.classList.remove("open");
      _dropdownOpen = false;
    }
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