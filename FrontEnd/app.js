(async function guardSessionOrSendHome() {
  try {
    const res = await fetch('/api/session/me', { credentials: 'include' });
    if (!res.ok) {
      window.location.replace('homepage.html#signin');
      return;
    }
  } catch (e) {
    window.location.replace('homepage.html#signin');
    return;
  }
})();

let APP_SETTINGS = null;

async function loadAppSettings() {
  try {
    const r = await fetch('/api/settings', { credentials: 'include' });
    if (!r.ok) return; // silently ignore if not admin
    APP_SETTINGS = await r.json();
  } catch {}
}

//auth before everything 
let currentUser = null;
const guestBtn = document.getElementById('guestBtn');

if (guestBtn) {
  guestBtn.addEventListener('click', async (e) => {
    e.preventDefault();

    // Guest mode is explicitly "not logged in".
    // We do NOT call /api/session/login.
    // We just set currentUser locally and apply role.
    currentUser = { role: "guest" };

    applyRoleUI();
    updateHeaderUserInfo();  // will show "Guest (read-only)" if you added that text
    hideSessionModal();
    await loadFiles();
  });
}

const prevPageBtn  = document.getElementById('prevPageBtn');
const nextPageBtn  = document.getElementById('nextPageBtn');
const pagerStatusEl = document.getElementById('pagerStatus');

if (prevPageBtn) {
  prevPageBtn.addEventListener('click', async () => {
    if (currentPage > 1) {
      currentPage -= 1;
      await loadFiles();
    }
  });
}

if (nextPageBtn) {
  nextPageBtn.addEventListener('click', async () => {
    currentPage += 1;
    await loadFiles();
  });
}

const sessionModalEl       = document.getElementById('sessionModal');
const sessionTabadmin   = document.getElementById('sessionTabadmin');
const sessionTabViewer     = document.getElementById('sessionTabViewer');
const sessionPaneladmin = document.getElementById('sessionPaneladmin');
const sessionPanelViewer   = document.getElementById('sessionPanelViewer');

const opEmailEl    = document.getElementById('opEmail');
const opPasswordEl = document.getElementById('opPassword');
const opFormEl     = document.getElementById('sessionadminForm');
const opErrorEl    = document.getElementById('opError');

const viewerEmailEl    = document.getElementById('viewerEmail');
const viewerPasswordEl = document.getElementById('viewerPassword');
const viewerFormEl     = document.getElementById('sessionViewerForm');
const viewerErrorEl    = document.getElementById('viewerError');

const sessionUserInfoEl = document.getElementById('sessionUserInfo');
const logoutBtn         = document.getElementById('logoutBtn');


let currentPage = 1;
let PAGE_SIZE = 100;

// tab switching
function activateadminTab() {
  sessionTabadmin.classList.add('session-tab-active');
  sessionTabViewer.classList.remove('session-tab-active');

  sessionPaneladmin.classList.add('session-panel-active');
  sessionPanelViewer.classList.remove('session-panel-active');
}
function activateViewerTab() {
  sessionTabViewer.classList.add('session-tab-active');
  sessionTabadmin.classList.remove('session-tab-active');

  sessionPanelViewer.classList.add('session-panel-active');
  sessionPaneladmin.classList.remove('session-panel-active');
}


function $val(id){ const el=document.getElementById(id); return el ? String(el.value).trim() : ""; }
function $num(id){ const v=$val(id); const n=v===""?NaN:Number(v); return Number.isFinite(n)?n:null; }


sessionTabadmin.addEventListener('click', activateadminTab);
sessionTabViewer.addEventListener('click', activateViewerTab);

//settings button
const settingsLink = document.getElementById('settingsLink');

// helper: show/hide full overlay
function showSessionModal() {
  sessionModalEl.style.display = 'flex';
}
function hideSessionModal() {
  sessionModalEl.style.display = 'none';
}

// update header user info + logout visibility
function updateHeaderUserInfo() {
  if (!currentUser) {
    sessionUserInfoEl.textContent = "";
    if (logoutBtn) logoutBtn.style.display = "none";
    return;
  }
  sessionUserInfoEl.textContent = `${currentUser.email} (${currentUser.role})`;
  if (logoutBtn) logoutBtn.style.display = "";
}
// login submit (admin)
opFormEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  opErrorEl.textContent = "";

  const email = opEmailEl.value.trim();
  const password = opPasswordEl.value;

  try {
    const res = await fetch('/api/session/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password })
    });

    if (!res.ok) {
      const txt = await res.text();
      opErrorEl.textContent = "Sign-in failed.";
      return;
    }

    // success
    await fetchSession();         // sets currentUser + applyRoleUI()
    updateHeaderUserInfo();
    hideSessionModal();
    await loadFiles();

  } catch (err) {
    opErrorEl.textContent = "Network error.";
  }
});

// login submit (viewer)
viewerFormEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  viewerErrorEl.textContent = "";

  const email = viewerEmailEl.value.trim();
  const password = viewerPasswordEl.value;

  try {
    const res = await fetch('/api/session/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password })
    });

    if (!res.ok) {
      const txt = await res.text();
      viewerErrorEl.textContent = "Sign-in failed.";
      return;
    }

    // success
    await fetchSession();
    updateHeaderUserInfo();
    hideSessionModal();
    await loadFiles();

  } catch (err) {
    viewerErrorEl.textContent = "Network error.";
  }
});

// logout
if (logoutBtn) {
  logoutBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      await fetch('/api/session/logout', {
        method: 'POST',
        credentials: 'include'
      });
    } catch (_) {
      // ignore
    }
    // Redirect to the public landing/sign-in
    window.location.replace('homepage.html#signin');
  });
}


async function fetchSession() {
  try {
    const res = await fetch('/api/session/me', {
      method: 'GET',
      credentials: 'include',
    });

    if (!res.ok) {
      // guest mode
      currentUser = { role: "guest" };
      applyRoleUI();
      return;
    }

    const data = await res.json();
    currentUser = {
      email: data.email,
      role: data.role,
    };
    applyRoleUI();

  } catch (err) {
    console.error("fetchSession failed:", err);
    currentUser = { role: "guest" };
    applyRoleUI();
  }
}

// this controls what a viewer can/can't do in the UI
function applyRoleUI() {
  const role = currentUser?.role || "guest";
  const isadmin = role === "admin";
  const isViewer = role === "User";
  const isGuest = role === "guest";

  // --- Add File button / Import tab ---
  if (openAddFileBtn) {
    if (isadmin) {
      openAddFileBtn.disabled = false;
      openAddFileBtn.style.opacity = "";
      openAddFileBtn.style.pointerEvents = "";
    } else {
      // viewer + guest can’t open this modal
      openAddFileBtn.disabled = true;
      openAddFileBtn.style.opacity = "0.5";
      openAddFileBtn.style.pointerEvents = "none";
    }
  }

  // If you have "Import" tab / CSV upload stuff in that same modal,
  // you can hide the tab for non-admins:
  if (tabImportBtn) {
    tabImportBtn.style.display = isadmin ? "" : "none";
  }

  // --- Show Deleted checkbox ---
  if (showDeletedEl) {
    if (isadmin) {
      showDeletedEl.disabled = false;
      showDeletedEl.style.opacity = "";
      showDeletedEl.style.pointerEvents = "";
    } else {
      showDeletedEl.checked = false;
      showDeletedEl.disabled = true;
      showDeletedEl.style.opacity = "0.5";
      showDeletedEl.style.pointerEvents = "none";
    }
  }

  // --- Export button/modal ---
  // Behavior you asked for:
  // - guest: no export at all (hide button)
  // - viewer: can open export but ONLY "files" option should be selectable
  // - admin: full export menu

  if (exportOpenBtn) {
    if (isGuest) {
      exportOpenBtn.style.display = "none";
    } else {
      exportOpenBtn.style.display = "";
    }
  }

  // We'll also restrict the export modal's radio buttons when it opens.
  // We'll handle that below in openExportModal().

  // --- Logout button visibility ---
  if (logoutBtn) {
    if (isGuest) {
      // guest isn't "logged in", so hide logout
      logoutBtn.style.display = "none";
    } else {
      logoutBtn.style.display = "";
    }
  }

  // --- Header user text ---
  // your updateHeaderUserInfo() already handles this using currentUser,
  // but if you want guest to say "Guest (read-only)" you can tweak:
  if (isGuest) {
    sessionUserInfoEl.textContent = "Guest (read-only)";
  }

  if (settingsLink) settingsLink.style.display = isadmin ? "" : "none";
}



//end auth

// delete (archive)
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.btn-delete');
  if (!btn) return;

  e.stopPropagation();
  const id = parseInt(btn.dataset.id, 10);
  if (!Number.isInteger(id)) return alert('Invalid item id — cannot delete.');
  if (!confirm('Archive this item?')) return;

  const res = await fetch(`/api/items/${id}`, { method: 'DELETE', credentials: 'include' });
  if (!res.ok) return alert('Delete failed: ' + await res.text());
  await loadFiles();
});

// restore
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.btn-restore');
  if (!btn) return;

  e.stopPropagation();
  const id = parseInt(btn.dataset.id, 10);
  if (!Number.isInteger(id)) return alert('Invalid item id — cannot restore.');

  const res = await fetch(`/api/items/${id}/restore`, { method: 'PATCH', credentials: 'include' });
  if (!res.ok) return alert('Restore failed: ' + await res.text());
  await loadFiles();
});

let fileCache = {};

let currentSort = "created_at";
let currentDir = "desc";

const addFileModalEl = document.getElementById('addFileModal');
   // manual tab cancel
const importCancelBtn     = document.getElementById('importCancelBtn');        /*what where did this  come from */
const addFileCancelBtn = document.getElementById('addFileCancelBtn');

if (addFileCancelBtn) {
  addFileCancelBtn.addEventListener('click', closeAddFileModal);
}
if (importCancelBtn) {           /* good lord knows what the hell is going on here */
  importCancelBtn.addEventListener('click', closeAddFileModal);
}

const form = document.getElementById('fileForm');
const tableBody = document.querySelector('#fileTable tbody');
const showDeletedEl = document.getElementById('showDeleted');
// Modal state
let modalMode = null;      // "checkout" or "return"
let modalFileId = null;
// Modal DOM refs
const modalEl = document.getElementById('checkoutModal');
const modalTitleEl = document.getElementById('modalTitle');
const holderFieldEl = document.getElementById('holderField');
const modalHolderInput = document.getElementById('modal_holder_name');
const modalNoteInput = document.getElementById('modal_note');
const modalCancelBtn = document.getElementById('modalCancelBtn');
const modalConfirmBtn = document.getElementById('modalConfirmBtn');
//searchbox
const searchWrapperEl = document.querySelector('.search-wrapper');
const searchInputEl = document.getElementById('searchBox');

if (searchInputEl && searchWrapperEl) {
  searchInputEl.addEventListener('focus', () => {
    searchWrapperEl.classList.add('focused');
  });
  searchInputEl.addEventListener('blur', () => {
    // collapse back only if field is empty, feels nicer
    if (!searchInputEl.value.trim()) {
      searchWrapperEl.classList.remove('focused');
    }
  });
};

// Details modal refs
const detailsModalEl = document.getElementById('detailsModal');
const detailsCloseBtn = document.getElementById('detailsCloseBtn');
const detailsTitleEl = document.getElementById('detailsTitle');
const detailsIdEl = document.getElementById('details_id');
const detailsNameEl = document.getElementById('details_name');
const detailsTagEl = document.getElementById('details_tag');
const detailsNoteEl = document.getElementById('details_note');
const detailsLocEl = document.getElementById('details_loc');
const detailsClearanceEl = document.getElementById('details_clearance');
const detailsAddedByEl = document.getElementById('details_added_by');
const detailsCreatedEl = document.getElementById('details_created');
const detailsHolderEl = document.getElementById('details_holder');
const detailsCheckoutAtEl = document.getElementById('details_checkout_at');
const detailsPrevCheckoutEl = document.getElementById('details_prev_checkout');
const detailsStatusEl = document.getElementById('details_status');
const detailsHistoryEl = document.getElementById('details_history');
const detailsModifiedEl = document.getElementById('details_modified');
const detailsSizeEl = document.getElementById('details_size');
const detailsTypeEl = document.getElementById('details_type');
// Tab buttons
const tabManualBtn  = document.getElementById('tabManualBtn');
const tabImportBtn  = document.getElementById('tabImportBtn');
const manualPanel   = document.getElementById('manualPanel');
const importPanel   = document.getElementById('importPanel');
//csv things
const csvFileInput    = document.getElementById('csvFileInput');
const csvImportBtn    = document.getElementById('csvImportBtn');
const csvCancelBtn    = document.getElementById('csvCancelBtn');
const csvImportStatus = document.getElementById('csvImportStatus');
//files editing
const editFileModalEl   = document.getElementById('editFileModal');
const editFileForm      = document.getElementById('editFileForm');
const editFileCancelBtn = document.getElementById('editFileCancelBtn');

const editNameEl       = document.getElementById('edit_name');
const editTagEl        = document.getElementById('edit_tag');
const editNoteEl       = document.getElementById('edit_note');
const editSystemEl     = document.getElementById('edit_system_number');
const editShelfEl      = document.getElementById('edit_shelf');
const editClearanceEl  = document.getElementById('edit_clearance_level');
// legacy
const editSizeEl = document.getElementById('edit_size_label');
const editTypeEl = document.getElementById('edit_type_label');

//export
const exportOpenBtn = document.getElementById('exportOpenBtn');
const exportModalEl = document.getElementById('exportModal');
const exportCancelBtn = document.getElementById('exportCancelBtn');
const exportConfirmBtn = document.getElementById('exportConfirmBtn');

const statusFilterEl = document.getElementById('statusFilter');
 if (statusFilterEl) {
      statusFilterEl.addEventListener('change', () => {
        loadFiles();
      });
}

// Apply defaults on boot (only if elements exist)
if (statusFilterEl) statusFilterEl.value = readDefaultStatusFilter();     // '', 'available', 'out'
if (showDeletedEl)  showDeletedEl.checked = readDefaultShowDeleted(); 


//time management
function formatTimestamp(ts) {
  if (!ts) return "—";

  // normalize "YYYY-MM-DD HH:MM:SS" -> "YYYY-MM-DDTHH:MM:SSZ" (treat as UTC-ish)
  let normalized = ts.trim().replace(" ", "T");
  if (!/Z$/.test(normalized) && !/[+-]\d\d:\d\d$/.test(normalized)) {
    normalized += "Z";
  }

  const d = new Date(normalized);
  if (isNaN(d.getTime())) {
    return ts; // fallback raw
  }

  const day = d.getDate();
  const monthNamesShort = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const month = monthNamesShort[d.getMonth()];
  const year = d.getFullYear();

  let hours24 = d.getHours();            // 0-23
  let minutes = d.getMinutes();          // 0-59

  let suffix = "AM";
  let hours12 = hours24;

  if (hours24 === 0) {
    hours12 = 12;
    suffix = "AM";
  } else if (hours24 === 12) {
    hours12 = 12;
    suffix = "PM";
  } else if (hours24 > 12) {
    hours12 = hours24 - 12;
    suffix = "PM";
  } else {
    suffix = "AM";
  }

  const hh = hours12.toString().padStart(2, "0");
  const mm = minutes.toString().padStart(2, "0");

  return `${day} ${month} ${year}, ${hh}:${mm} ${suffix}`;
}

async function updateFooterStats() {
  try {
    const res = await fetch(`/api/items/stats`, { credentials: 'include' });
    if (!res.ok) { console.warn("footer stats failed status", res.status); return; }

    const stats = await res.json();
    // { active_count, archived_count (may be null for viewer), total_count }

    const activeCount   = stats.active_count ?? 0;
    const archivedCount = stats.archived_count;
    const totalCount    = stats.total_count ?? activeCount;

    const activeLabel  = `${activeCount} active item${activeCount === 1 ? '' : 's'}`;
    const archivedLabel = (archivedCount === null || archivedCount === undefined)
      ? "" : `${archivedCount} archived`;
    const totalLabel   = `${totalCount} total`;

    const activeEl   = document.getElementById('footerActiveCount');
    const archivedEl = document.getElementById('footerArchivedCount');
    const totalEl    = document.getElementById('footerTotalCount');
    if (activeEl)  activeEl.textContent = activeLabel;
    if (totalEl)   totalEl.textContent  = totalLabel;

    const bullets = document.querySelectorAll('.footer-separator');
    if (!archivedLabel) {
      if (archivedEl) archivedEl.textContent = "";
      bullets.forEach(b => { if (b.previousElementSibling?.id === 'footerActiveCount') b.textContent = ""; });
    } else {
      if (archivedEl) archivedEl.textContent = archivedLabel;
      bullets.forEach(b => { if (b.previousElementSibling?.id === 'footerActiveCount') b.textContent = "•"; });
    }

    document.getElementById('tableFooter')?.classList.add('show');
  } catch (err) {
    console.warn("footer stats failed", err);
  }
}


// handle submission
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  // NEW payload for items
  const payload = {
    name: document.getElementById('name').value.trim(),
    tag: document.getElementById('tag').value.trim(),
    note: document.getElementById('note').value.trim(),
    clearance_level: parseInt(document.getElementById('clearance_level').value, 10) || 1,

    height_mm: parseFloat(document.getElementById('height_mm').value) || null,
    width_mm:  parseFloat(document.getElementById('width_mm').value)  || null,
    depth_mm:  parseFloat(document.getElementById('depth_mm').value)  || null,

    location: {
      system_number: (document.getElementById('loc_system').value || '').trim(),
      shelf:         (document.getElementById('loc_shelf').value || '').trim()
    }
  };

  try {
    const res = await fetch('/api/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const msg = await res.text();
      alert('Error: ' + msg);
      return;
    }

    alert('Item added.');
    form.reset();
    closeAddFileModal();
    await loadFiles();

  } catch (err) {
    alert('Network error: ' + err.message);
  }
});

function updatePagerUI(page, pageSize, total) {
  // total pages:
  // we do math carefully: maxPage = ceil(total / pageSize), but guard 0
  const safePageSize = pageSize > 0 ? pageSize : 1;
  const maxPage = Math.max(1, Math.ceil(total / safePageSize));

  // keep global currentPage in sync with what the server actually returned
  currentPage = page;

  // update "Page X of Y"
  if (pagerStatusEl) {
    pagerStatusEl.textContent = `Page ${page} of ${maxPage}`;
  }

  // enable/disable buttons
  if (prevPageBtn) {
    prevPageBtn.disabled = (page <= 1);
  }

  if (nextPageBtn) {
    nextPageBtn.disabled = (page >= maxPage);
  }
}


// --------------------------------------------------------------------------------fetch and display 
async function loadFiles() {
  const includeDeleted = !!(showDeletedEl && showDeletedEl.checked);
  const q = searchInputEl ? searchInputEl.value.trim() : "";
  const statusVal = statusFilterEl ? statusFilterEl.value : "";

  const params = new URLSearchParams({
    q,
    include_deleted: includeDeleted ? "true" : "false",
    status: statusVal || "",
    sort: currentSort || "created_at",
    dir: currentDir || "desc",
    page: String(currentPage),
    page_size: String(PAGE_SIZE),
  });

  let data;
  try {
    const res = await fetch(`/api/items?${params.toString()}`, { credentials: 'include' });
    if (!res.ok) throw new Error(await res.text());
    data = await res.json(); // { items, page, page_size, total }
  } catch (err) {
    console.error(err);
    alert('Failed to load files: ' + (err.message || err));
    return;
  }

  const items    = data.items     || [];
  const page     = data.page      || currentPage;
  const pageSize = data.page_size || PAGE_SIZE;
  const total    = data.total     ?? items.length;

  tableBody.innerHTML = '';
  fileCache = {};

  // optional client-side search refinement
  let view = items;
  const qnorm = q.toLowerCase();
  if (qnorm) {
    view = items.filter(f => {
      const held = (f.currently_held_by || '').toLowerCase();
      const note = (f.note || '').toLowerCase();
      const name = (f.name || '').toLowerCase();
      const tag  = (f.tag  || '').toLowerCase();
      return held.includes(qnorm) || note.includes(qnorm) || name.includes(qnorm) || tag.includes(qnorm);
    });
  }

  view.forEach(f => {
    fileCache[f.id] = f;

    const isDeleted = Number(f.is_deleted) === 1;
    const isOut = !!f.currently_held_by;

    // status badge
    const statusBadgeHTML = isDeleted
      ? `<span class="badge badge-status-archived">Archived</span>`
      : isOut
        ? `<span class="badge badge-status-out">Checked out</span>`
        : `<span class="badge badge-status-available">Available</span>`;

    // clearance badge
    const cl = Number(f.clearance_level) || 1;
    const clearanceBadgeHTML = `<span class="badge badge-clearance-${cl}">L${cl}</span>`;

    const createdDisplay = formatTimestamp(f.created_at);

    let prevCheckoutDisp = "—";
    if (isOut) {
      if (f.date_of_checkout) {
        prevCheckoutDisp = `<span style="color:#a11; font-weight:500;">↗</span> ${formatTimestamp(f.date_of_checkout)}`;
      }
    } else {
      const lastReturnTs = f.last_return_at || f.last_movement_ts;
      if (lastReturnTs) {
        prevCheckoutDisp = `<span style="color:#145d2e; font-weight:500;">↘</span> ${formatTimestamp(lastReturnTs)}`;
      }
    }

    const isAdmin = (currentUser?.role || "guest") === "admin";

    // lifecycle (delete/restore) — call the correct functions you actually have
    const lifecycleButtons = isAdmin
      ? (isDeleted
          ? `<button type="button" class="table-btn btn-restore" data-id="${f.id}">Restore</button>`
          : (isOut
              ? `—` // don’t allow delete while checked out
              : `<button type="button" class="table-btn btn-delete" data-id="${f.id}">Delete</button>`))
      : "—";

    // checkout/return
    const checkoutButtons = isAdmin
      ? (isDeleted
          ? "—"
          : (isOut
              ? `<button class="table-btn btn-return" onclick="openReturnModal(${f.id})">Return</button>`
              : `<button class="table-btn btn-checkout" onclick="openCheckoutModal(${f.id})">Check Out</button>`))
      : "—";

    const editButtonHTML = isAdmin
      ? `<button class="icon-btn" onclick="openEditModal(${f.id}); event.stopPropagation();" title="Edit item">✎</button>`
      : "—";

    const row = document.createElement('tr');
row.classList.add('row-clickable');
if (isDeleted) row.classList.add('row-deleted');
row.dataset.id = String(f.id); 

row.innerHTML = `
  <td class="cell-name">${f.name}</td>
  <td>${f.system_number}-${f.shelf}</td>
  <td>${clearanceBadgeHTML}</td>
  <td>${statusBadgeHTML}</td>
  <td>${f.added_by}</td>
  <td>${createdDisplay}</td>
  <td>${f.currently_held_by || '—'}</td>
  <td>${formatTimestamp(f.date_of_checkout)}</td>
  <td>${prevCheckoutDisp}</td>
  <td>${f.tag || ''}</td>
  <td>${f.note || ''}</td>
  <td class="col-actions">
    ${isAdmin
      ? (isDeleted
          ? `<button type="button" class="table-btn btn-restore" data-id="${f.id}">Restore</button>`
          : (isOut ? `—`
                   : `<button type="button" class="table-btn btn-delete" data-id="${f.id}">Delete</button>`))
      : "—"}
  </td>
  <td class="cell-move">
    ${isAdmin
      ? (isDeleted
          ? "—"
          : (isOut
              ? `<button type="button" class="table-btn btn-return" data-id="${f.id}">Return</button>`
              : `<button type="button" class="table-btn btn-checkout" data-id="${f.id}">Check Out</button>`))
      : "—"}
  </td>
  <td class="cell-edit">
    ${isAdmin ? `<button type="button" class="icon-btn btn-edit" data-id="${f.id}" title="Edit item">✎</button>` : "—"}
  </td>
`;
tableBody.appendChild(row);
  });

  // one-time delegated wiring for delete/restore (use the real function names)
  if (!tableBody._wiredDelegates) {
  tableBody.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      const id = Number(btn.dataset.id);
      if (btn.classList.contains('btn-delete'))  { e.stopPropagation(); deleteItem(id); return; }
      if (btn.classList.contains('btn-restore')) { e.stopPropagation(); restoreItem(id); return; }
      if (btn.classList.contains('btn-checkout')){ e.stopPropagation(); openCheckoutModal(id); return; }
      if (btn.classList.contains('btn-return'))  { e.stopPropagation(); openReturnModal(id); return; }
      if (btn.classList.contains('btn-edit'))    { openEditModal(id); return; }
      return; // unknown button type
    }

    // Not a button: treat as row click → open details
    const tr = e.target.closest('tr');
    if (!tr) return;
    const id = Number(tr.dataset.id);
    if (!Number.isFinite(id)) return;

    // Be tolerant to whichever detail fn exists in your codebase
    const openDetails =
      (typeof openFileDetails === 'function' && openFileDetails) ||
      (typeof openItemDetails === 'function' && openItemDetails);

    if (openDetails) openDetails(id);
    else console.warn('No details opener found (openFileDetails/openItemDetails).');
  });

  tableBody._wiredDelegates = true;
}

  await updateFooterStats();
  updatePagerUI(page, pageSize, qnorm ? view.length : total);
}


function openEditModal(id) {
  const f = fileCache?.[id];
  if (!f) {
    console.error('openEditModal: item not in fileCache', id, fileCache);
    return;
  }
  editingFileId = id; // <- required by your submit handler
  // populate fields (adjust IDs to yours)
  editNameEl.value      = f.name || '';
  editSizeEl.value      = f.size_label || '';
  editTypeEl.value      = f.type_label || '';
  editTagEl.value       = f.tag || '';
  editNoteEl.value      = f.note || '';
  editSystemNumberEl.value = f.system_number || '';
  editShelfEl.value        = f.shelf || '';
  editClearanceEl.value    = f.clearance_level ?? 1;

  showModal(editModalEl);  // or editModalEl.classList.add('is-open')
}
window.openEditModal = openEditModal;



function openOutboundModal(id){ moveMode='out'; moveItemId=id; openQtyModal("Outbound"); }
function openInboundModal(id){  moveMode='in';  moveItemId=id; openQtyModal("Inbound"); }

async function confirmMovement(){
  const qty = Number(document.getElementById('movement_qty').value);
  const note = (document.getElementById('movement_note').value||'').trim();
  if (!qty || qty <= 0) return alert("Enter a quantity > 0");
  const res = await fetch('/api/movements', {
    method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
    body: JSON.stringify({ item_id: moveItemId, movement_type: moveMode, quantity: qty, note })
  });
  if (!res.ok) return alert("Movement failed: " + await res.text());
  closeQtyModal(); await loadFiles();
}



// toDo
function openCheckoutModal(fileId) {
  modalMode = "checkout";
  modalFileId = fileId;

  modalTitleEl.textContent = "Check Out File";
  holderFieldEl.style.display = "block"; // we need holder name for checkout

  modalHolderInput.value = "";
  modalNoteInput.value = "";

  modalEl.style.display = "flex";
}

function openReturnModal(fileId) {
  modalMode = "return";
  modalFileId = fileId;

  modalTitleEl.textContent = "Return File";
  holderFieldEl.style.display = "none"; // you don't choose a new holder on return

  modalHolderInput.value = "";
  modalNoteInput.value = "";

  modalEl.style.display = "flex";
}

function closeModal() {
  modalEl.style.display = "none";
  modalMode = null;
  modalFileId = null;
  modalHolderInput.value = "";
  modalNoteInput.value = "";
}


modalCancelBtn.addEventListener('click', () => {
  closeModal();
});

modalConfirmBtn.addEventListener('click', async () => {
  if (!modalMode || !modalFileId) return alert("No item selected.");

  const f = fileCache[modalFileId];
  const available = Number(f?.quantity ?? 0);
  const qty = parseInt(qtyInput?.value || '0', 10);
  const noteVal = (modalNoteInput?.value || "").trim();

  if (!qty || qty < 1) return alert("Enter a quantity of at least 1.");

  if (modalMode === "checkout") {
    if (available < 1) return alert("No stock available to check out.");
    if (qty > available) return alert(`Max you can checkout is ${available}.`);
    const res = await fetch(`/api/movements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: 'include',
      body: JSON.stringify({ item_id: modalFileId, movement_type: "out", quantity: qty, note: noteVal })
    });
    if (!res.ok) return alert("Outbound failed: " + await res.text());
  } else if (modalMode === "return") {
    const res = await fetch(`/api/movements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: 'include',
      body: JSON.stringify({ item_id: modalFileId, movement_type: "in", quantity: qty, note: noteVal })
    });
    if (!res.ok) return alert("Inbound failed: " + await res.text());
  }

  closeModal();
  await loadFiles();
});
//end of todo

// checkbox toggling deleted view
if (showDeletedEl) showDeletedEl.addEventListener('change', loadFiles);

// search box input
if (searchInputEl) {
  searchInputEl.addEventListener('input', () => {
    loadFiles();
  });
}


function closeDetailsModal() {
  detailsModalEl.style.display = "none";
}

detailsCloseBtn.addEventListener('click', closeDetailsModal);

async function openItemDetails(itemId) {
  try {
    // 1) fetch the item
    const res = await fetch(`/api/items/${itemId}`, { credentials:'include' });
    if (!res.ok) {
      const msg = await res.text();
      alert("Failed to load item details: " + msg);
      return;
    }
    const f = await res.json();

    // 2) (optional) fetch recent movements, ignore if 404/not implemented
    let history = [];
    try {
      const h = await fetch(`/api/movements?item_id=${itemId}`, { credentials:'include' });
      if (h.ok) history = await h.json();
    } catch (_) {}

    // 3) fill top section (items schema)
    detailsTitleEl.textContent = `Item — ${f.name || ''}`;
    detailsIdEl.textContent = f.id ?? "";
    detailsNameEl.textContent = f.name ?? "";
    detailsTagEl.textContent = f.tag || "—";
    detailsNoteEl.textContent = f.note || "—";
    detailsLocEl.textContent = `${f.system_number || ''}-${f.shelf || ''}`;

    const cl = Number(f.clearance_level || 1);
    const badgeCls = `badge-clearance-${Math.min(Math.max(cl,1),4)}`;
    detailsClearanceEl.innerHTML = `<span class="badge ${badgeCls}">L${cl}</span>`;

    detailsAddedByEl.textContent = f.added_by ?? "";
    detailsCreatedEl.textContent = formatTimestamp(f.created_at);
    detailsModifiedEl.textContent = formatTimestamp(f.updated_at);

    // dimensions (HxWxD mm)
    const dim = [f.height_mm, f.width_mm, f.depth_mm].every(v => v == null)
      ? "—"
      : `${f.height_mm ?? '—'} × ${f.width_mm ?? '—'} × ${f.depth_mm ?? '—'} mm`;
    detailsSizeEl.textContent = dim;       // repurpose existing slot
    detailsTypeEl.textContent = "—";       // legacy field not in items

    // status: archived / in stock / out of stock
    const isDeleted = Number(f.is_deleted) === 1;
    const qty = Number(f.quantity ?? 0);
    const statusBadgeHTML = isDeleted
      ? `<span class="badge badge-status-archived">Archived</span>`
      : (qty > 0
          ? `<span class="badge badge-status-available">In stock</span>`
          : `<span class="badge badge-status-out">Out of stock</span>`);
    detailsStatusEl.innerHTML = statusBadgeHTML;

    // fields no longer used in items
    detailsHolderEl.textContent = "—";
    detailsCheckoutAtEl.textContent = "—";
    detailsPrevCheckoutEl.textContent = "—";

    // 4) history render (if movements exist)
    if (!history || history.length === 0) {
      detailsHistoryEl.innerHTML = `<div>No movement history.</div>`;
    } else {
      detailsHistoryEl.innerHTML = history.map(h => {
        const ts   = formatTimestamp(h.timestamp || h.checkout_at || h.return_at);
        const type = (h.movement_type || "").toUpperCase();
        const q    = Number(h.quantity ?? 0);
        const qtxt = q >= 0 ? `+${q}` : `${q}`;
        const who  = h.operator_name || h.admin_name || "—";
        const note = h.note ? `<div class="history-note">Note: ${h.note}</div>` : "";
        return `
          <div class="history-entry">
            <div class="history-line"><strong>${type}</strong> ${qtxt} at ${ts}</div>
            <div class="history-line">By: ${who}</div>
            ${note}
          </div>
        `;
      }).join("");
    }

    // 5) show modal
    detailsModalEl.style.display = "flex";

  } catch (err) {
    alert("Error fetching details: " + err.message);
  }
}




let editingFileId = null;

function openCheckoutModal(itemId) {
  modalMode = "checkout";
  modalFileId = itemId;

  const f = fileCache[itemId];
  const available = Number(f?.quantity ?? 0);

  modalTitleEl.textContent = "Check Out";
  holderFieldEl.style.display = "none";

  // quantity bounds: 1..available (min 1, disable confirm if 0)
  setQty(available > 0 ? 1 : 0);
  qtyInput.min = 1;
  qtyInput.max = Math.max(1, available);
  clampQtyTo(1, available);
  qtyHint.textContent = `Available: ${available}`;

  modalEl.style.display = "flex";
}

function openReturnModal(itemId) {
  modalMode = "return";
  modalFileId = itemId;

  const f = fileCache[itemId];
  const available = Number(f?.quantity ?? 0);

  modalTitleEl.textContent = "Check In";
  holderFieldEl.style.display = "none";

  // quantity bounds: 1..(no cap). We can show current stock for info.
  setQty(1);
  qtyInput.min = 1;
  qtyInput.removeAttribute('max');
  qtyHint.textContent = `Current stock: ${available}`;

  modalEl.style.display = "flex";
}

const qtyInput = document.getElementById('movement_qty');
const qtyHint  = document.getElementById('qtyHint');
const qtyDec   = document.getElementById('qtyDec');
const qtyInc   = document.getElementById('qtyInc');

function setQty(v) {
  const n = Math.max(1, parseInt(v || '1', 10));
  qtyInput.value = String(n);
}

function clampQtyTo(min, max) {
  const n = parseInt(qtyInput.value || '1', 10);
  qtyInput.value = String(Math.max(min, Math.min(max ?? Number.MAX_SAFE_INTEGER, n)));
}

if (qtyDec) qtyDec.addEventListener('click', () => setQty((parseInt(qtyInput.value||'1',10) - 1)));
if (qtyInc) qtyInc.addEventListener('click', () => setQty((parseInt(qtyInput.value||'1',10) + 1)));



function closeEditModal() {
  editFileModalEl.style.display = "none";
  editingFileId = null;
}

editFileCancelBtn.addEventListener("click", closeEditModal);

editFileForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!editingFileId) return alert("No item selected.");

  const payload = {
    name: editNameEl?.value.trim() || "",
    tag: editTagEl?.value.trim() || "",
    note: editNoteEl?.value.trim() || "",
    clearance_level: parseInt(editClearanceEl?.value, 10) || 1,
    location: {
      system_number: (editSystemEl?.value || "").trim() || null,
      shelf: (editShelfEl?.value || "").trim() || null,
    },
  };

  const res = await fetch(`/api/items/${editingFileId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!res.ok) return alert("Update failed: " + await res.text());

  closeEditModal();
  await loadFiles();
});


function activateManualTab() {
  tabManualBtn.classList.add('tab-btn-active');
  tabImportBtn.classList.remove('tab-btn-active');
  manualPanel.classList.add('tab-panel-active');
  importPanel.classList.remove('tab-panel-active');
}

function activateImportTab() {
  tabImportBtn.classList.add('tab-btn-active');
  tabManualBtn.classList.remove('tab-btn-active');
  importPanel.classList.add('tab-panel-active');
  manualPanel.classList.remove('tab-panel-active');
}

if (tabManualBtn && tabImportBtn) {
  tabManualBtn.addEventListener('click', activateManualTab);
  tabImportBtn.addEventListener('click', activateImportTab);
}

function openAddFileModal() {
  // whenever we open, we want to start in Manual tab (most common flow)
  activateManualTab();

  // reset manual form fields
  form.reset();

  // clear any leftover import state
  if (csvFileInput) csvFileInput.value = "";
  if (csvImportStatus) {
    csvImportStatus.textContent = "";
    csvImportStatus.innerHTML = "";
  }

  // show modal
  addFileModalEl.style.display = "flex";
}

function closeAddFileModal() {
  // hide modal
  addFileModalEl.style.display = "none";

  // reset import state so next open is "clean"
  if (csvFileInput) csvFileInput.value = "";
  if (csvImportStatus) {
    csvImportStatus.textContent = "";
    csvImportStatus.innerHTML = "";
  }

  // also make sure manual tab is active for the next open
  activateManualTab();
}

openAddFileBtn.addEventListener('click', () => {
  openAddFileModal();
});

addFileCancelBtn.addEventListener('click', () => {
  closeAddFileModal();
});

if (csvCancelBtn) {
  csvCancelBtn.addEventListener('click', () => {
    closeAddFileModal();
  });
}

if (csvImportBtn) {
  csvImportBtn.addEventListener('click', async () => {
    const file = csvFileInput.files && csvFileInput.files[0];
    if (!file) {
      csvImportStatus.innerHTML = "Please select a CSV or Excel file.";
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    csvImportStatus.innerHTML = "Uploading and importing...";

    try {
      const res = await fetch('/api/import_file', {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        const msg = await res.text();
        csvImportStatus.innerHTML = `Import failed: ${msg}`;
        return;
      }

      const result = await res.json();
      const { imported, failed, errors } = result;

      // Build user-facing summary
      let html = `<strong>Imported ${imported} record${imported === 1 ? '' : 's'}</strong>`;
      if (failed) {
        html += ` &nbsp;|&nbsp; ${failed} failed`;

        if (errors && errors.length) {
          html += `<div style="margin-top:0.5rem; font-size:0.8rem; line-height:1.4; color:#444;">`;
          html += `<div>Examples:</div>`;
          // show first 5 errors
          errors.slice(0,5).forEach(err => {
            const rowNum = err.row ?? "?";
            const reason = err.error ?? "Unknown error";
            html += `<div>Row ${rowNum}: ${reason}</div>`;
          });
          html += `</div>`;
        }
      }

      csvImportStatus.innerHTML = html;

      // Refresh table
      await loadFiles();

    } catch (err) {
      csvImportStatus.innerHTML = "Network error: " + err.message;
    }
  });
}

//export logic 
function openExportModal() {
  const role = currentUser?.role || "guest";
  const isadmin = role === "admin";

  // find the radio inputs
  const radioFiles      = document.querySelector('input[value="files"][name="exportType"]');
  const radioCheckouts  = document.querySelector('input[value="checkouts"][name="exportType"]');
  const radioAll        = document.querySelector('input[value="all"][name="exportType"]');

  if (!isadmin) {
    // viewer (or guest if they somehow got here):
    // - they can only download "files"
    if (radioFiles) {
      radioFiles.disabled = false;
      radioFiles.checked = true;
    }
    if (radioCheckouts) {
      radioCheckouts.disabled = true;
      radioCheckouts.checked = false;
    }
    if (radioAll) {
      radioAll.disabled = true;
      radioAll.checked = false;
    }
  } else {
    // admin: enable all
    if (radioFiles)     radioFiles.disabled = false;
    if (radioCheckouts) radioCheckouts.disabled = false;
    if (radioAll)       radioAll.disabled = false;
  }

  exportModalEl.style.display = "flex";
}


function closeExportModal() {
  exportModalEl.style.display = "none";
}

if (exportOpenBtn) {
  exportOpenBtn.addEventListener('click', openExportModal);
}

if (exportCancelBtn) {
  exportCancelBtn.addEventListener('click', closeExportModal);
}

if (exportConfirmBtn) {
  exportConfirmBtn.addEventListener('click', async () => {
    try {
      // get which radio is selected
      const choice = document.querySelector('input[name="exportType"]:checked');
      const exportType = choice ? choice.value : "all";

      // GET /api/export?type=...
      const res = await fetch(`/api/export?type=${encodeURIComponent(exportType)}`, {
        method: 'GET'
      });

      if (!res.ok) {
        const msg = await res.text();
        alert("Export failed: " + msg);
        return;
      }

      // Get blob
      const blob = await res.blob();

      // Decide filename based on type
      let filename;
      if (exportType === "files") {
        filename = "files_export.csv";
      } else if (exportType === "checkouts") {
        filename = "checkouts_export.csv";
      } else {
        filename = "fms_backup.zip";
      }

      // Trigger download
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      // Close modal after success
      closeExportModal();

    } catch (err) {
      alert("Network error during export: " + err.message);
    }
  });
}

function updateSortIndicators() {
  document.querySelectorAll('th.sortable').forEach(th => {
    const span = th.querySelector('.sort-indicator');
    const field = th.getAttribute('data-sort');

    if (!span) return;

    if (field === currentSort) {
      span.textContent = currentDir === "asc" ? "▲" : "▼";
      span.style.opacity = "0.6";
      span.style.fontSize = "0.7rem";
      span.style.marginLeft = "0.25rem";
    } else {
      span.textContent = "";
    }
  });
}

document.querySelectorAll('th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const sortField = th.getAttribute('data-sort');
    if (currentSort === sortField) {
      currentDir = currentDir === 'asc' ? 'desc' : 'asc';
    } else {
      currentSort = sortField;
      currentDir = 'desc';
    }
    loadFiles();
    updateSortIndicators();
  });
});


// app.js — before first loadFiles()

(function applyLocalPrefs() {
  try {
    const pageSizePref = localStorage.getItem('FMS_PREF_PAGE_SIZE');
    if (pageSizePref) {
      // If you want PAGE_SIZE to be dynamic, turn const into let at top
      if (typeof PAGE_SIZE !== "undefined") {
        // Replace only if numeric and sane
        const n = parseInt(pageSizePref, 10);
        if (Number.isFinite(n) && n > 0 && n <= 500) {
          // You declared PAGE_SIZE as const; change it to let to allow this:
          window.PAGE_SIZE = n;
        }
      }
    }
    const statusPref = localStorage.getItem('FMS_PREF_STATUS');
    const showDelPref = localStorage.getItem('FMS_PREF_SHOW_DELETED');

    if (statusPref !== null) {
      const statusFilterEl = document.getElementById('statusFilter');
      if (statusFilterEl) statusFilterEl.value = statusPref;
    }
    if (showDelPref !== null) {
      const showDeletedEl = document.getElementById('showDeleted');
      if (showDeletedEl) showDeletedEl.checked = (showDelPref === 'true');
    }
  } catch (_) {}
})();

function readDefaultStatusFilter() {
  return localStorage.getItem('table.filter.status') || ''; // '', 'available', 'out'
}
function readDefaultShowDeleted() {
  return localStorage.getItem('table.showDeleted.default') === 'false' ? false : true;
}


//IIFE
(async () => {
  await fetchSession();        // if not logged in, currentUser stays null, role UI becomes guest
  updateHeaderUserInfo();      // will just be blank for guest

  if (!currentUser) {
    // guest mode
    hideSessionModal();        // <- important change (don't force login modal)
  } else {
    hideSessionModal();
  }

  await loadFiles();
  updateSortIndicators();
})();

// Deep-link helpers for home.html
(function handleDeepLink() {
  const hash = (window.location.hash || "").toLowerCase();
  if (hash === "#guest") {
    const guestBtn = document.getElementById('guestBtn');
    if (guestBtn) guestBtn.click();
  } else if (hash === "#signin") {
    const showModal = (typeof showSessionModal === "function");
    if (showModal) showSessionModal();
  }
})();
