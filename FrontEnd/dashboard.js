import { core } from "./core.js";

// Gate by session 
document.addEventListener("DOMContentLoaded", async () => {
  try {
    const res = await fetch("/api/session/me", { credentials: "include" });
    if (!res.ok) throw new Error("no session");
    document.body.classList.remove("unauth");
  } catch {
    document.body.classList.add("unauth");
  }
});

const Dashboard = (() => {
  const el = {
    // auth
    loginSection: core.$("#loginSection"),
    appSection: core.$("#appSection"),
    loginForm: core.$("#loginForm"),
    loginEmail: core.$("#loginEmail"),
    loginPassword: core.$("#loginPassword"),
    logoutBtn: core.$("#logoutBtn"),

    // chrome
    adminBtn: document.getElementById("adminBtn"),
    dashToCatalogBtn: document.getElementById("dashToCatalogBtn"),
    dashRange: document.getElementById("dashRange"),
    exportBtn: document.getElementById("dashboardExportBtn"),

    // stats
    totalItems: document.getElementById("stat_total_items"),
    checkedOut: document.getElementById("stat_checked_out"),
    overdue: document.getElementById("stat_overdue"),
    holders: document.getElementById("stat_holders"),
    bySystem: document.getElementById("stat_by_system"),
    movementsSummary: document.getElementById("stat_movements_summary"),
    recentMovements: document.getElementById("dash_recent_movements"),
    updated: document.getElementById("dash_updated"),
  };

  async function init() {
    bindAuth();
    bindChrome();

    try {
      await core.me();
      document.body.classList.remove("unauth");
      core.hide(el.loginSection);
      core.show(el.appSection);
      core.applyRoleVisibility();
      bindAdminNav();
      await loadStats();
    } catch {
      document.body.classList.add("unauth");
      core.show(el.loginSection);
      core.hide(el.appSection);
    }

    el.dashRange?.addEventListener("change", () => loadStats());
  }

  /* ---------------- Auth ---------------- */

  function bindAuth() {
    el.loginForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await core.login(el.loginEmail.value.trim(), el.loginPassword.value);
        document.body.classList.remove("unauth");
        core.hide(el.loginSection);
        core.show(el.appSection);
        core.applyRoleVisibility();
        bindAdminNav();
        await loadStats();
      } catch (err) {
        core.toast(`Login failed: ${err.message}`, "error");
      }
    });

    el.logoutBtn?.addEventListener("click", async () => {
      await core.logout();
      document.body.classList.add("unauth");
      core.show(el.loginSection);
      core.hide(el.appSection);
      core.applyRoleVisibility();
      try {
        localStorage.removeItem("filters");
      } catch {}
    });
  }

  /* ---------------- Chrome / nav ---------------- */

  function bindChrome() {
    // Back to catalogue
    el.dashToCatalogBtn?.addEventListener("click", () => {
      window.location.href = "index.html";
    });

    // Export PDF (backend to be implemented as /api/stats/export-pdf)
    el.exportBtn?.addEventListener("click", () => {
      const range = el.dashRange?.value || "7d";
      const url = new URL("/api/stats/export-pdf", window.location.origin);
      url.searchParams.set("range", range);
      window.open(url.toString(), "_self");
    });
  }

  function bindAdminNav() {
    const adminBtn = el.adminBtn;
    if (!adminBtn) return;
    const isAdmin =
      !!core.state.currentUser &&
      String(core.state.currentUser.role || "").toLowerCase() === "admin";

    adminBtn.hidden = !isAdmin;
    if (isAdmin && !adminBtn._bound) {
      adminBtn.addEventListener("click", () => {
        // reuse the admin section inside index.html
        window.location.href = "index.html#admin";
      });
      adminBtn._bound = true;
    }
  }

  /* ---------------- Stats load + render ---------------- */

  function getRangeParam() {
    return el.dashRange?.value || "7d";
  }

  async function loadStats() {
    const range = getRangeParam();
    try {
      const data = await core.api.get("/api/stats", { range });

      // Shape we expect from backend (you can match this in FastAPI):
      // {
      //   total_items,
      //   checked_out_items,
      //   overdue_items,
      //   active_holders,
      //   movements_count,
      //   systems: [{ system_code, total_items, checked_out_items }],
      //   recent_movements: [
      //      { item_name, sku, kind, quantity, holder, timestamp, system_code, shelf_label }
      //   ],
      //   generated_at
      // }

      const {
        total_items = 0,
        checked_out_items = 0,
        overdue_items = 0,
        active_holders = 0,
        movements_count = 0,
        systems = [],
        recent_movements = [],
        generated_at = null,
      } = data || {};

      if (el.totalItems) el.totalItems.textContent = String(total_items);
      if (el.checkedOut) el.checkedOut.textContent = String(checked_out_items);
      if (el.overdue) el.overdue.textContent = String(overdue_items);
      if (el.holders) el.holders.textContent = String(active_holders);

      if (el.movementsSummary) {
        el.movementsSummary.textContent =
          movements_count > 0
            ? `${movements_count} movements`
            : "No movements in this range";
      }

      renderBySystem(systems);
      renderRecentMovements(recent_movements);

      if (el.updated) {
        const when = generated_at ? dayjs(generated_at).format("DD MMM, HH:mm") : "—";
        const label = el.dashRange?.selectedOptions?.[0]?.textContent || "";
        el.updated.textContent = `Last updated: ${when} • Range: ${label}`;
      }
    } catch (err) {
      core.toast(`Failed to load dashboard stats: ${err.message}`, "error");
    }
  }

  function renderBySystem(systems) {
    if (!el.bySystem) return;
    const rows = Array.isArray(systems) ? systems : [];

    if (!rows.length) {
      el.bySystem.innerHTML = `<li><span class="label">No data</span><span class="value">—</span></li>`;
      return;
    }

    el.bySystem.innerHTML = rows
      .map((row) => {
        const code = row.system_code ?? "—";
        const total = row.total_items ?? 0;
        const out = row.checked_out_items ?? 0;
        return `
          <li>
            <span class="label">${code}</span>
            <span class="value">${out}/${total} out</span>
          </li>
        `;
      })
      .join("");
  }

  function renderRecentMovements(list) {
    if (!el.recentMovements) return;
    const items = Array.isArray(list) ? list : [];

    if (!items.length) {
      el.recentMovements.innerHTML =
        `<li><span class="label">No movements in this range.</span><span class="value">—</span></li>`;
      return;
    }

    el.recentMovements.innerHTML = items
      .map((m) => {
        const when = m.timestamp ? dayjs(m.timestamp).fromNow() : "";
        const itemName = m.item_name || "Item";
        const sku = m.sku ? ` (${m.sku})` : "";
        const qty = m.quantity ?? 0;
        const kind = (m.kind || "").toUpperCase();
        const holder = m.holder ? ` • ${m.holder}` : "";
        const loc = m.system_code && m.shelf_label
          ? ` @ ${m.system_code}/${m.shelf_label}`
          : "";

        return `
          <li>
            <span class="label">
              <strong>${kind}</strong> • ${itemName}${sku}${loc}${holder}
            </span>
            <span class="value">
              ${qty} • ${when}
            </span>
          </li>
        `;
      })
      .join("");
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", Dashboard.init);
