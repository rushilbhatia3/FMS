// app.js
import { core } from "./core.js";

const PAGE_SIZE_DEFAULT = 50;

(function applySavedTheme() {
  const root = document.documentElement;
  const saved = localStorage.getItem("wms_theme") || "desert-apple";
  root.classList.remove("theme-desert-apple", "theme-arctic-water");
  root.classList.add(`theme-${saved}`);
})();


/* ---- Gated session ---- */
document.addEventListener("DOMContentLoaded", async () => {
  try {
    const res = await fetch("/api/session/me", { credentials: "include" });
    if (!res.ok) throw new Error("no session");
    document.body.classList.remove("unauth");
  } catch {
    document.body.classList.add("unauth");
  }
});

const App = (() => {
  // ---------- UI refs ----------
  const el = {
    // auth + chrome
    loginSection: core.$("#loginSection"),
    appSection: core.$("#appSection"),
    loginForm: core.$("#loginForm"),
    loginEmail: core.$("#loginEmail"),
    loginPassword: core.$("#loginPassword"),
    logoutBtn: core.$("#logoutBtn"),
    settingsBtn: core.$("#settingsBtn"),

    themeSelect: document.getElementById("themeSelect"),
    dashboardBtn: core.$("#dashboardBtn"),

    // filters
    q: core.$("#q"),
    status: core.$("#status"),
    location: core.$("#location"),
    page_size: core.$("#page_size"),
    include_deleted_header: document.querySelector("#include_deleted_header"),
    include_deleted_admin: document.querySelector("#include_deleted_admin"),

    // table + pager
    itemsTbody: core.$("#itemsTbody"),
    itemsTable: core.$("#itemsTable"),
    prevPage: core.$("#prevPage"),
    nextPage: core.$("#nextPage"),
    pagerStatus: core.$("#pagerStatus"),

    // item drawer
    itemDrawer: core.$("#itemDrawer"),
    itemDetail: core.$("#itemDetail"),
    itemDeleteBtn: core.$("#itemDeleteBtn"),
    itemRestoreBtn: core.$("#itemRestoreBtn"),
    openMovementModal: core.$("#openMovementModal"),
    closeItemDrawer: core.$("#closeItemDrawer"),

    // movement modal
    movementModal: core.$("#movementModal"),
    closeMovementModal: core.$("#closeMovementModal"),
    mvItemName: core.$("#mv_item_name"),
    mvLocationLabel: core.$("#mv_location_label"),
    mvItemIdDisplay: core.$("#mv_item_id_display"),
    mvReceive: core.$("#mvReceive"),
    mvIssue: core.$("#mvIssue"),
    mvReturn: core.$("#mvReturn"),
    mvAdjust: core.$("#mvAdjust"),
    mvTransfer: core.$("#mvTransfer"),
    mvToLocation: core.$("#mv_to_location"),

  };

  let currentPage = 1;
  let currentSort = "last_movement_ts";
  let currentDir = "desc";
  let currentItemId = null;
  let currentItem = null;

  async function softDeleteItem(id) {
    await core.api.del(`/api/items/${id}`);
    core.toast("Item deleted", "info");
  }

  async function restoreItem(id) {
    await core.api.post(`/api/items/${id}/restore`, {});
    core.toast("Item restored", "success");
  }

  /* ---------- Helpers ---------- */
  function getHeaderDeletedState() {
    return !!el.include_deleted_header?.checked;
  }
  function setHeaderDeletedState(checked, { silent = false } = {}) {
    if (el.include_deleted_header) {
      el.include_deleted_header.checked = !!checked;
      el.include_deleted_header.setAttribute("aria-checked", checked ? "true" : "false");
    }
    if (!silent) {
      currentPage = 1;
      persistFilters();
      loadItems();
    }
  }

  function formatWhen(ts) {
    if (!ts) return "—";

    try {
      const parsed = ts.replace(" ", "T") + "Z"; 
      const d = new Date(parsed);    

      if (isNaN(d.getTime())) return ts;

      //format local time 
      const abs = d.toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit"
      });

      const diffMs = Date.now() - d.getTime();
      const diffMin = Math.floor(diffMs / 60000);

      let rel = "";
      if (diffMin < 1) rel = "just now";
      else if (diffMin < 60) rel = `${diffMin} min ago`;
      else {
        const hrs = Math.floor(diffMin / 60);
        if (hrs < 24) rel = `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
        else {
          const days = Math.floor(hrs / 24);
          rel = `${days} day${days === 1 ? "" : "s"} ago`;
        }
      }
      return `${rel} • ${abs}`;
    } catch {
      return ts;
    }
  }


  function getAdminPrefs() {
    return core.persist.get("admin_prefs", { include_deleted: false });
  }
  function setAdminDeletedState(checked, { silent = false } = {}) {
  const include_deleted = !!checked;
  if (el.include_deleted_admin) {
    el.include_deleted_admin.checked = include_deleted;
    el.include_deleted_admin.setAttribute("aria-checked", include_deleted ? "true" : "false");
  }
  core.persist.set("admin_prefs", { ...getAdminPrefs(), include_deleted });
  core.bus.emit("admin:include_deleted_changed", { include_deleted });
  window.ADMIN_INCLUDE_DELETED = include_deleted;

  if (!silent && window.Admin && typeof window.Admin.loadAdminLists === "function") {
    window.Admin.loadAdminLists({ include_deleted });
  }
}

  function parseQueryTokens(q) {
    const holderMatch = q.match(/\bholder:([^\s]+)\b/i);
    const holder = holderMatch ? holderMatch[1] : "";
    const cleanQ = q.replace(/\bholder:[^\s]+\b/gi, "").trim();
    return { cleanQ, holder };
  }

  function persistFilters() {
    const { system_code, shelf_label } = getLocationFilter();
    const { cleanQ } = parseQueryTokens(el.q.value.trim());
    core.persist.set("filters", {
      q: cleanQ,
      status: el.status.value,
      system: system_code,
      shelf: shelf_label,
      include_deleted_catalogue: getHeaderDeletedState(),
      page_size: Number(el.page_size.value) || PAGE_SIZE_DEFAULT,
    });
  }

  /* -------------------- Init -------------------- */
  async function init() {
      bindTheme();

      bindAuth();
      bindChrome();
      bindSorting();
      bindPagination();
      bindItemDrawer();
      bindMovementModal();

      try {
        await core.me();
        document.body.classList.remove("unauth");
        core.hide(el.loginSection);
        core.show(el.appSection);
        core.applyRoleVisibility();
        applyRoleUIForAdminButton(core.state.currentUser);

        await initFilters();
        bindInventoryActions();
        await loadItems();
      } catch {
        document.body.classList.add("unauth");
        core.show(el.loginSection);
        core.hide(el.appSection);
      }

      core.bus.on("movement:recorded", async () => {
        await loadItems();
        if (currentItemId) await openItem(currentItemId);
      });
    }
  /* -------------------- Auth -------------------- */
  function bindAuth() {
    el.loginForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await core.login(el.loginEmail.value.trim(), el.loginPassword.value);
        document.body.classList.remove("unauth");
        core.hide(el.loginSection);
        core.show(el.appSection);
        core.applyRoleVisibility();
        applyRoleUIForAdminButton(core.state.currentUser);
        await initFilters();
        bindInventoryActions();
        await loadItems();
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
      applyRoleUIForAdminButton(null);
      try {
        localStorage.removeItem("filters");
      } catch {}
    });
  }

  /* -------------------- Chrome -------------------- */
  function bindChrome() {
    if (el.settingsBtn && !el.settingsBtn._bound) {
      el.settingsBtn.addEventListener("click", () => {
        window.location.href = "settings.html";
      });
      el.settingsBtn._bound = true;
    }

    if (el.dashboardBtn && !el.dashboardBtn._bound) {
      el.dashboardBtn.addEventListener("click", () => {
        window.location.href = "dashboard.html";
      });
      el.dashboardBtn._bound = true;
    }
  }

  /* ---------- Theme helpers ---------- */

  const THEME_KEY = "wms_theme";
  const DEFAULT_THEME = "desert";

  function getStoredTheme() {
    try {
      const t = localStorage.getItem(THEME_KEY);
      return t || DEFAULT_THEME;
    } catch {
      return DEFAULT_THEME;
    }
  }

  function storeTheme(theme) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ignore
    }
  }

  function applyTheme(theme) {
    const body = document.body;
    const root = document.documentElement;

    // Clear previous theme classes
    body.classList.remove("theme-hawaii", "theme-stonehenge-moss");

    if (theme === "hawaii") {
      body.classList.add("theme-hawaii");
      root.style.setProperty("--theme-name", '"hawaii"');
    } else if (theme === "stonehenge-moss") {
      body.classList.add("theme-stonehenge-moss");
      root.style.setProperty("--theme-name", '"stonehenge-moss"');
    } else {
      // default desert
      root.style.setProperty("--theme-name", '"desert"');
      theme = "desert";
    }


    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch (_) {
      // ignore storage errors
    }
  }

  function bindTheme() {
    const initial = getStoredTheme();
    applyTheme(initial);

    if (!el.themeSelect || el.themeSelect._bound) return;

    el.themeSelect.addEventListener("change", () => {
      const val = el.themeSelect.value || DEFAULT_THEME;
      applyTheme(val);
    });

    el.themeSelect._bound = true;
  }

  /* -------------------- Filters & toolbar -------------------- */

  function getLocationFilter() {
    const sel = el.location;
    if (!sel) return { system_code: "", shelf_label: "" };

    const opt = sel.options[sel.selectedIndex];
    if (!opt) return { system_code: "", shelf_label: "" };

    const system_code = opt.dataset.system || "";
    const shelf_label = opt.dataset.shelf || "";
    return { system_code, shelf_label };
  }

  function setLocationFromFilter(system_code, shelf_label) {
    const sel = el.location;
    if (!sel) return;
    const opts = Array.from(sel.options);
    const match = opts.find((o) => 
      (o.dataset.system || "") === (system_code || "") &&
      (o.dataset.shelf  || "") === (shelf_label  || "")
    );
    if (match) {
      sel.value = match.value;
    } else {
      sel.value = "";
    }
  }
  async function buildLocationOptions(saved = {}) {
    if (!el.location) return;

    let systems = [];
    try {
      systems = await core.api.get("/api/systems", { include_deleted: false });
    } catch {
      systems = [];
    }
    systems = Array.isArray(systems) ? systems : [];

    let html = `<option value="">All locations</option>`;

    for (const sys of systems) {
      let shelves = [];
      try {
        shelves = await core.api.get("/api/shelves", {
          system_id: sys.id,
          include_deleted: false,
        });
      } catch {
        shelves = [];
      }
      shelves = Array.isArray(shelves) ? shelves : [];

      html += `<optgroup label="System ${sys.code}">`;

      // system-wide option
      html += `<option value="sys:${sys.code}"
                    data-system="${sys.code}"
                    data-shelf="">
                ${sys.code} — All shelves
              </option>`;

      // shelf-level options (non-deleted only)
      for (const sh of shelves) {
        const label = sh.label ?? "";
        const isDel = Number(sh.is_deleted ?? 0) === 1;
        if (isDel) continue;

        html += `<option
          value="sys:${sys.code}|sh:${label}"
          data-system="${sys.code}"
          data-shelf="${label}"
          data-shelf-id="${sh.id}"
          data-deleted="0"
        >
          ${sys.code} / ${label}
        </option>`;
      }

      html += `</optgroup>`;
    }

    el.location.innerHTML = html;

    //restore saved filters if present
    const system_code = saved.system ?? "";
    const shelf_label = saved.shelf ?? "";
    setLocationFromFilter(system_code, shelf_label);
  }



  async function initFilters() {
    //restore saved filters
    const saved = core.persist.get("filters", {});
    const adminSaved = getAdminPrefs();

    el.q.value = saved.q ?? "";
    el.status.value = saved.status ?? "";
    el.page_size.value = String(saved.page_size ?? PAGE_SIZE_DEFAULT);

    setHeaderDeletedState(!!saved.include_deleted_catalogue, { silent: true });
    setAdminDeletedState(!!adminSaved.include_deleted, { silent: true });

    //location options and restore selected system/shelf
    await buildLocationOptions(saved);
    function syncDeletedToggleLock() {
      const isDeletedView = el.status.value === "deleted";
      const wrapHeader = document.getElementById("showDeletedWrap");
      if (isDeletedView) {
        setHeaderDeletedState(true, { silent: true });
        if (el.include_deleted_header) el.include_deleted_header.disabled = true;
        wrapHeader?.classList.add("is-locked");
      } else {
        if (el.include_deleted_header) el.include_deleted_header.disabled = false;
        wrapHeader?.classList.remove("is-locked");
      }
    }

    el.status.addEventListener("change", async () => {
      syncDeletedToggleLock();

      const isDeletedView = el.status.value === "deleted";
      if (isDeletedView) {
        currentPage = 1;
        currentSort = "last_movement_ts"; 
        currentDir = "desc";
      } else {
        currentPage = 1;
      }

      persistFilters();
      await loadItems();
    });

    el.include_deleted_header?.addEventListener("change", () => {
      setHeaderDeletedState(el.include_deleted_header.checked);
    });

    el.include_deleted_admin?.addEventListener("change", () => {
      setAdminDeletedState(el.include_deleted_admin.checked);
    });

    //search
    el.q.addEventListener(
      "input",
      core.debounce(async () => {
        currentPage = 1;
        persistFilters();
        await loadItems();
      }, 300)
    );

    //location + page size
    [el.location, el.page_size].forEach((c) =>
      c?.addEventListener("change", async () => {
        currentPage = 1;
        persistFilters();
        await loadItems();
      })
    );

    //expanding search
    const sw = document.getElementById("searchWrapper");
    const si = el.q;
    if (sw && si) {
      sw.addEventListener("click", () => si.focus());
      si.addEventListener("focus", () => sw.classList.add("focused"));
      si.addEventListener("blur", () => sw.classList.remove("focused"));
    }

    syncDeletedToggleLock();
  }


  /* -------------------- Sorting -------------------- */
  function bindSorting() {
    core.$all("#itemsTable thead th[data-sort]").forEach((th) => {
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
        core.$all("#itemsTable thead th[data-sort]").forEach((th2) =>
          th2.classList.remove("sort-asc", "sort-desc", "sort-active")
        );
        th.classList.add("sort-active", currentDir === "asc" ? "sort-asc" : "sort-desc");
      });
    });
  }

  /* -------------------- Pagination -------------------- */
  function bindPagination() {
    el.prevPage?.addEventListener("click", async () => {
      if (currentPage > 1) {
        currentPage--;
        await loadItems();
      }
    });
    el.nextPage?.addEventListener("click", async () => {
      currentPage++;
      await loadItems();
    });
  }

  /* -------------------- Load & render items -------------------- */
  function clearanceBadge(level, userMaxCL) {
    const n = Number(level) || 0;
    const cl = Math.min(Math.max(n, 1), 4);
    const denied = userMaxCL && cl > userMaxCL;
    const title = denied ? `Requires CL ${cl} • you have CL ${userMaxCL}` : `Clearance Level ${cl}`;
    return `<span class="badge badge-clearance-${cl}${denied ? " badge-denied" : ""}" title="${title}" aria-label="${title}">${cl}</span>`;
  }

  async function loadItems() {
    const statusVal = el.status.value;
    const isDeletedView = statusVal === "deleted";


    const include_deleted = isDeletedView
      ? "true"
      : getHeaderDeletedState()
      ? "true"
      : "false";

    const { system_code, shelf_label } = getLocationFilter();

    const params = {
      q: el.q.value.trim(),
      status: statusVal, //send deleted through to the backend
      include_deleted,
      system_code,
      shelf_label,
      sort: currentSort || "created_at",
      dir: currentDir || "desc",
      page: String(currentPage),
      page_size: String(Number(el.page_size.value) || PAGE_SIZE_DEFAULT),
    };

    try {
      const data = await core.api.get("/api/items", params);
      const rows = Array.isArray(data.items)
        ? data.items
        : Array.isArray(data.rows)
        ? data.rows
        : [];

      const items = rows;

      renderItems(items);

      const total = Number(data.total ?? data.total_rows ?? items.length);
      const size = Number(params.page_size);
      const maxPage = Math.max(1, Math.ceil(total / size));
      currentPage = Math.min(currentPage, maxPage);

      const suffix = isDeletedView ? "deleted" : "total";
      el.pagerStatus.textContent = `Page ${currentPage} of ${maxPage} • ${total} ${suffix}`;
      el.prevPage.disabled = currentPage <= 1;
      el.nextPage.disabled = currentPage >= maxPage;
    } catch (err) {
      console.error(err);
      core.toast(`Failed to load items: ${err.message}`, "error");
    }
  }

  function renderItems(items) {
    if (!el.itemsTbody) return;
    if (!Array.isArray(items)) items = [];

    const svgEdit = `
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm14.71-10.46c.39-.39.39-1.02 0-1.41L16.62 3.3a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.88-1.88z"/>
      </svg>`;
    const svgDelete = `
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M6 7h12l-1 13H7L6 7zm3-3h6l1 2H8l1-2z"/>
      </svg>`;
    const svgRestore = `
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M12 5V1L7 6l5 5V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/>
      </svg>`;

    el.itemsTbody.innerHTML = items
      .map((row) => {
        const when = formatWhen(row.last_movement_ts);
        const sys = row.system_code ?? "—";
        const shelf = row.shelf_label ?? "—";
        const qty = row.quantity ?? row.qty ?? 0;
        const holder = row.current_holder || (row.is_out ? "Checked out" : "—");
        const isDel = Number(row.is_deleted ?? 0) === 1;
        const editBtn = `
        <button class="icon-btn btn-edit" title="Edit" aria-label="Edit"
                data-id="${row.id}" data-requires-role="admin">
          ${svgEdit}
        </button>`;

        const delOrRestoreBtn = isDel
          ? `<button class="icon-btn btn-restore" title="Restore" aria-label="Restore"
                   data-id="${row.id}" data-requires-role="admin">
             ${svgRestore}
           </button>`
          : `<button class="icon-btn btn-delete" title="Delete" aria-label="Delete"
                   data-id="${row.id}" data-requires-role="admin">
             ${svgDelete}
           </button>`;

        return `
          <tr data-id="${row.id}" class="${isDel ? "row-deleted" : ""}">
            <td>${row.sku ?? "—"}</td>
            <td class="clickable">${row.name}</td>
            <td>${sys}</td>
            <td>${shelf}</td>
            <td>${qty}</td>
            <td>${holder}</td>
            <td>${when}</td>
            <td>${clearanceBadge(row.clearance_level, core?.state?.currentUser?.max_clearance_level)}</td>
            <td class="cell-actions">
              ${editBtn}
              ${delOrRestoreBtn}
            </td>
          </tr>`;
      })
      .join("");

    core.applyRoleVisibility();

    el.itemsTbody.querySelectorAll("tr").forEach((tr) => {
      tr.addEventListener("click", async (e) => {
        if (e.target.closest(".btn-edit, .btn-delete, .btn-restore")) return;

        const id = Number(tr.dataset.id);
        if (id) await openItem(id);
      });
    });

    //delete (soft)
    el.itemsTbody.querySelectorAll(".btn-delete").forEach((btn) =>
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const id = Number(btn.dataset.id);
        if (!id) return;
        try {
          await softDeleteItem(id);
          await loadItems();
        } catch (err) {
          core.toast(String(err.message || err), "error");
        }
      })
    );

    // restore
    el.itemsTbody.querySelectorAll(".btn-restore").forEach((btn) =>
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const id = Number(btn.dataset.id);
        if (!id) return;
        try {
          await restoreItem(id);
          await loadItems();
          try {
            await openItem(id);
          } catch {}
        } catch (err) {}
      })
    );
  }

  /* -------------------- Item detail -------------------- */
  async function openItem(id) {
    currentItemId = id;
    try {
      const item = await core.api.get(`/api/items/${id}`);
      const latest = await core.api.get(`/api/items/${id}/timeline`);
      currentItem = item; 

      renderItemDetail(item, latest);
      prefillMovementForms(item);
      showMovementTab("receive");
      el.itemDrawer.showModal();
    } catch (err) {
      core.toast(`Failed to load item: ${err.message}`, "error");
    }
  }

  function updateMovementSummary(item) {
  const summaryEl = document.getElementById("movementSummary");
  if (!summaryEl || !item) return;

  const qty = item.quantity ?? 0;
  const unit = item.unit || "units";
  const sys = item.system_code ?? "—";
  const shelf = item.shelf_label ?? "—";

  summaryEl.textContent = `Available: ${qty} ${unit} at ${sys} / ${shelf}`;
}

function renderItemDetail(item, latest) {
  el.itemDetail.innerHTML = `
      <h3 class="item-header">
        <span class="item-title">
          ${item.name}
          <small>(${item.sku ?? "—"})</small>
        </span>
        ${clearanceBadge(
          item.clearance_level,
          core?.state?.currentUser?.max_clearance_level
        )}
      </h3>
      <div>System/Shelf: ${item.system_code ?? "—"} / ${item.shelf_label ?? "—"}</div>
      <div>Quantity: ${item.quantity} </div>
      <div>Status: ${item.is_out ? "Checked out" : "Available"}</div>
      <div>Last issue: ${formatWhen(item.last_issue_ts) ?? "—"}</div>
      <div>Last return: ${formatWhen(item.last_return_ts) ?? "—"}</div>
      <div>Last updated (metadata): ${formatWhen(item.updated_at) ?? "—"}</div>
      <hr />
      <h4>Timeline</h4>
      <ul>
        ${
          Array.isArray(latest)
            ? latest
                .map((m) => {
                  const when = formatWhen(m.timestamp);
                  const actor = m.actor ? ` • by ${m.actor}` : "";

                  if (m.source === "movement") {
                    const holder = m.holder ? ` • Holder: ${m.holder}` : "";
                    const qty = m.quantity != null ? `Qty ${m.quantity}` : "";
                    const shelf = m.shelf_id != null ? ` @ shelf #${m.shelf_id}` : "";
                    const note = m.note ? ` — ${m.note}` : "";
                    return `
                      <li>
                        <strong>${when}</strong> • ${m.kind.toUpperCase()}
                        ${qty}${shelf}${holder}${note}${actor}
                      </li>
                    `;
                  } else {
                    const note = m.note ? ` — ${m.note}` : "";
                    return `
                      <li>
                        <strong>${when}</strong> • ${m.kind.replace(/_/g, " ")}${note}${actor}
                      </li>
                    `;
                  }
                })
                .join("")
            : ""
        }
      </ul>
    `;

  const isDeleted = Number(item.is_deleted ?? 0) === 1;
  if (el.itemDeleteBtn) el.itemDeleteBtn.hidden = isDeleted;
  if (el.itemRestoreBtn) el.itemRestoreBtn.hidden = !isDeleted;
}


  function showMovementTab(kind) {
    if (!el.movementModal) return;

    const forms = el.movementModal.querySelectorAll("form[data-kind]");
    forms.forEach((f) => {
      const isActive = f.getAttribute("data-kind") === kind;
      f.hidden = !isActive;
    });

    const tabs = el.movementModal.querySelectorAll("nav [data-kind]");
    tabs.forEach((btn) => {
      const isActive = btn.getAttribute("data-kind") === kind;
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });
  }


  // ---------- Movements ----------
  function prefillMovementForms(item) {
    const setIf = (form, name, val) => {
      if (!form) return;
      const input = form.querySelector(`[name="${name}"]`);
      if (input) input.value = val ?? "";
    };
    const id = item.id;
    const shelfId = item.shelf_id ?? "";

    //metadata
    if (el.mvItemName) {
      el.mvItemName.textContent = item.name ?? "—";
    }
    if (el.mvLocationLabel) {
      const sys = item.system_code ?? "—";
      const shelfLabel = item.shelf_label ?? "—";
      el.mvLocationLabel.textContent = `${sys} / ${shelfLabel}`;
    }
    if (el.mvItemIdDisplay) {
      el.mvItemIdDisplay.textContent = id != null ? String(id) : "—";
    }

    if (el.mvToLocation && el.location) {
    //reset
    el.mvToLocation.innerHTML = "";

    //placeholder
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.textContent = "Choose destination";
    el.mvToLocation.appendChild(placeholder);

    //clone all non-empty options from header filter
    Array.from(el.location.options).forEach((opt) => {
      if (!opt.value) return;
      if (!opt.dataset.shelf) return; //skip
      if (opt.dataset.deleted === "1") return;
      el.mvToLocation.appendChild(opt.cloneNode(true));
    });
  }

    setIf(el.mvReceive, "item_id", id);
    setIf(el.mvReceive, "shelf_id", shelfId);
    setIf(el.mvIssue, "item_id", id);
    setIf(el.mvIssue, "shelf_id", shelfId);
    setIf(el.mvReturn, "item_id", id);
    setIf(el.mvReturn, "shelf_id", shelfId);
    setIf(el.mvAdjust, "item_id", id);
    setIf(el.mvAdjust, "shelf_id", shelfId);
    setIf(el.mvTransfer, "item_id", id);
    setIf(el.mvTransfer, "from_shelf_id", shelfId); 
  }

  async function submitMovement(e, endpoint) {
    e.preventDefault();
    try {
      const form = e.target;
      const kind = form.getAttribute("data-kind"); // receive | issue | return | adjust | transfer
      const data = core.serializeForm(form);

      // transfer shelf logic
      if (kind === "transfer") {
        const sel = form.querySelector("select[name='to_shelf_id']");
        if (sel) {
          const opt = sel.options[sel.selectedIndex];
          if (opt && opt.dataset.shelfId) {
            data.to_shelf_id = opt.dataset.shelfId; // make Number() below
          } else {
            data.to_shelf_id = "";
          }
        }
      }

      ["item_id", "shelf_id", "qty", "qty_delta", "from_shelf_id", "to_shelf_id"].forEach((k) => {
        if (data[k] !== undefined && data[k] !== "") data[k] = Number(data[k]);
      });

      const needPosInt = (n) => Number.isFinite(n) && n > 0 && Number.isInteger(n);

      if (kind === "receive") {
        if (!needPosInt(data.item_id) || !needPosInt(data.shelf_id) || !needPosInt(data.qty)) {
          throw new Error("Receive requires item, shelf, and a positive quantity.");
        }
      }

      if (kind === "issue") {
        if (!needPosInt(data.item_id) || !needPosInt(data.shelf_id) || !needPosInt(data.qty)) {
          throw new Error("Issue requires item, shelf, and a positive quantity.");
        }
        if (!String(data.holder_name || data.holder || "").trim()) {
          throw new Error("Issue requires a holder name.");
        }
      }

      if (kind === "return") {
        if (!needPosInt(data.item_id) || !needPosInt(data.shelf_id) || !needPosInt(data.qty)) {
          throw new Error("Return requires item, shelf, and a positive quantity.");
        }
      }

      if (kind === "adjust") {
        if (!needPosInt(data.item_id) || !needPosInt(data.shelf_id) || !Number.isFinite(data.qty_delta)) {
          throw new Error("Adjust requires item, shelf, and a signed quantity delta.");
        }
        delete data.qty;
      }

      if (kind === "transfer") {
        if (
          !needPosInt(data.item_id) ||
          !needPosInt(data.from_shelf_id) ||
          !needPosInt(data.to_shelf_id) ||
          !needPosInt(data.qty)
        ) {
          throw new Error("Transfer requires item, from shelf, to shelf, and a positive quantity.");
        }
        if (data.from_shelf_id === data.to_shelf_id) {
          throw new Error("Transfer needs two different shelves.");
        }
        delete data.shelf_id;
      }

      await core.api.post(endpoint, data);
      core.toast("Movement recorded", "success");
      core.bus.emit("movement:recorded", {});
      el.movementModal.close();
    } catch (err) {
      core.toast(err.message || String(err), "error");
    }
  }


  function bindMovementModal() {
    if (!el.movementModal) return;

    // Close button
    el.closeMovementModal?.addEventListener("click", () => el.movementModal.close());

    // Tab buttons
    el.movementModal
      .querySelectorAll("nav [data-kind]")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          const kind = btn.getAttribute("data-kind");
          showMovementTab(kind);
        });
      });

    //One handler for all movement forms
    el.movementModal.addEventListener("submit", (e) => {
      const form = e.target;
      if (!(form instanceof HTMLFormElement)) return;

      const kind = form.getAttribute("data-kind");
      if (!kind) return;

      let endpoint = "";
      switch (kind) {
        case "receive":
          endpoint = "/api/movements/receive";
          break;
        case "issue":
          endpoint = "/api/movements/issue";
          break;
        case "return":
          endpoint = "/api/movements/return";
          break;
        case "adjust":
          endpoint = "/api/movements/adjust";
          break;
        case "transfer":
          endpoint = "/api/movements/transfer";
          break;
        default:
          return; // unknown kind, ignore
      }

      submitMovement(e, endpoint);
    });
  }


  const transferAllBtn = document.getElementById("mv_transfer_all");
  if (transferAllBtn && el.mvTransfer) {
    transferAllBtn.addEventListener("click", () => {
      if (!currentItem) return;
      const qtyInput = el.mvTransfer.querySelector('input[name="qty"]');
      if (!qtyInput) return;
      const qty = currentItem.quantity ?? 0;
      qtyInput.value = qty > 0 ? String(qty) : "";
    });
  }


  /* -------------------- Admin Button -------------------- */
  function applyRoleUIForAdminButton(currentUser) {
    const adminBtn = document.getElementById("adminBtn");
    if (!adminBtn) return;

    const isAdmin = !!currentUser && String(currentUser.role || "").toLowerCase() === "admin";
    adminBtn.hidden = !isAdmin;

    if (isAdmin && !adminBtn._bound) {
      adminBtn.addEventListener("click", () => {
        const appSection   = document.getElementById("appSection");
        const adminSection = document.getElementById("adminSection");
        const inAdmin = adminSection && !adminSection.hidden;

        if (inAdmin) {
          //already in admin  go back to catalog
          showSection("app");
        } else {
          showSection("admin");
          if (window.Admin && typeof window.Admin.loadAdminLists === "function") {
            const incDel = getAdminPrefs().include_deleted === true;
            window.Admin.loadAdminLists({ include_deleted: incDel });
          }
        }
      });

      adminBtn._bound = true;
    }
  }

  function showSection(idToShow) {
    const app = document.getElementById("appSection");
    const admin = document.getElementById("adminSection");
    if (app) app.hidden = idToShow !== "app";
    if (admin) admin.hidden = idToShow !== "admin";
  }

  /* -------------------- Import / Export / Add item -------------------- */
  async function postMultipart(url, formData) {
    const res = await fetch(url, { method: "POST", credentials: "include", body: formData });
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

  function toQuery(params) {
    const usp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== "" && v !== null && v !== undefined) usp.set(k, v);
    });
    return usp.toString();
  }

  function getFilters() {
    const statusVal = el.status?.value || "";
    const isDeletedView = statusVal === "deleted";
    const includeDeleted = isDeletedView ? "true" : getHeaderDeletedState() ? "true" : "false";

    const { system_code, shelf_label } = getLocationFilter();

    return {
      q: el.q?.value || "",
      status: statusVal,
      system_code,
      shelf_label,
      include_deleted: includeDeleted,
      sort: currentSort,
      dir: currentDir,
      page: String(currentPage),
      page_size: el.page_size?.value || "50",
    };
  }

  function bindAddItem() {
    const addBtn = document.getElementById("addItemBtn");
    const dlg = document.getElementById("addItemDialog");

    const form = document.getElementById("addItemForm");
    const btnCancel = document.getElementById("addItemCancel");
    const btnSubmit = document.getElementById("addItemSubmit");
    const errEl = document.getElementById("addItemError");

    const tabManual = document.getElementById("aiTabManual");
    const tabImport = document.getElementById("aiTabImport");
    const pnlManual = document.getElementById("aiPanelManual");
    const pnlImport = document.getElementById("aiPanelImport");

    const aiSystem = document.getElementById("ai_system");
    const aiShelf = document.getElementById("ai_shelf");

    if (!addBtn || !dlg) return;

    let _systemsCache = null;
    function systemByCode(code) {
      return (_systemsCache || []).find((s) => s.code === code);
    }

    async function loadSystemsOnce() {
      if (_systemsCache && _systemsCache.length) return _systemsCache;
      const systems = await core.api.get("/api/systems", { include_deleted: false });
      _systemsCache = Array.isArray(systems) ? systems : [];
      aiSystem.innerHTML =
        `<option value="" disabled selected>Choose a system</option>` +
        _systemsCache.map((s) => `<option value="${s.code}">${s.code}</option>`).join("");
      return _systemsCache;
    }

    async function loadShelvesForSystemCode(system_code) {
      aiShelf.innerHTML = `<option value="" disabled selected>Choose a shelf</option>`;
      if (!system_code) return;
      const sys = systemByCode(system_code);
      if (!sys) return;
      const shelves = await core.api.get("/api/shelves", { system_id: sys.id, include_deleted: false });
      aiShelf.innerHTML =
        `<option value="" disabled selected>Choose a shelf</option>` +
        (Array.isArray(shelves) ? shelves : [])
          .map((sh) => `<option value="${sh.label}">${sh.label}</option>`)
          .join("");
    }

    aiSystem?.addEventListener("change", async () => {
      await loadShelvesForSystemCode(aiSystem.value || "");
    });

    function showTab(which) {
      const manual = which === "manual";
      tabManual.classList.toggle("tab-btn-active", manual);
      tabImport.classList.toggle("tab-btn-active", !manual);
      pnlManual.hidden = !manual;
      pnlImport.hidden = manual;
      pnlManual.classList.toggle("tab-panel-active", manual);
      pnlImport.classList.toggle("tab-panel-active", !manual);
    }
    tabManual?.addEventListener("click", () => showTab("manual"));
    tabImport?.addEventListener("click", () => showTab("import"));

    addBtn.addEventListener("click", async () => {
      const f = getFilters();
      if (errEl) errEl.textContent = "";
      form?.reset();
      showTab("manual");
      dlg.showModal();

      try {
        await loadSystemsOnce();
        if (f.system_code) aiSystem.value = f.system_code;
        await loadShelvesForSystemCode(aiSystem.value || f.system_code || "");
        if (f.shelf_label) aiShelf.value = f.shelf_label;
      } catch (e) {
        console.warn("Prefill System/Shelf failed:", e);
      }

      setTimeout(() => document.getElementById("ai_name")?.focus(), 10);
    });

    btnCancel?.addEventListener("click", () => dlg.close());
    document.getElementById("addItemCancel2")?.addEventListener("click", () => dlg.close());

    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!btnSubmit) return;
      if (errEl) errEl.textContent = "";
      btnSubmit.disabled = true;

      const payload = {
        sku: (document.getElementById("ai_sku")?.value || "").trim() || undefined,
        name: (document.getElementById("ai_name")?.value || "").trim(),
        unit: (document.getElementById("ai_unit")?.value || "units").trim(),
        clearance_level: Number(document.getElementById("ai_cl")?.value || 0),
        system_code: (aiSystem?.value || "").trim(),
        shelf_label: (aiShelf?.value || "").trim(),
        quantity: Number(document.getElementById("ai_qty")?.value || 0),
        tag: (document.getElementById("ai_tag")?.value || "").trim() || undefined,
        note: (document.getElementById("ai_note")?.value || "").trim() || undefined,
      };

      if (!payload.name || !payload.system_code || !payload.shelf_label) {
        if (errEl) errEl.textContent = "Name, System, and Shelf are required.";
        btnSubmit.disabled = false;
        return;
      }
      if (payload.clearance_level < 1 || payload.clearance_level > 4) {
        if (errEl) errEl.textContent = "Clearance level must be between 1 and 4.";
        btnSubmit.disabled = false;
        return;
      }
      if (payload.quantity < 0) {
        if (errEl) errEl.textContent = "Quantity must be zero or greater.";
        btnSubmit.disabled = false;
        return;
      }

      try {
        await core.api.post("/api/items", payload);
        core.toast("Item added", "success");
        currentSort = "last_movement_ts";
        currentDir = "desc";
        currentPage = 1;
        await loadItems();
        dlg.close();
        form.reset();
      } catch (err) {
        if (errEl) errEl.textContent = String(err.message || err);
      } finally {
        btnSubmit.disabled = false;
      }
    });
  }

  function bindImport() {
    const importBtn = document.getElementById("importBtn");
    const importFile = document.getElementById("importFile");
    const statusEl = document.getElementById("importStatus");

    if (!importBtn || !importFile) return;

    const REQUIRED_HEADERS = [
      "sku",
      "name",
      "unit",
      "clearance_level",
      "system_code",
      "shelf_label",
      "quantity",
      "tag",
      "note",
    ];

    importBtn.addEventListener("click", () => importFile.click());

    importFile.addEventListener("change", async () => {
      const file = importFile.files?.[0];
      if (!file) return;

      if (statusEl) statusEl.textContent = "";

      // quick CSV header check
      if (file.name.toLowerCase().endsWith(".csv")) {
        try {
          const text = await file.text();
          const firstLine = (text.split(/\r?\n/)[0] || "").trim();
          const headers = firstLine.split(",").map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());
          const requiredStr = REQUIRED_HEADERS.join(",");
          const headerStr = headers.join(",");
          if (!headerStr.startsWith(requiredStr)) {
            if (statusEl)
              statusEl.textContent = `Header mismatch. Expected "${requiredStr}". Found: ${headerStr || "(empty)"}`;
            return;
          }
        } catch (e) {
          console.warn("CSV sniff failed:", e);
        }
      }

      const fd = new FormData();
      fd.append("file", file);

      importBtn.disabled = true;
      if (statusEl) statusEl.textContent = `Importing “${file.name}”…`;

      try {
        const res = await postMultipart("/api/items/import", fd);
        const { inserted = 0, updated = 0, skipped = 0, errors = [] } = res || {};
        const errSuffix = errors?.length ? ` • errors: ${errors.length}` : "";
        if (statusEl)
          statusEl.textContent = `Import complete • inserted: ${inserted}, updated: ${updated}, skipped: ${skipped}${errSuffix}`;

        currentSort = "last_movement_ts";
        currentDir = "desc";
        currentPage = 1;
        await loadItems();
      } catch (err) {
        if (statusEl) statusEl.textContent = `Import failed: ${String(err.message || err)}`;
      } finally {
        importBtn.disabled = false;
        importFile.value = "";
      }
    });
  }

  function bindExport() {
    const exportBtn = document.getElementById("exportBtn");
    const dlg = document.getElementById("exportDialog");
    const form = document.getElementById("exportForm");
    const cancelBtn = document.getElementById("exportCancel");
    const exIncludeDeleted = document.getElementById("ex_include_deleted");

    if (!exportBtn || !dlg || !form) return;

    exportBtn.addEventListener("click", () => {
      const f = getFilters();

      if (exIncludeDeleted) {
        exIncludeDeleted.checked = f.include_deleted === "true";
      }

      dlg.showModal();
    });

    cancelBtn?.addEventListener("click", () => {
      dlg.close();
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();

      const f = getFilters();
      const mode = (form.querySelector("input[name='ex_mode']:checked")?.value || "items");

      if (exIncludeDeleted) {
        f.include_deleted = exIncludeDeleted.checked ? "true" : "false";
      }
      f.sort = "sku";
      f.dir = "asc";

      let url = "";

      if (mode === "items") {
        const qs = toQuery(f);
        url = `/api/items/export?${qs}`;
      } else if (mode === "movements") {
        const mvParams = {
          system_code: f.system_code,
          shelf_label: f.shelf_label,
        };
        const qs = toQuery(mvParams);
        url = `/api/movements/export?${qs}`;
      } else if (mode === "both") {
        const qs = toQuery(f); 
        url = `/api/export/bundle?${qs}`;
      }

      if (url) {
        window.open(url, "_self");
      }

      dlg.close();
    });
  }




  function bindInventoryActions() {
    bindAddItem();
    bindImport();
    bindExport();
    bindEditItem();
  }

  function bindEditItem() {
    const dlg = document.getElementById("editItemDialog");
    const form = document.getElementById("editItemForm");
    const errEl = document.getElementById("editItemError");

    const eiSystem = document.getElementById("ei_system");
    const eiShelf = document.getElementById("ei_shelf");

    let _sysCache = null;

    async function loadSystems() {
      if (_sysCache) return _sysCache;
      const systems = await core.api.get("/api/systems", { include_deleted: false });
      _sysCache = Array.isArray(systems) ? systems : [];
      eiSystem.innerHTML =
        `<option value="" disabled>Choose system</option>` +
        _sysCache.map(s => `<option value="${s.code}">${s.code}</option>`).join("");
      return _sysCache;
    }

    async function loadShelves(system_code) {
      eiShelf.innerHTML = `<option value="" disabled selected>Choose shelf</option>`;
      if (!system_code) return;
      const sys = _sysCache.find(s => s.code === system_code);
      if (!sys) return;
      const shelves = await core.api.get("/api/shelves", { system_id: sys.id, include_deleted: false });
      eiShelf.innerHTML =
        `<option value="" disabled>Choose shelf</option>` +
        shelves.map(sh => `<option value="${sh.label}">${sh.label}</option>`).join("");
    }

    eiSystem.addEventListener("change", async () => {
      await loadShelves(eiSystem.value);
    });

    el.itemsTbody?.addEventListener("click", async (e) => {
      const btn = e.target.closest(".btn-edit");
      if (!btn) return;

      e.stopPropagation(); // don’t trigger row click / drawer

      const id = btn.dataset.id;
      if (!id) return;

      try {
        const item = await core.api.get(`/api/items/${id}`);

        await loadSystems();
        await loadShelves(item.system_code);

        document.getElementById("ei_id").value = item.id;
        document.getElementById("ei_name").value = item.name || "";
        document.getElementById("ei_sku").value = item.sku || "";
        document.getElementById("ei_unit").value = item.unit || "";
        document.getElementById("ei_cl").value = item.clearance_level;
        document.getElementById("ei_system").value = item.system_code || "";
        document.getElementById("ei_shelf").value = item.shelf_label || "";
        document.getElementById("ei_tag").value = item.tag || "";
        document.getElementById("ei_note").value = item.note || "";

        if (errEl) errEl.textContent = "";
        dlg.showModal();
      } catch (err) {
        if (errEl) errEl.textContent = err.message || "Failed to load item";
      }
    });

    document.getElementById("editItemCancel")?.addEventListener("click", () => dlg.close());

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (errEl) errEl.textContent = "";

      const payload = {
        name:  document.getElementById("ei_name").value.trim(),
        sku:   document.getElementById("ei_sku").value.trim() || null,
        unit:  document.getElementById("ei_unit").value.trim(),
        clearance_level: Number(document.getElementById("ei_cl").value),
        system_code: document.getElementById("ei_system").value,
        shelf_label: document.getElementById("ei_shelf").value,
        tag:   document.getElementById("ei_tag").value.trim() || null,
        note:  document.getElementById("ei_note").value.trim() || null,
      };

      const id = document.getElementById("ei_id").value;

      try {
        await core.api.put(`/api/items/${id}`, payload);
        dlg.close();
        await loadItems();
        if (currentItemId) {
          // refresh drawer
          try { await openItem(currentItemId); } catch {}
        }
        core.toast("Item updated", "success");
      } catch (err) {
        if (errEl) errEl.textContent = err.message || "Update failed";
      }
    });
  }


  // role-gated in drawer
function bindItemDrawer() {
  el.closeItemDrawer?.addEventListener("click", () => {
    if (el.itemDrawer?.open) el.itemDrawer.close();
  });

  //open movement modal from inside the drawer
  el.openMovementModal?.addEventListener("click", () => {
    if (!currentItemId) {
      core.toast("No item selected.", "error");
      return;
    }
    updateMovementSummary(currentItem);
    showMovementTab("receive");
    el.movementModal?.showModal();
  });

  // Drawer Delete -> same logic as table delete, but for the currently opened item
  el.itemDeleteBtn?.addEventListener("click", async () => {
    if (!currentItemId) {
      core.toast("No item selected.", "error");
      return;
    }
    try {
      await softDeleteItem(currentItemId);
      await loadItems();
      //refresh the detail view to reflect deleted state
      const item = await core.api.get(`/api/items/${currentItemId}`);
      const latest = await core.api.get(`/api/items/${currentItemId}/timeline`);
      renderItemDetail(item, latest);
      prefillMovementForms(item);
      core.toast("Item deleted", "success");
    } catch (err) {
      core.toast(String(err.message || err), "error");
    }
  });

  el.itemRestoreBtn?.addEventListener("click", async () => {
    if (!currentItemId) {
      core.toast("No item selected.", "error");
      return;
    }
    try {
      await restoreItem(currentItemId);
      await loadItems();
      const item = await core.api.get(`/api/items/${currentItemId}`);
      const latest = await core.api.get(`/api/items/${currentItemId}/timeline`);
      renderItemDetail(item, latest);
      prefillMovementForms(item);
      core.toast("Item restored", "success");
    } catch (err) {
      core.toast(String(err.message || err), "error");
    }
  });

  //hides delete/restore if not admin
  core.applyRoleVisibility();
}

  return { init };
})();

document.addEventListener("DOMContentLoaded", App.init);
