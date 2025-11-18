// admin.js
import { core } from "./core.js";

export const Admin = (() => {
  let systemsCache = [];
  let shelvesCache = [];

  const el = {
    // systems
    systemsTable:  document.getElementById("systemsTable"),
    systemForm:    document.getElementById("systemForm"),

    // shelves
    shelvesTable:  document.getElementById("shelvesTable"),
    shelfForm:     document.getElementById("shelfForm"),
    shelfSysSel:   document.getElementById("shelf_system_id"),

    // users
    usersTable:    document.getElementById("usersTable"),
    userForm:      document.getElementById("userForm"),

    // admin-only controls
    incDel:        document.getElementById("include_deleted_admin"),
    backBtn:       document.getElementById("backToCatalogBtn"),
  };

  // ------------- Admin "Show deleted" prefs -------------
  function getIncludeDeletedPref() {
    const prefs = core.persist.get("admin_prefs", { include_deleted: false });
    return !!prefs.include_deleted;
  }
  function setIncludeDeletedPref(v) {
    const next = { ...(core.persist.get("admin_prefs", {})), include_deleted: !!v };
    core.persist.set("admin_prefs", next);

    core.bus.emit("admin:include_deleted_changed", { include_deleted: !!v });
  }
  function hydrateIncDelToggle(checked) {
    if (!el.incDel) return;
    el.incDel.checked = !!checked;
    el.incDel.setAttribute("aria-checked", checked ? "true" : "false");
  }

 
  function optionifySystems(selectEl) {
    if (!selectEl) return;
    const prev = selectEl.value;
    selectEl.innerHTML =
      `<option value="" disabled selected>Choose a system</option>` +
      systemsCache.map(s => `<option value="${s.id}">${s.code}</option>`).join("");
    if (prev && systemsCache.some(s => String(s.id) === String(prev))) {
      selectEl.value = prev;
    }
  }

  function sysById(id) {
    return systemsCache.find(s => String(s.id) === String(id));
  }


  async function loadSystems(include_deleted) {
    systemsCache = await core.api.get("/api/systems", { include_deleted: !!include_deleted }).catch(() => []);
    optionifySystems(el.shelfSysSel);      
    renderSystemsTable(systemsCache);
  }

  async function loadShelves(include_deleted) {
    const rows = await core.api.get("/api/shelves", { include_deleted: !!include_deleted }).catch(() => []);
    shelvesCache = Array.isArray(rows) ? rows : [];
    renderShelvesTable(shelvesCache);
  }

  async function loadUsers() {
    if (!el.usersTable) return;

    let rows = [];
    try {
      rows = await core.api.get("/api/users/admin");
      if (!Array.isArray(rows)) rows = [];
    } catch (err) {
      console.error("Failed to load users", err);
      el.usersTable.innerHTML = `<tr><td>Failed to load users.</td></tr>`;
      return;
    }

    if (!rows.length) {
      el.usersTable.innerHTML = `<tr><td>No users yet.</td></tr>`;
      return;
    }

    el.usersTable.innerHTML = rows
      .map((r) => {
        const cl = r.max_clearance_level == null ? "—" : r.max_clearance_level;
        const created = r.created_at ?? "";
        return `
          <tr data-id="${r.id}">
            <td>${r.email}</td>
            <td>${r.name ?? ""}</td>
            <td>${r.role}</td>
            <td>${cl}</td>
            <td>${created}</td>
          </tr>
        `;
      })
      .join("");
  }

  // ---------------- Renderers ----------------
  function renderSystemsTable(rows = []) {
    if (!el.systemsTable) return;

    if (!rows.length) {
      el.systemsTable.innerHTML = `<tr><td>No systems yet.</td></tr>`;
      return;
    }

    el.systemsTable.innerHTML = rows.map(r => {
      const isDel = Number(r.is_deleted ?? 0) === 1;
      return `
        <tr data-id="${r.id}" class="${isDel ? "row-deleted" : ""}">
          <td><strong>${r.code}</strong></td>
          <td>${r.notes ?? ""}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-compact adm-edit" data-kind="system">Edit</button>
            <button class="btn btn-compact adm-del" data-kind="system" title="${isDel ? "Restore system" : "Soft delete system"}">
              ${isDel ? "Restore" : "Delete"}
            </button>
          </td>
        </tr>
      `;
    }).join("");

    el.systemsTable.onclick = async (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const tr = btn.closest("tr[data-id]");
      if (!tr) return;
      const id = tr.dataset.id;

      if (btn.classList.contains("adm-edit")) {
        const row = systemsCache.find(s => String(s.id) === String(id));
        if (!row || !el.systemForm) return;
        el.systemForm.elements.id.value    = row.id;
        el.systemForm.elements.code.value  = row.code;
        el.systemForm.elements.notes.value = row.notes ?? "";
        el.systemForm.scrollIntoView({ behavior: "smooth" });
      }

      if (btn.classList.contains("adm-del")) {
        const wantsRestore = /restore/i.test(btn.textContent || "");
        try {
          if (wantsRestore) {
            await core.api.post(`/api/systems/${id}/restore`, {});
          } else {
            await core.api.del(`/api/systems/${id}`);
          }
          const inc = getIncludeDeletedPref();
          await loadSystems(inc);
          await loadShelves(inc);
        } catch (err) {
          core.toast(String(err.message || err), "error");
        }
      }
    };
  }

  function renderShelvesTable(rows = []) {
    if (!el.shelvesTable) return;

    if (!rows.length) {
      el.shelvesTable.innerHTML = `<tr><td>No shelves yet.</td></tr>`;
      return;
    }

    el.shelvesTable.innerHTML = rows.map(r => {
      const sys = sysById(r.system_id);
      const dims = [r.length_mm, r.width_mm, r.height_mm].map(v => v ?? "—").join(" × ");
      const isDel = Number(r.is_deleted ?? 0) === 1;
      return `
        <tr data-id="${r.id}" class="${isDel ? "row-deleted" : ""}">
          <td>${sys ? sys.code : `#${r.system_id}`}</td>
          <td><strong>${r.label}</strong></td>
          <td>${dims}</td>
          <td>${r.ordinal ?? "—"}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-compact adm-edit" data-kind="shelf">Edit</button>
            <button class="btn btn-compact adm-del" data-kind="shelf" title="${isDel ? "Restore shelf" : "Soft delete shelf"}">
              ${isDel ? "Restore" : "Delete"}
            </button>
          </td>
        </tr>
      `;
    }).join("");

    el.shelvesTable.onclick = async (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const tr = btn.closest("tr[data-id]");
      if (!tr) return;
      const id = tr.dataset.id;

      if (btn.classList.contains("adm-edit")) {
        try {
          const sh = await core.api.get(`/api/shelves/${id}`);
          optionifySystems(el.shelfSysSel);
          const f = el.shelfForm.elements;
          f.id.value         = sh.id;
          f.system_id.value  = sh.system_id;
          f.label.value      = sh.label;
          f.length_mm.value  = sh.length_mm ?? "";
          f.width_mm.value   = sh.width_mm ?? "";
          f.height_mm.value  = sh.height_mm ?? "";
          f.ordinal.value    = sh.ordinal ?? "";
          el.shelfForm.scrollIntoView({ behavior: "smooth" });
        } catch (err) {
          core.toast(String(err.message || err), "error");
        }
      }

      if (btn.classList.contains("adm-del")) {
        const wantsRestore = /restore/i.test(btn.textContent || "");
        try {
          if (wantsRestore) {
            await core.api.post(`/api/shelves/${id}/restore`, {});
          } else {
            await core.api.del(`/api/shelves/${id}`);
          }
          const inc = getIncludeDeletedPref();
          await loadShelves(inc);
        } catch (err) {
          core.toast(String(err.message || err), "error");
        }
      }
    };
  }

  // ---------------- Binders ----------------
  function bindSystemForm() {
    if (!el.systemForm) return;
    el.systemForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(el.systemForm);
      const id    = (fd.get("id")    || "").toString().trim();
      const code  = (fd.get("code")  || "").toString().trim();
      const notes = (fd.get("notes") || "").toString().trim();

      if (!code) { core.toast("System code is required.", "error"); return; }

      try {
        if (id) {
          await core.api.put(`/api/systems/${id}`, { code, notes });
        } else {
          await core.api.post(`/api/systems`, { code, notes });
        }
        core.toast("System saved", "success");
        el.systemForm.reset();
        const inc = getIncludeDeletedPref();
        await loadSystems(inc);
        await loadShelves(inc);  
      } catch (err) {
        core.toast(String(err.message || err), "error");
      }
    });
  }

  function bindShelfForm() {
    if (!el.shelfForm) return;
    optionifySystems(el.shelfSysSel);

    el.shelfForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(el.shelfForm);

      const id         = (fd.get("id") || "").toString().trim();
      const system_id  = Number(fd.get("system_id") || 0);
      const label      = (fd.get("label") || "").toString().trim();
      const length_mm  = Number(fd.get("length_mm") || 0);
      const width_mm   = Number(fd.get("width_mm")  || 0);
      const height_mm  = Number(fd.get("height_mm") || 0);
      const ordinalRaw = fd.get("ordinal");
      const ordinal    = (ordinalRaw === null || ordinalRaw === "") ? null : Number(ordinalRaw);

      if (!system_id) { core.toast("Please choose a system.", "error"); return; }
      if (!label)     { core.toast("Shelf label is required.", "error"); return; }
      if (!length_mm || !width_mm || !height_mm) {
        core.toast("Length, width, and height are required.", "error"); return;
      }

      const payload = { system_id, label, length_mm, width_mm, height_mm };
      if (ordinal !== null && !Number.isNaN(ordinal)) payload.ordinal = ordinal;

      try {
        if (id) {
          await core.api.put(`/api/shelves/${id}`, payload);
        } else {
          await core.api.post(`/api/shelves`, payload);
        }
        core.toast("Shelf saved", "success");
        el.shelfForm.reset();
        el.shelfSysSel.value = String(system_id);
        const inc = getIncludeDeletedPref();
        await loadShelves(inc);
      } catch (err) {
        core.toast(String(err.message || err), "error");
      }
    });
  }

    function bindUserForm() {
    if (!el.userForm) return;

    el.userForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = el.userForm.elements;

      const payload = {
        email: (f.email.value || "").trim(),
        name: (f.name.value || "").trim(),
        role: (f.role.value || "").trim(),
        password: f.password.value || "",
        max_clearance_level: f.max_clearance_level.value
          ? Number(f.max_clearance_level.value)
          : null,
      };

      if (!payload.email || !payload.name || !payload.role || !payload.password) {
        core.toast("Email, name, role, and password are required.", "error");
        return;
      }

      try {
        await core.api.post("/api/users", payload);
        core.toast("User created", "success");
        el.userForm.reset();
        await loadUsers(); 
      } catch (err) {
        core.toast(err.message || String(err), "error");
      }
    });
  }


  // ---------------- Back button ----------------
  function bindBackButton() {
    const btn = el.backBtn;
    if (!btn || btn._bound) return;
    btn.addEventListener("click", () => {
      const app = document.getElementById("appSection");
      const admin = document.getElementById("adminSection");
      if (app) app.hidden = false;
      if (admin) admin.hidden = true;
      core.toast("Returned to Catalog", "info");
    });
    btn._bound = true;
  }

  // ---------------- Toggle + bus wiring ----------------
  function bindAdminToggleAndBus() {
    el.incDel?.addEventListener("change", async () => {
      const inc = !!el.incDel.checked;
      setIncludeDeletedPref(inc);
      await loadAdminLists({ include_deleted: inc });
    });

    //after login sync + reload.
    core.bus.on("admin:include_deleted_changed", async ({ include_deleted }) => {
      hydrateIncDelToggle(!!include_deleted);
      await loadAdminLists({ include_deleted });
    });
  }

  async function loadAdminLists(opts = {}) {
    const include_deleted = opts.include_deleted ?? getIncludeDeletedPref();
    await Promise.all([loadSystems(include_deleted), loadShelves(include_deleted), loadUsers()]);
  }

  function init() {
    hydrateIncDelToggle(getIncludeDeletedPref());

    bindSystemForm();
    bindShelfForm();
    bindUserForm(); 
    bindBackButton();
    bindAdminToggleAndBus();
  }

  return { init, loadAdminLists };
})();

document.addEventListener("DOMContentLoaded", () => {
  if (window.Admin?.init === Admin.init) return; 
  Admin.init();
  window.Admin = Admin; 
});
