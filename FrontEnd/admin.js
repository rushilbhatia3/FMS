async function apiJSON(method, url, body) {
  const opts = { method, credentials: "include", headers: {} };
  if (body !== undefined && body !== null) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      if (j && j.detail) msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch {}
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

function $(id) { return document.getElementById(id); }

async function loadSystems() {
  const tbody = $("systemsTable");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td>Loading…</td></tr>`;
  try {
    const systems = await apiJSON("GET", "/api/systems");
    if (!Array.isArray(systems) || systems.length === 0) {
      tbody.innerHTML = `<tr><td>No systems yet.</td></tr>`;
      return;
    }
    tbody.innerHTML = systems.map(s => {
      const delText = s.is_deleted ? "Restore" : "Delete";
      const delTitle = s.is_deleted ? "Restore system" : "Soft delete system";
      return `<tr data-id="${s.id}">
        <td><strong>${s.code}</strong></td>
        <td>${s.notes || ""}</td>
        <td style="white-space:nowrap;">
          <button class="adm-edit" data-kind="system">Edit</button>
          <button class="adm-del" data-kind="system" title="${delTitle}">${delText}</button>
        </td>
      </tr>`;
    }).join("");
  } catch (e) {
    tbody.innerHTML = `<tr><td style="color:#a11;">Failed to load systems: ${String(e.message || e)}</td></tr>`;
  }
}

async function loadShelves() {
  const tbody = $("shelvesTable");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td>Loading…</td></tr>`;
  try {
    // If you want filter by system, add a <select> and pass ?system_id=…
    const shelves = await apiJSON("GET", "/api/shelves");
    if (!Array.isArray(shelves) || shelves.length === 0) {
      tbody.innerHTML = `<tr><td>No shelves yet.</td></tr>`;
      return;
    }
    tbody.innerHTML = shelves.map(sh => {
      const dims = [sh.length_mm, sh.width_mm, sh.height_mm].map(v => v ?? "—").join(" × ");
      const delText = sh.is_deleted ? "Restore" : "Delete";
      const delTitle = sh.is_deleted ? "Restore shelf" : "Soft delete shelf";
      return `<tr data-id="${sh.id}">
        <td><strong>${sh.label}</strong></td>
        <td>${sh.system_code || sh.system_id}</td>
        <td>${dims}</td>
        <td>${sh.ordinal ?? 0}</td>
        <td style="white-space:nowrap;">
          <button class="adm-edit" data-kind="shelf">Edit</button>
          <button class="adm-del" data-kind="shelf" title="${delTitle}">${delText}</button>
        </td>
      </tr>`;
    }).join("");
  } catch (e) {
    tbody.innerHTML = `<tr><td style="color:#a11;">Failed to load shelves: ${String(e.message || e)}</td></tr>`;
  }
}

function bindSystemForm() {
  const form = $("systemForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const id = (data.id || "").trim();
    const payload = {
      code: (data.code || "").trim(),
      notes: (data.notes || "").trim(),
    };
    try {
      if (!payload.code) throw new Error("Code is required.");
      if (id) {
        await apiJSON("PUT", `/api/systems/${id}`, payload);
      } else {
        await apiJSON("POST", "/api/systems", payload);
      }
      form.reset();
      await loadSystems();
    } catch (err) {
      alert(`System save failed: ${String(err.message || err)}`);
    }
  });

  // Row edit/delete/restore actions
  $("systemsTable")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    const id = tr.getAttribute("data-id");
    const kind = btn.dataset.kind;

    if (btn.classList.contains("adm-edit") && kind === "system") {
      // hydrate form with row values
      const cells = tr.querySelectorAll("td");
      form.elements.id.value = id;
      form.elements.code.value = cells[0].innerText.trim();
      form.elements.notes.value = cells[1].innerText.trim();
      form.scrollIntoView({ behavior: "smooth" });
    }
    if (btn.classList.contains("adm-del") && kind === "system") {
      const text = btn.textContent.toLowerCase();
      try {
        if (text.includes("restore")) {
          await apiJSON("POST", `/api/systems/${id}/restore`, {});
        } else {
          // soft-delete; backend should cascade to shelves/items as soft delete
          await apiJSON("DELETE", `/api/systems/${id}`, null);
        }
        await loadSystems();
        await loadShelves(); // keep shelves list in sync
      } catch (err) {
        alert(`System ${text} failed: ${String(err.message || err)}`);
      }
    }
  });
}

function bindShelfForm() {
  const form = $("shelfForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const id = (data.id || "").trim();

    const payload = {
      system_id: Number(data.system_id || 0),
      label: (data.label || "").trim(),
      length_mm: data.length_mm ? Number(data.length_mm) : null,
      width_mm:  data.width_mm  ? Number(data.width_mm)  : null,
      height_mm: data.height_mm ? Number(data.height_mm) : null,
      ordinal:   data.ordinal   ? Number(data.ordinal)   : 0,
    };

    try {
      if (!payload.system_id) throw new Error("System ID is required.");
      if (!payload.label) throw new Error("Shelf label is required.");
      if (id) {
        await apiJSON("PUT", `/api/shelves/${id}`, payload);
      } else {
        await apiJSON("POST", "/api/shelves", payload);
      }
      form.reset();
      await loadShelves();
    } catch (err) {
      alert(`Shelf save failed: ${String(err.message || err)}`);
    }
  });

  $("shelvesTable")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    const id = tr.getAttribute("data-id");
    const kind = btn.dataset.kind;

    if (btn.classList.contains("adm-edit") && kind === "shelf") {
      // Minimal re-fetch to get canonical values
      try {
        const sh = await apiJSON("GET", `/api/shelves/${id}`);
        const f = form.elements;
        f.id.value = sh.id;
        f.system_id.value = sh.system_id;
        f.label.value = sh.label;
        f.length_mm.value = sh.length_mm ?? "";
        f.width_mm.value  = sh.width_mm ?? "";
        f.height_mm.value = sh.height_mm ?? "";
        f.ordinal.value   = sh.ordinal ?? 0;
        form.scrollIntoView({ behavior: "smooth" });
      } catch (err) {
        alert(`Load shelf failed: ${String(err.message || err)}`);
      }
    }
    if (btn.classList.contains("adm-del") && kind === "shelf") {
      const text = btn.textContent.toLowerCase();
      try {
        if (text.includes("restore")) {
          await apiJSON("POST", `/api/shelves/${id}/restore`, {});
        } else {
          await apiJSON("DELETE", `/api/shelves/${id}`, null);
        }
        await loadShelves();
      } catch (err) {
        alert(`Shelf ${text} failed: ${String(err.message || err)}`);
      }
    }
  });
}

// Small “Back to Catalog” affordance (appears only for admins via button in header)
function ensureBackFromAdmin() {
  const section = document.getElementById("adminSection");
  if (!section) return;
  if (section._backBound) return;

  const bar = document.createElement("div");
  bar.style.cssText = "display:flex;justify-content:flex-end;padding:0 1rem 0.5rem;";
  bar.innerHTML = `<button id="backToCatalogBtn" class="btn">Back to Catalog</button>`;
  section.prepend(bar);

  bar.querySelector("#backToCatalogBtn").addEventListener("click", () => {
    const app = document.getElementById("appSection");
    if (app) app.hidden = false;
    section.hidden = true;
  });

  section._backBound = true;
}

async function loadAdminLists() {
  ensureBackFromAdmin();
  await Promise.all([loadSystems(), loadShelves()]);
}

function initAdmin() {
  bindSystemForm();
  bindShelfForm();
}

initAdmin();

// Expose a tiny namespace so app.js can lazy-load lists when entering Admin
window.Admin = { loadAdminLists };