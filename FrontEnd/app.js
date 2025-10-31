(async function guardSessionOrRedirect() {
  try {
    const res = await fetch('/api/session/me', { credentials: 'include' });
    if (!res.ok) {
      // no valid session -> go to homepage
      window.location.replace('homepage.html');
      return;
    }
  } catch (e) {
    // network or server issue -> safest to send user to homepage
    window.location.replace('homepage.html');
    return;
  }
})();

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
const sessionTabOperator   = document.getElementById('sessionTabOperator');
const sessionTabViewer     = document.getElementById('sessionTabViewer');
const sessionPanelOperator = document.getElementById('sessionPanelOperator');
const sessionPanelViewer   = document.getElementById('sessionPanelViewer');

const opEmailEl    = document.getElementById('opEmail');
const opPasswordEl = document.getElementById('opPassword');
const opFormEl     = document.getElementById('sessionOperatorForm');
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
function activateOperatorTab() {
  sessionTabOperator.classList.add('session-tab-active');
  sessionTabViewer.classList.remove('session-tab-active');

  sessionPanelOperator.classList.add('session-panel-active');
  sessionPanelViewer.classList.remove('session-panel-active');
}
function activateViewerTab() {
  sessionTabViewer.classList.add('session-tab-active');
  sessionTabOperator.classList.remove('session-tab-active');

  sessionPanelViewer.classList.add('session-panel-active');
  sessionPanelOperator.classList.remove('session-panel-active');
}

sessionTabOperator.addEventListener('click', activateOperatorTab);
sessionTabViewer.addEventListener('click', activateViewerTab);

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
// login submit (operator)
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
  logoutBtn.addEventListener('click', async () => {
    try {
      await fetch('/api/session/logout', {
        method: 'POST',
        credentials: 'include'
      });
    } catch (err) {
      // ignore network fail
    }
    currentUser = null;
    applyRoleUI();
    updateHeaderUserInfo();
    showSessionModal();
    await loadFiles();
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
  const isOperator = role === "operator";
  const isViewer = role === "viewer";
  const isGuest = role === "guest";

  // --- Add File button / Import tab ---
  if (openAddFileBtn) {
    if (isOperator) {
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
  // you can hide the tab for non-operators:
  if (tabImportBtn) {
    tabImportBtn.style.display = isOperator ? "" : "none";
  }

  // --- Show Deleted checkbox ---
  if (showDeletedEl) {
    if (isOperator) {
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
  // - operator: full export menu

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
}



//end auth



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
const editFileModalEl = document.getElementById('editFileModal');
const editFileForm = document.getElementById('editFileForm');

const editNameEl = document.getElementById('edit_name');
const editSizeEl = document.getElementById('edit_size_label');
const editTypeEl = document.getElementById('edit_type_label');
const editTagEl = document.getElementById('edit_tag');
const editNoteEl = document.getElementById('edit_note');
const editSystemEl = document.getElementById('edit_system_number');
const editShelfEl = document.getElementById('edit_shelf');
const editClearanceEl = document.getElementById('edit_clearance_level');

const editFileCancelBtn = document.getElementById('editFileCancelBtn');

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
    const res = await fetch(`/api/files/stats`, {
      credentials: 'include',
    });

    if (!res.ok) {
      console.warn("footer stats failed status", res.status);
      return;
    }

    const stats = await res.json();
    // expected from backend:
    // {
    //   active_count: number,
    //   archived_count: number | null,
    //   total_count: number
    // }

    const activeCount    = stats.active_count ?? 0;
    const archivedCount  = stats.archived_count; // may be null for viewer/guest
    const totalCount     = stats.total_count ?? activeCount;

    const activeLabel =
      `${activeCount} active file${activeCount === 1 ? '' : 's'}`;

    // if viewer/guest we intentionally don't show archived
    const archivedLabel = (archivedCount === null || archivedCount === undefined)
      ? ""
      : `${archivedCount} archived`;

    const totalLabel =
      `${totalCount} total`;

    document.getElementById('footerActiveCount').textContent = activeLabel;

    // Gracefully hide the bullet + text if archived is hidden
    const archivedEl = document.getElementById('footerArchivedCount');
    const bullets = document.querySelectorAll('.footer-separator');
    if (archivedLabel === "") {
      if (archivedEl) archivedEl.textContent = "";
      // hide the middle bullet(s) if you want to be tidy for viewers
      // simplest: just blank them, don't remove nodes
      bullets.forEach(b => {
        if (b.previousElementSibling?.id === 'footerActiveCount') {
          b.textContent = "";
        }
      });
    } else {
      if (archivedEl) archivedEl.textContent = archivedLabel;
      bullets.forEach(b => {
        if (b.previousElementSibling?.id === 'footerActiveCount') {
          b.textContent = "•";
        }
      });
    }

    document.getElementById('footerTotalCount').textContent = totalLabel;

    document.getElementById('tableFooter').classList.add('show');
  } catch (err) {
    console.warn("footer stats failed", err);
  }
}


// handle submission
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const payload = {
    name: document.getElementById('name').value.trim(),
    size_label: document.getElementById('size_label').value.trim(),
    type_label: document.getElementById('type_label').value.trim(),
    tag: document.getElementById('tag').value.trim(),
    note: document.getElementById('note').value.trim(),
    system_number: document.getElementById('system_number').value.trim(),
    shelf: document.getElementById('shelf').value.trim(),
    clearance_level: parseInt(document.getElementById('clearance_level').value),
    added_by: document.getElementById('added_by').value.trim() || "operator"
  };

  try {
    const res = await fetch('/api/add_file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      alert('File added successfully!');
      form.reset();
      closeAddFileModal();
      loadFiles();
    } else {
      const msg = await res.text();
      alert('Error: ' + msg);
    }
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

document.querySelectorAll('th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const sortField = th.getAttribute('data-sort');

    if (currentSort === sortField) {
      currentDir = currentDir === "asc" ? "desc" : "asc";
    } else {
      currentSort = sortField;
      // default direction depends on column
      currentDir = (sortField === "date_of_previous_checkout") ? "asc" : "desc";
    }

    loadFiles();
    updateSortIndicators();
  });
});


// fetch and display 
async function loadFiles() {
  const includeDeleted = !!(showDeletedEl && showDeletedEl.checked);
  const q = searchInputEl ? searchInputEl.value.trim() : "";
  const statusVal = statusFilterEl ? statusFilterEl.value : "";

  const role = currentUser?.role || "guest";
  const isOperator = role === "operator";

  const query = new URLSearchParams({
    include_deleted: includeDeleted ? "true" : "false",
    q: q,
    sort: currentSort,
    dir: currentDir,
    page: String(currentPage),
    page_size: String(PAGE_SIZE),
  });

  if (statusVal) {
    query.set("status", statusVal);
  }

  let data;
  try {
    const res = await fetch(`/api/files?${query.toString()}`, {
      credentials: 'include',
    });
    if (!res.ok) throw new Error(await res.text());

    // IMPORTANT: after pagination backend, this is now an object
    data = await res.json();
    // expected: { items: [...], page, page_size, total }
  } catch (err) {
    console.error(err);
    alert('Failed to load files: ' + err.message);
    return;
  }

  // fallbacks in case backend doesn't send something
  const items     = data.items     || [];
  const page      = data.page      || currentPage;
  const pageSize  = data.page_size || PAGE_SIZE;
  const total     = data.total     ?? items.length;

  // cache + render rows
  tableBody.innerHTML = '';
  fileCache = {};

  items.forEach(f => {
    fileCache[f.id] = f;

    const isDeleted = Number(f.is_deleted) === 1;
    const isOut = !!f.currently_held_by;

    // status badge
    let statusBadgeHTML = "";
    if (isDeleted) {
      statusBadgeHTML = `<span class="badge badge-status-archived">Archived</span>`;
    } else if (isOut) {
      statusBadgeHTML = `<span class="badge badge-status-out">Checked out</span>`;
    } else {
      statusBadgeHTML = `<span class="badge badge-status-available">Available</span>`;
    }

    // clearance badge
    const clearanceLevel = f.clearance_level;
    let clearanceBadgeClass = "badge-clearance";
    if (clearanceLevel === 1) clearanceBadgeClass = "badge-clearance-1";
    else if (clearanceLevel === 2) clearanceBadgeClass = "badge-clearance-2";
    else if (clearanceLevel === 3) clearanceBadgeClass = "badge-clearance-3";
    else if (clearanceLevel === 4) clearanceBadgeClass = "badge-clearance-4";

    const clearanceBadgeHTML =
      `<span class="badge ${clearanceBadgeClass}">L${clearanceLevel}</span>`;

    const createdDisplay = formatTimestamp(f.created_at);

    let prevCheckoutDisp = "—"; // default = nothing to show

    if (f.currently_held_by) {
      // Item is currently OUT.
      // We expect to have f.date_of_checkout for this active movement.
      if (f.date_of_checkout) {
        prevCheckoutDisp = `
          <span style="color:#a11; font-weight:500;">↗</span>
          ${formatTimestamp(f.date_of_checkout)}
        `;
      }
    } else {
      // Item is currently IN.ß
      // Only show green arrow if we actually have a recorded return.
      // Depending on what you're returning from the API, use either:
      //   f.last_return_at   (if you expose "last time it was returned")
      // OR
      //   f.last_movement_ts (if you use the CASE expression)
      const lastReturnTs = f.last_return_at || f.last_movement_ts;

      if (lastReturnTs) {
        prevCheckoutDisp = `
          <span style="color:#145d2e; font-weight:500;">↘</span>
          ${formatTimestamp(lastReturnTs)}
        `;
      }
    }
    // operator-only actions
    const checkoutButtons = (() => {
      if (!isOperator) {
        return "—";
      }
      if (isDeleted) {
        return "—";
      }
      if (isOut) {
        return `<button class="table-btn btn-return" onclick="openReturnModal(${f.id})">Return</button>`;
      } else {
        return `<button class="table-btn btn-checkout" onclick="openCheckoutModal(${f.id})">Check Out</button>`;
      }
    })();

    const lifecycleButtons = (() => {
      if (!isOperator) {
        return "—";
      }
      if (isDeleted) {
        return `<button class="table-btn btn-restore" onclick="restoreFile(${f.id})">Restore</button>`;
      } else {
        return `<button class="table-btn btn-delete" onclick="deleteFile(${f.id})">Delete</button>`;
      }
    })();

    const editButtonHTML = (() => {
      if (!isOperator) {
        return "—";
      }
      return `
        <button class="icon-btn" onclick="openEditModal(${f.id}); event.stopPropagation();"
          title="Edit file">
          ✎
        </button>
      `;
    })();

    const row = document.createElement('tr');

    row.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      openFileDetails(f.id);
    });

    row.classList.add('row-clickable');
    if (isDeleted) {
      row.classList.add('row-deleted');
    }

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
      <td class="col-actions">${lifecycleButtons}</td>
      <td class="cell-move">${checkoutButtons}</td>
      <td class="cell-edit">${editButtonHTML}</td>
    `;

    tableBody.appendChild(row);
  });

  // update footer stats
  await updateFooterStats();

  // update pagination UI
  updatePagerUI(page, pageSize, total);
}

async function deleteFile(id) {
  if (!confirm("Soft-delete this file? It can be restored later.")) return;
  const res = await fetch(`/api/files/${id}`, {
    method: "DELETE",
    credentials: 'include',
  });
  if (!res.ok) {
    const msg = await res.text();
    alert("Delete failed: " + msg);
    return;
  }
  await loadFiles();
}



async function restoreFile(id) {
  const res = await fetch(`/api/files/${id}/restore`, {
    method: "PATCH",
    credentials: 'include',
  });
  if (!res.ok) {
    const msg = await res.text();
    alert("Restore failed: " + msg);
    return;
  }
  await loadFiles();
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
  if (!modalMode || !modalFileId) {
    alert("Something went wrong. No file selected.");
    return;
  }

  try {
    if (modalMode === "checkout") {
      const holderName = modalHolderInput.value.trim();
      const noteVal = modalNoteInput.value.trim();

      if (!holderName) {
        alert("Holder name is required to check out.");
        return;
      }

      const res = await fetch(`/api/files/${modalFileId}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: 'include',
        body: JSON.stringify({
          holder_name: holderName,
          note: noteVal
        })
      });

      if (!res.ok) {
        const msg = await res.text();
        alert("Checkout failed: " + msg);
        return;
      }

    } else if (modalMode === "return") {
      const noteVal = modalNoteInput.value.trim();

      const res = await fetch(`/api/files/${modalFileId}/return`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
           noteVal
        )
      });

      if (!res.ok) {
        const msg = await res.text();
        alert("Return failed: " + msg);
        return;
      }
    }

    closeModal();
    await loadFiles();

  } catch (err) {
    alert("Request failed: " + err.message);
  }
});

//end of todo

// checkbox toggling deleted view
if (showDeletedEl) {
  showDeletedEl.addEventListener('change', loadFiles);
}

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

async function openFileDetails(fileId) {
  try {
    const res = await fetch(`/api/files/${fileId}/details`);
    if (!res.ok) {
      const msg = await res.text();
      alert("Failed to load file details: " + msg);
      return;
    }

    const data = await res.json();
    const f = data.file;
    const history = data.history || [];

    // Fill top section
    detailsTitleEl.textContent = `File Details — ${f.name || ''}`;
    detailsIdEl.textContent = f.id ?? "";
    detailsNameEl.textContent = f.name ?? "";
    detailsSizeEl.textContent = f.size_label || "—";
    detailsTypeEl.textContent = f.type_label || "—";
    detailsTagEl.textContent = f.tag || "—";
    detailsNoteEl.textContent = f.note || "—";
    detailsLocEl.textContent = `${f.system_number || ''}-${f.shelf || ''}`;
    
    const cl = f.clearance_level;
    let clearanceBadgeClass = "badge-clearance";
    if (cl === 1) clearanceBadgeClass = "badge-clearance-1";
    else if (cl === 2) clearanceBadgeClass = "badge-clearance-2";
    else if (cl === 3) clearanceBadgeClass = "badge-clearance-3";
    else if (cl === 4) clearanceBadgeClass = "badge-clearance-4";

    detailsClearanceEl.innerHTML = `<span class="badge ${clearanceBadgeClass}">L${cl}</span>`;

    detailsAddedByEl.textContent = f.added_by ?? "";
    detailsCreatedEl.textContent = formatTimestamp(f.created_at);
    detailsModifiedEl.textContent = formatTimestamp(f.updated_at);
    //detailsUpdatedAtEl.textContent = formatTimestamp();
    detailsCheckoutAtEl.textContent = formatTimestamp(f.date_of_checkout);
    detailsPrevCheckoutEl.textContent = formatTimestamp(f.date_of_previous_checkout); 
    

    detailsHolderEl.textContent = f.currently_held_by || "—";


    // Status logic: deleted / out / available
    let statusBadgeHTML = "";
    if (Number(f.is_deleted) === 1) {
      statusBadgeHTML = `<span class="badge badge-status-archived">Archived</span>`;
    } else if (f.currently_held_by) {
      statusBadgeHTML = `<span class="badge badge-status-out">Checked out</span>`;
    } else {
      statusBadgeHTML = `<span class="badge badge-status-available">Available</span>`;
    }
    detailsStatusEl.innerHTML = statusBadgeHTML;


    // Fill history block
    if (history.length === 0) {
      detailsHistoryEl.innerHTML = `<div>No movement history.</div>`;
    } else {
      detailsHistoryEl.innerHTML = history.map(h => {
      const checkoutTime = formatTimestamp(h.checkout_at);
      const returnTime   = formatTimestamp(h.return_at);
      const who          = h.holder_name || "—";
      const op           = h.operator_name || "";
      const noteText     = h.note
        ? `<div class="history-note">Note: ${h.note}</div>`
        : "";

      return `
        <div class="history-entry">
          <div class="history-line"><strong>${who}</strong> checked out at ${checkoutTime}</div>
          <div class="history-line">Returned: ${returnTime}</div>
          <div class="history-line">Logged by: ${op}</div>
          ${noteText}
        </div>
      `;
    }).join("");
    }

    // Show modal
    detailsModalEl.style.display = "flex";

  } catch (err) {
    alert("Error fetching details: " + err.message);
  }
}

let editingFileId = null;

function openEditModal(fileId) {
  const f = fileCache[fileId];
  if (!f) {
    alert("Could not load file data.");
    return;
  }

  editingFileId = fileId;

  // Prefill fields
  editNameEl.value = f.name || "";
  editSizeEl.value = f.size_label || "";
  editTypeEl.value = f.type_label || "";
  editTagEl.value = f.tag || "";
  editNoteEl.value = f.note || "";
  editSystemEl.value = f.system_number || "";
  editShelfEl.value = f.shelf || "";
  editClearanceEl.value = f.clearance_level || "1";

  editFileModalEl.style.display = "flex";
}

function closeEditModal() {
  editFileModalEl.style.display = "none";
  editingFileId = null;
}

editFileCancelBtn.addEventListener("click", closeEditModal);

editFileForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!editingFileId) {
    alert("No file selected.");
    return;
  }

  const payload = {
    name: editNameEl.value.trim(),
    size_label: editSizeEl.value.trim(),
    type_label: editTypeEl.value.trim(),
    tag: editTagEl.value.trim(),
    note: editNoteEl.value.trim(),
    system_number: editSystemEl.value.trim(),
    shelf: editShelfEl.value.trim(),
    clearance_level: parseInt(editClearanceEl.value, 10)
  };

  try {
    const res = await fetch(`/api/files/${editingFileId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: 'include',
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const msg = await res.text();
      alert("Update failed: " + msg);
      return;
    }

    closeEditModal();
    await loadFiles();
  } catch (err) {
    alert("Network error: " + err.message);
  }
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
  const isOperator = role === "operator";

  // find the radio inputs
  const radioFiles      = document.querySelector('input[value="files"][name="exportType"]');
  const radioCheckouts  = document.querySelector('input[value="checkouts"][name="exportType"]');
  const radioAll        = document.querySelector('input[value="all"][name="exportType"]');

  if (!isOperator) {
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
    // operator: enable all
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
      // toggle direction
      currentDir = currentDir === "asc" ? "desc" : "asc";
    } else {
      // switch to new sort field, default direction
      currentSort = sortField;
      currentDir = "asc";
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
