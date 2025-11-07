import { core } from "./core.js"; 

const PAGE_SIZE_DEFAULT = 50;

const App = (() => {
  // UI refs
  const el = {
    loginSection: core.$("#loginSection"),
    appSection: core.$("#appSection"),
    loginForm: core.$("#loginForm"),
    loginEmail: core.$("#loginEmail"),
    loginPassword: core.$("#loginPassword"),
    logoutBtn: core.$("#logoutBtn"),

    q: core.$("#q"),
    status: core.$("#status"),
    system: core.$("#system"),
    shelf: core.$("#shelf"),
    holder: core.$("#holder"),
    include_deleted: core.$("#include_deleted"),
    page_size: core.$("#page_size"),
    refreshBtn: core.$("#refreshBtn"),

    itemsTbody: core.$("#itemsTbody"),
    itemsTable: core.$("#itemsTable"),
    prevPage: core.$("#prevPage"),
    nextPage: core.$("#nextPage"),
    pagerStatus: core.$("#pagerStatus"),

    itemDrawer: core.$("#itemDrawer"),
    itemDetail: core.$("#itemDetail"),
    itemDeleteBtn: core.$("#itemDeleteBtn"),
    itemRestoreBtn: core.$("#itemRestoreBtn"),
    openMovementModal: core.$("#openMovementModal"),
    closeItemDrawer: core.$("#closeItemDrawer"),

    movementModal: core.$("#movementModal"),
    closeMovementModal: core.$("#closeMovementModal"),
    mvReceive: core.$("#mvReceive"),
    mvIssue: core.$("#mvIssue"),
    mvReturn: core.$("#mvReturn"),
    mvAdjust: core.$("#mvAdjust"),
    mvTransfer: core.$("#mvTransfer"),
  };

  let currentPage = 1;
  let currentSort = "last_movement_ts"; 
  let currentDir = "desc";
  let currentItemId = null;

  // ---------- Init ----------
  async function init() {
    bindAuth();
    bindSorting();
    bindPagination();
    bindItemDrawer();
    bindMovementModal();

    try {
      await core.me();
      core.hide(el.loginSection);
      core.show(el.appSection);
      core.applyRoleVisibility();
      applyRoleUIForAdminButton(core.state.currentUser);
      await initFilters();
      await loadItems();
    } catch {
      core.show(el.loginSection);
      core.hide(el.appSection);
    }

    core.bus.on("movement:recorded", async () => {
      await loadItems();
      if (currentItemId) await openItem(currentItemId);
    });
  }

  // ---------- Auth ----------
  function bindAuth() {
    el.loginForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await core.login(el.loginEmail.value.trim(), el.loginPassword.value);
        core.hide(el.loginSection);
        core.show(el.appSection);
        core.applyRoleVisibility();
        applyRoleUIForAdminButton(core.state.currentUser);
        await initFilters();
        await loadItems();
      } catch (err) {
        core.toast(`Login failed: ${err.message}`, "error");
      }
    });
    el.logoutBtn?.addEventListener("click", async () => {
      await core.logout();
      core.show(el.loginSection);
      core.hide(el.appSection);
      core.applyRoleVisibility();                 // hides role-gated bits + logout button
      applyRoleUIForAdminButton(null);            // hides Admin button cleanly
      try { localStorage.removeItem("filters"); } catch {}
    });
  }

  // ---------- Filters & toolbar ----------
  async function initFilters() {
    // Systems
    const systems = await core.api.get("/api/systems", { include_deleted: false });
    el.system.innerHTML = `<option value="">All systems</option>` + systems.map(s => `<option value="${s.code}">${s.code}</option>`).join("");
    // Shelves (dependent on system selection)
    el.system.addEventListener("change", async () => {
      await populateShelves();
      currentPage = 1;
      await loadItems();
    });

    const saved = core.persist.get("filters", {});
    el.q.value = saved.q ?? "";
    el.status.value = saved.status ?? "";
    el.holder.value = saved.holder ?? "";
    el.include_deleted.checked = !!saved.include_deleted;
    el.page_size.value = String(saved.page_size ?? PAGE_SIZE_DEFAULT);
    el.system.value = saved.system ?? ""; // <-- set system before shelves

    await populateShelves();               // shelves depend on system
    el.shelf.value = saved.shelf ?? "";    // <-- set shelf after shelves are loaded


    el.q.addEventListener("input", core.debounce(async () => { currentPage = 1; persistFilters(); await loadItems(); }, 300));
    [el.status, el.shelf, el.holder, el.include_deleted, el.page_size].forEach(c =>
      c?.addEventListener("change", async () => { currentPage = 1; persistFilters(); await loadItems(); })
    );
    el.refreshBtn?.addEventListener("click", async () => { await loadItems(); });
  }

  async function populateShelves() {
    const system_code = el.system.value || "";
    el.shelf.innerHTML = `<option value="">All shelves</option>`;
    if (!system_code) return;
    const systems = await core.api.get("/api/systems", { include_deleted: false });
    const sys = systems.find(s => s.code === system_code);
    if (!sys) return;
    const shelves = await core.api.get("/api/shelves", { system_id: sys.id, include_deleted: false });
    el.shelf.innerHTML = `<option value="">All shelves</option>` + shelves.map(sh =>
      `<option value="${sh.label}">${sh.label}</option>`).join("");
  }

  function persistFilters() {
    core.persist.set("filters", {
      q: el.q.value.trim(),
      status: el.status.value,
      system: el.system.value,
      shelf: el.shelf.value,
      holder: el.holder.value.trim(),
      include_deleted: el.include_deleted.checked,
      page_size: Number(el.page_size.value) || PAGE_SIZE_DEFAULT,
    });
  }

  function showMovementTab(kind) {
  const forms = el.movementModal.querySelectorAll("form[data-kind]");
  forms.forEach(f => f.hidden = f.getAttribute("data-kind") !== kind);
}

function prefillMovementForms(item) {
  const setIf = (form, name, val) => {
    if (!form) return;
    const input = form.querySelector(`[name="${name}"]`);
    if (input) input.value = val ?? "";
  };

  const id = item.id;
  const shelfId = item.shelf_id ?? ""; // may be empty

  // Receive / Issue / Return / Adjust / Transfer
  setIf(el.mvReceive,  "item_id", id);
  setIf(el.mvReceive,  "shelf_id", shelfId);

  setIf(el.mvIssue,    "item_id", id);
  setIf(el.mvIssue,    "shelf_id", shelfId);

  setIf(el.mvReturn,   "item_id", id);
  setIf(el.mvReturn,   "shelf_id", shelfId);

  setIf(el.mvAdjust,   "item_id", id);
  setIf(el.mvAdjust,   "shelf_id", shelfId);

  setIf(el.mvTransfer, "item_id", id);
  setIf(el.mvTransfer, "from_shelf_id", shelfId);
  // to_shelf_id stays blank on purpose
}

  // ---------- Sorting ----------
  function bindSorting() {
    core.$all("#itemsTable thead th[data-sort]").forEach(th => {
      th.addEventListener("click", async () => {
        const key = th.getAttribute("data-sort");
        if (currentSort === key) {
          currentDir = currentDir === "asc" ? "desc" : "asc";
        } else {
          currentSort = key;
          currentDir = key === "name" ? "asc" : "desc";
        }
        currentPage = 1;
        await loadItems();
        core.$all("#itemsTable thead th[data-sort]").forEach(th2 => th2.classList.remove("sort-asc","sort-desc","sort-active"));
        th.classList.add("sort-active", currentDir === "asc" ? "sort-asc" : "sort-desc");
      });
    });
  }

  // ---------- Pagination ----------
  function bindPagination() {
    el.prevPage?.addEventListener("click", async () => {
      if (currentPage > 1) { currentPage--; await loadItems(); }
    });
    el.nextPage?.addEventListener("click", async () => {
      currentPage++; await loadItems();
    });
  }

  // ---------- Load items ----------
async function loadItems() {
  const params = {
    q: el.q.value.trim(),
    status: el.status.value,
    include_deleted: el.include_deleted.checked ? "true" : "false",
    system_code: el.system.value || "",
    shelf_label: el.shelf.value || "",
    holder: el.holder?.value?.trim?.() || "",        // guard if holder input doesn't exist
    sort: currentSort || "created_at",
    dir: currentDir || "desc",
    page: String(currentPage),
    page_size: String(Number(el.page_size.value) || PAGE_SIZE_DEFAULT),
  };

  try {
    const data = await core.api.get("/api/items", params);

    const items = Array.isArray(data.items) ? data.items
                 : Array.isArray(data.rows) ? data.rows
                 : [];

    renderItems(items);

    const total = Number(data.total ?? data.total_rows ?? 0);
    const size  = Number(params.page_size);
    const maxPage = Math.max(1, Math.ceil(total / size));
    currentPage = Math.min(currentPage, maxPage);
    el.pagerStatus.textContent = `Page ${currentPage} of ${maxPage} • ${total} total`;
    el.prevPage.disabled = currentPage <= 1;
    el.nextPage.disabled = currentPage >= maxPage;
  } catch (err) {
    console.error(err);
    core.toast(`Failed to load items: ${err.message}`, "error");
  }
}

function renderItems(items) {
  if (!el.itemsTbody) {
    console.warn("itemsTbody not found in DOM");
    return;
  }
  if (!Array.isArray(items)) items = [];

  el.itemsTbody.innerHTML = items.map(row => {
    const when = row.last_movement_ts
      ? (dayjs(row.last_movement_ts).fromNow?.() || row.last_movement_ts)
      : "—";
    const sys  = row.system_code ?? "—";
    const shelf= row.shelf_label ?? "—";
    const qty  = (row.quantity ?? row.qty ?? 0);
    const del  = Number(row.is_deleted ?? 0) === 1;

    return `<tr data-id="${row.id}">
      <td class="clickable">${row.name}</td>
      <td>${row.sku}</td>
      <td>${sys}</td>
      <td>${shelf}</td>
      <td>${qty}</td>
      <td>${when}</td>
      <td>${row.clearance_level}</td>
      <td>
        <button class="viewBtn" data-id="${row.id}">View</button>
        <button class="editBtn" data-id="${row.id}" data-requires-role="admin">Edit</button>
        ${del
          ? `<button class="restoreBtn" data-id="${row.id}" data-requires-role="admin">Restore</button>`
          : `<button class="deleteBtn" data-id="${row.id}" data-requires-role="admin">Delete</button>`}
      </td>
    </tr>`;
  }).join("");




    core.applyRoleVisibility();

    // Row events
    el.itemsTbody.querySelectorAll(".clickable, .viewBtn").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        const tr = e.target.closest("tr");
        const id = Number(tr?.dataset.id || btn.dataset.id);
        if (id) await openItem(id);
      });
    });
    el.itemsTbody.querySelectorAll(".deleteBtn").forEach(btn => btn.addEventListener("click", () => softDeleteItem(Number(btn.dataset.id))));
    el.itemsTbody.querySelectorAll(".restoreBtn").forEach(btn => btn.addEventListener("click", () => restoreItem(Number(btn.dataset.id))));
    el.itemsTbody.querySelectorAll(".editBtn").forEach(btn => btn.addEventListener("click", async () => openItem(Number(btn.dataset.id))));
  }

  // ---------- Item detail ----------
  async function openItem(id) {
    currentItemId = id;
    try {
      const item = await core.api.get(`/api/items/${id}`);
      const latest = await core.api.get(`/api/items/${id}/movements`);
      renderItemDetail(item, latest);
      renderItemDetail(item, latest);
      prefillMovementForms(item);
      showMovementTab("receive"); // default visible tab
      el.itemDrawer.showModal();
    } catch (err) {
      core.toast(`Failed to load item: ${err.message}`, "error");
    }
  }

  function renderItemDetail(item, latest) {
    el.itemDetail.innerHTML = `
      <h3>${item.name} <small>(${item.sku})</small></h3>
      <div>System/Shelf: ${item.system_code ?? "—"} / ${item.shelf_label ?? "—"}</div>
      <div>Qty: ${item.quantity} • CL: ${item.clearance_level}</div>
      <div>Status: ${item.is_out ? "Checked out" : "Available"}</div>
      <div>Last issue: ${item.last_issue_ts ?? "—"}</div>
      <div>Last return: ${item.last_return_ts ?? "—"}</div>
      <hr />
      <h4>Latest movements</h4>
      <ul>
        ${latest.map(m => `<li>[${m.timestamp}] ${m.kind} ${m.quantity} @ shelf#${m.shelf_id} ${m.holder ? `• holder ${m.holder}` : ""}</li>`).join("")}
      </ul>
    `;
  }

  el.closeItemDrawer?.addEventListener("click", () => el.itemDrawer.close());
  el.openMovementModal?.addEventListener("click", () => el.movementModal.showModal());

  async function softDeleteItem(id) {
    try {
      await core.api.del(`/api/items/${id}`);
      core.toast("Item deleted", "success");
      await loadItems();
    } catch (e) {
      core.toast(e.message, "error");
    }
  }
  async function restoreItem(id) {
    try {
      await core.api.post(`/api/items/${id}/restore`, {});
      core.toast("Item restored", "success");
      await loadItems();
    } catch (e) {
      core.toast(e.message, "error");
    }
  }

  // ---------- Movements ----------
  function bindMovementModal() {
    el.closeMovementModal?.addEventListener("click", () => el.movementModal.close());

    // Tab buttons just show the matching form (you can style this as needed)
    el.movementModal?.querySelectorAll("nav [data-kind]").forEach(btn => {
      btn.addEventListener("click", () => {
        const kind = btn.getAttribute("data-kind");
        el.movementModal.querySelectorAll("form[data-kind]").forEach(f => f.hidden = f.getAttribute("data-kind") !== kind);
      });
    });

    // Attach submit handlers (forms expected to have fields matching the API)
    el.mvReceive?.addEventListener("submit", (e) => submitMovement(e, "/api/movements/receive"));
    el.mvIssue?.addEventListener("submit",   (e) => submitMovement(e, "/api/movements/issue"));
    el.mvReturn?.addEventListener("submit",  (e) => submitMovement(e, "/api/movements/return"));
    el.mvAdjust?.addEventListener("submit",  (e) => submitMovement(e, "/api/movements/adjust"));
    el.mvTransfer?.addEventListener("submit",(e) => submitMovement(e, "/api/movements/transfer"));
  }

  async function submitMovement(e, endpoint) {
    e.preventDefault();
    try {
      const data = core.serializeForm(e.target);
      // Ensure numeric fields
      ["item_id","shelf_id","qty","qty_delta","from_shelf_id","to_shelf_id"].forEach(k => {
        if (data[k] !== undefined && data[k] !== "") data[k] = Number(data[k]);
      });
      await core.api.post(endpoint, data);
      core.toast("Movement recorded", "success");
      core.bus.emit("movement:recorded", {});
      el.movementModal.close();
    } catch (err) {
      core.toast(err.message, "error");
    }
  }

  // ---------- Item drawer buttons may be role-gated ----------
  function bindItemDrawer() {
    core.applyRoleVisibility();
  }

  // --- helpers (reuse your existing fetch wrapper if you have one) ---
async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // try to parse FastAPI error {detail: "..."} or validation errors
    let msg = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      if (data && data.detail) msg = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

async function postMultipart(url, formData) {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      if (data && data.detail) msg = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

// Collect current filters to mirror /api/items
function getFilters() {
  const $ = (id) => document.getElementById(id);
  const pick = (el) => (el ? el.value : "");

  const includeDeleted = $("include_deleted")?.checked ? "true" : "false";
  const pageSize = $("page_size") ? $("page_size").value : "50";

  // prefer existing globals if you already track them
  const sort = (window.currentSort || "last_movement_ts");
  const dir  = (window.currentDir  || "desc");

  return {
    q: pick($("q")),
    status: pick($("status")),
    system: pick($("system")),
    shelf: pick($("shelf")),
    holder: pick($("holder")),
    include_deleted: includeDeleted,
    min_qty: "",    // wire if you add inputs
    max_qty: "",
    sort, dir,
    page: String(window.currentPage || 1),
    page_size: pageSize,
  };
}

function toQuery(params) {
  const usp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== "" && v !== null && v !== undefined) usp.set(k, v);
  });
  return usp.toString();
}



// --- Add Item dialog wiring ---
function bindAddItem() {
  const addBtn   = document.getElementById("addItemBtn");
  const dlg      = document.getElementById("addItemDialog");
  const form     = document.getElementById("addItemForm");
  const btnCancel= document.getElementById("addItemCancel");
  const btnSubmit= document.getElementById("addItemSubmit");
  const errEl    = document.getElementById("addItemError");

  if (!addBtn || !dlg || !form) return;

  // ---------- Open dialog ----------
  addBtn.addEventListener("click", () => {
    const f = getFilters();
    const sysInput   = document.getElementById("ai_system");
    const shelfInput = document.getElementById("ai_shelf");

    form.reset();
    errEl.textContent = "";

    if (sysInput && f.system) sysInput.value = f.system;
    if (shelfInput && f.shelf) shelfInput.value = f.shelf;

    dlg.showModal();
    setTimeout(() => document.getElementById("ai_name")?.focus(), 10);
  });

  // ---------- Cancel ----------
  btnCancel?.addEventListener("click", () => dlg.close());

  // ---------- Submit ----------
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.textContent = "";
    btnSubmit.disabled = true;

    const payload = {
      sku: (document.getElementById("ai_sku")?.value || "").trim() || undefined,
      name: (document.getElementById("ai_name")?.value || "").trim(),
      unit: (document.getElementById("ai_unit")?.value || "units").trim(),
      clearance_level: Number(document.getElementById("ai_cl")?.value || 0),
      system_code: (document.getElementById("ai_system")?.value || "").trim(),
      shelf_label: (document.getElementById("ai_shelf")?.value || "").trim(),
      quantity: Number(document.getElementById("ai_qty")?.value || 0),
      tag: (document.getElementById("ai_tag")?.value || "").trim() || undefined,
      note: (document.getElementById("ai_note")?.value || "").trim() || undefined,
    };

    // --- validation ---
    if (!payload.name || !payload.system_code || !payload.shelf_label) {
      errEl.textContent = "Name, System Code, and Shelf Label are required.";
      btnSubmit.disabled = false;
      return;
    }
    if (payload.clearance_level < 1 || payload.clearance_level > 4) {
      errEl.textContent = "Clearance level must be between 1 and 4.";
      btnSubmit.disabled = false;
      return;
    }
    if (payload.quantity < 0) {
      errEl.textContent = "Quantity must be zero or greater.";
      btnSubmit.disabled = false;
      return;
    }

    // --- submit ---
    try {
      const created = await core.api.post("/api/items", payload);

      core.toast("Item added", "success");

      // make sure newest shows first
      currentSort = "last_movement_ts";
      currentDir  = "desc";

      // reset pagination and reload list
      currentPage = 1;
      await loadItems();

      // close dialog
      dlg.close();
      form.reset();
    } catch (err) {
      errEl.textContent = String(err.message || err);
    } finally {
      btnSubmit.disabled = false;
    }
  });
}


// --- Import CSV wiring ---
function bindImport() {
  const importBtn = document.getElementById("importBtn");
  const importFile = document.getElementById("importFile");
  const statusEl = document.getElementById("importStatus");

  if (!importBtn || !importFile) return;

  importBtn.addEventListener("click", () => importFile.click());

  importFile.addEventListener("change", async () => {
    const file = importFile.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);

    importBtn.disabled = true;
    if (statusEl) statusEl.textContent = `Importing "${file.name}"...`;

    try {
      // Endpoint expected: POST /api/items/import
      const res = await postMultipart("/api/items/import", fd);
      // Expecting {inserted, updated, skipped, errors: []}
      const { inserted=0, updated=0, skipped=0, errors=[] } = res || {};
      const errPrefix = errors && errors.length ? `, errors: ${errors.length}` : "";
      if (statusEl) statusEl.textContent = `Import complete. Inserted ${inserted}, updated ${updated}, skipped ${skipped}${errPrefix}.`;
      if (typeof window.loadItems === "function") await window.loadItems();
    } catch (err) {
      if (statusEl) statusEl.textContent = `Import failed: ${String(err.message || err)}`;
    } finally {
      importBtn.disabled = false;
      importFile.value = ""; // reset for future uploads
    }
  });
}

// --- Export CSV wiring ---
function bindExport() {
  const exportBtn = document.getElementById("exportBtn");
  if (!exportBtn) return;

  exportBtn.addEventListener("click", () => {
    const qs = toQuery(getFilters());
    // Endpoint expected: GET /api/items/export
    const url = `/api/items/export?${qs}`;
    // start download (new tab avoids navigation if you prefer)
    window.open(url, "_self");
  });
}

// --- Bundle all bindings ---
function bindInventoryActions() {
  bindAddItem();
  bindImport();
  bindExport();
}

function showSection(idToShow) {
  const app = document.getElementById("appSection");
  const admin = document.getElementById("adminSection");
  if (app) app.hidden = idToShow !== "app";
  if (admin) admin.hidden = idToShow !== "admin";
}


function applyRoleUIForAdminButton(currentUser) {
  const adminBtn = document.getElementById("adminBtn");
  if (!adminBtn) return;

  const isAdmin = !!currentUser && String(currentUser.role || "").toLowerCase() === "admin";
  adminBtn.hidden = !isAdmin;

  if (isAdmin && !adminBtn._bound) {
    adminBtn.addEventListener("click", () => {
      showSection("admin");
      // lazy-load lists the first time you open Admin
      if (window.Admin && typeof window.Admin.loadAdminLists === "function") {
        window.Admin.loadAdminLists();
      }
    });
    adminBtn._bound = true;
  }
}



// Call once on startup (after your existing init)
bindInventoryActions();



  return { init };
})();

document.addEventListener("DOMContentLoaded", App.init);
