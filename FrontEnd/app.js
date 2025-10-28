let fileCache = {};

let currentSort = "created_at";
let currentDir = "desc";

const addFileModalEl = document.getElementById('addFileModal');
const openAddFileBtn = document.getElementById('openAddFileBtn');
const addFileCancelBtn = document.getElementById('addFileCancelBtn');

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



//time management
function formatTimestamp(ts) {
  //empty return
  if (!ts) return "—";

  let normalized = ts.trim();
  if (normalized.includes(" ")) {
    // "2025-10-27 14:22:05" -> "2025-10-27T14:22:05"
    normalized = normalized.replace(" ", "T");
  }

  if (!/Z$/.test(normalized) && !/[+-]\d\d:\d\d$/.test(normalized)) {
    normalized = normalized + "Z";
  }

  const d = new Date(normalized);
  if (isNaN(d.getTime())) {
    // fallback: if parsing failed, just show raw
    return ts;
  }

  const day = d.getDate(); // 1-31
  const monthNamesShort = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const month = monthNamesShort[d.getMonth()];
  const year = d.getFullYear();

  // Hours/minutes zero-padded
  let hours = d.getHours();
  let minutes = d.getMinutes();
  if (hours < 10) {hours = "0" + hours; time="AM"}
  if(hours>12){hours=hours-12; time="PM"}
  if (minutes < 10) minutes = "0" + minutes;

  return `${day} ${month} ${year}, ${hours}:${minutes} ${time}`;
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



// fetch and display 
async function loadFiles() {
  const includeDeleted = !!(showDeletedEl && showDeletedEl.checked);
  const q = searchInputEl ? searchInputEl.value.trim() : "";
  const statusVal = statusFilterEl ? statusFilterEl.value : "";

  const query = new URLSearchParams({
    include_deleted: includeDeleted,
    q: q,
    sort: currentSort,
    dir: currentDir
  });

  if (statusVal) {
    query.set("status", statusVal);
  }

  try {
    const res = await fetch(`/api/files?${query.toString()}`);
    if (!res.ok) throw new Error(await res.text());
    const files = await res.json();

    tableBody.innerHTML = '';
    fileCache = {};
    files.forEach(f => {
    fileCache[f.id] = f;
    const isDeleted = Number(f.is_deleted) === 1;
    const isOut = !!f.currently_held_by;

    let statusBadgeHTML = "";
    if (isDeleted) {
      statusBadgeHTML = `<span class="badge badge-status-archived">Archived</span>`;
    } else if (isOut) {
      statusBadgeHTML = `<span class="badge badge-status-out">Checked out</span>`;
    } else {
      statusBadgeHTML = `<span class="badge badge-status-available">Available</span>`;
    }

    const clearanceLevel = f.clearance_level;
    let clearanceBadgeClass = "badge-clearance";
    if (clearanceLevel === 1) clearanceBadgeClass = "badge-clearance-1";
    else if (clearanceLevel === 2) clearanceBadgeClass = "badge-clearance-2";
    else if (clearanceLevel === 3) clearanceBadgeClass = "badge-clearance-3";
    else if (clearanceLevel === 4) clearanceBadgeClass = "badge-clearance-4";

    const clearanceBadgeHTML = `<span class="badge ${clearanceBadgeClass}">L${clearanceLevel}</span>`;


    const muted = isDeleted
      ? 'style="opacity:.5;text-decoration:line-through;"'
      : '';

    const checkoutButtons = (() => {
  if (isDeleted) {
    return "—";
  }
  if (isOut) {
    return `<button class="table-btn btn-checkout" onclick="openReturnModal(${f.id})">Return</button>`;
  } else {
    return `<button class="table-btn btn-checkout" onclick="openCheckoutModal(${f.id})">Check Out</button>`;
  }
})();

const lifecycleButtons = (() => {
  if (isDeleted) {
    return `<button class="table-btn btn-restore" onclick="restoreFile(${f.id})">Restore</button>`;
  } else {
    return `<button class="table-btn btn-delete" onclick="deleteFile(${f.id})">Delete</button>`;
  }
})();


    const createdDisplay   = formatTimestamp(f.created_at);
    const checkoutDisplay  = formatTimestamp(f.date_of_checkout);
    const prevCheckoutDisp = formatTimestamp(f.date_of_previous_checkout);
    const editButtonHTML = `
      <button class="icon-btn" onclick="openEditModal(${f.id}); event.stopPropagation();"
        title="Edit file">
        ✎
      </button>
    `;

    const row = document.createElement('tr');

    row.addEventListener('click', (e) => {
      // if clicked a button, don't open details
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
      <td>${checkoutDisplay}</td>
      <td>${prevCheckoutDisp}</td>
      <td>${f.tag || ''}</td>
      <td>${f.note || ''}</td>

      <td class="cell-actions">${lifecycleButtons}</td>
      <td class="cell-move">${checkoutButtons}</td>
      <td class="cell-edit">${editButtonHTML}</td>
    `;
    tableBody.appendChild(row);
    });

    const allRes = await fetch(`/api/files?include_deleted=true`);
    const allFiles = await allRes.json();
    const activeCount = allFiles.filter(f => Number(f.is_deleted) === 0).length;
    const archivedCount = allFiles.filter(f => Number(f.is_deleted) === 1).length;
    const totalCount = allFiles.length;

    const activeLabel =
      `${activeCount} active file${activeCount === 1 ? '' : 's'}`;
    const archivedLabel =
      `${archivedCount} archived`;
    const totalLabel =
      `${totalCount} total`;

    document.getElementById('footerActiveCount').textContent = activeLabel;
    document.getElementById('footerArchivedCount').textContent = archivedLabel;
    document.getElementById('footerTotalCount').textContent = totalLabel;

    document.getElementById('tableFooter').classList.add('show');

  } catch (err) {
    console.error(err);
    alert('Failed to load files: ' + err.message);
  }
  
}

    if (statusFilterEl) {
      statusFilterEl.addEventListener('change', () => {
        loadFiles();
      });
}

async function deleteFile(id) {
  if (!confirm("Soft-delete this file? It can be restored later.")) return;
  const res = await fetch(`/api/files/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const msg = await res.text();
    alert("Delete failed: " + msg);
    return;
  }
  await loadFiles();
}


async function restoreFile(id) {
  const res = await fetch(`/api/files/${id}/restore`, { method: "PATCH" });
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
      // Build payload for checkout
      const holderName = modalHolderInput.value.trim();
      const noteVal = modalNoteInput.value.trim();

      if (!holderName) {
        alert("Holder name is required to check out.");
        return;
      }

      const res = await fetch(`/api/files/${modalFileId}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          holder_name: holderName,
          note: noteVal,
          operator_name: "operator"
        })
      });

      if (!res.ok) {
        const msg = await res.text();
        alert("Checkout failed: " + msg);
        return;
      }

    } else if (modalMode === "return") {
      // Build payload for return
      const noteVal = modalNoteInput.value.trim();

      const res = await fetch(`/api/files/${modalFileId}/return`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          note: noteVal,
          operator_name: "operator"
        })
      });

      if (!res.ok) {
        const msg = await res.text();
        alert("Return failed: " + msg);
        return;
      }
    }

    // success path
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

loadFiles();

