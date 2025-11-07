export const core = (() => {
  const state = {
    currentUser: null,
  };

  // ---------- Fetch wrapper ----------
  async function request(method, url, { params, body } = {}) {
    const u = new URL(url, window.location.origin);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
      }
    }
    const res = await fetch(u.toString(), {
      method,
      credentials: "include",
      headers: body instanceof FormData ? undefined : { "Content-Type": "application/json" },
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    let data;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) {
      const msg = (data && (data.detail || data.message)) || res.statusText || "Request failed";
      throw new Error(msg);
    }
    return data;
  }

  const api = {
    get: (url, params) => request("GET", url, { params }),
    post: (url, body) => request("POST", url, { body }),
    put: (url, body) => request("PUT", url, { body }),
    del: (url, params) => request("DELETE", url, { params }),
  };

  // ---------- Session ----------
  async function me() {
    try {
      const u = await api.get("/api/session/me");
      state.currentUser = u;
      return u;
    } catch {
      state.currentUser = null;
      throw new Error("Not authenticated");
    }
    
  }
  async function login(email, password) {
    const u = await api.post("/api/session/login", { email, password });
    state.currentUser = u;
    return u;
  }
  async function logout() {
    await api.post("/api/session/logout");
    state.currentUser = null;
  }

  // ---------- Utils ----------
  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.from(document.querySelectorAll(sel)); }
  function show(el) { if (el) el.hidden = false; }
  function hide(el) { if (el) el.hidden = true; }
  function setText(el, text) { if (el) el.textContent = text; }
  function serializeForm(form) {
    const d = {};
    if (!form) return d;
    new FormData(form).forEach((v, k) => { d[k] = v; });
    return d;
  }
  function debounce(fn, ms = 300) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }
  function toast(msg, type = "info") {
    console.log(`[${type}]`, msg);
    // You can hook your existing toast UI here.
  }

  // ---------- Persist (filters, etc.) ----------
  const persist = {
    get(key, def = null) {
      try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? def; } catch { return def; }
    },
    set(key, val) {
      localStorage.setItem(key, JSON.stringify(val));
    },
  };

  // ---------- Tiny event bus ----------
  const bus = (() => {
    const map = new Map();
    return {
      on(ev, fn) { if (!map.has(ev)) map.set(ev, new Set()); map.get(ev).add(fn); },
      off(ev, fn) { map.get(ev)?.delete(fn); },
      emit(ev, payload) { map.get(ev)?.forEach(fn => fn(payload)); },
    };
  })();

  // ---------- Role helpers ----------
  function guardAdmin() {
    if (!state.currentUser || state.currentUser.role !== "admin") throw new Error("Admin required");
  }
  function applyRoleVisibility() {
    const isAdmin = !!(state.currentUser && state.currentUser.role === "admin");
    $all("[data-requires-role='admin']").forEach(el => { el.hidden = !isAdmin; });
    setText($("#roleBadge"), state.currentUser ? `${state.currentUser.role}` : "");
    if ($("#logoutBtn")) $("#logoutBtn").hidden = !state.currentUser;
  }

  return {
    api, me, login, logout, state,
    $, $all, show, hide, setText,
    serializeForm, debounce, toast,
    persist, bus, guardAdmin, applyRoleVisibility,
  };
})();
