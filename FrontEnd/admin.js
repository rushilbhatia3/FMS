// admin.js
import { core } from "./core.js";

const Admin = (() => {
  const el = {
    adminSection: core.$("#adminSection"),
    systemForm: core.$("#systemForm"),
    systemsTable: core.$("#systemsTable"),
    shelfForm: core.$("#shelfForm"),
    shelvesTable: core.$("#shelvesTable"),
    userForm: core.$("#userForm"),
    usersTable: core.$("#usersTable"),
  };

  async function init() {
    // Only render if admin
    if (!core.state.currentUser || core.state.currentUser.role !== "admin") return;

    await Promise.all([
      renderSystems(),
      renderShelves(),
      renderUsers(),
    ]);

    bindForms();
  }

  function bindForms() {
    el.systemForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const d = core.serializeForm(el.systemForm);
        if (d.id) {
          await core.api.put(`/api/systems/${Number(d.id)}`, { code: d.code, notes: d.notes || null });
        } else {
          await core.api.post("/api/systems", { code: d.code, notes: d.notes || null });
        }
        await renderSystems();
        core.toast("System saved", "success");
      } catch (e2) { core.toast(e2.message, "error"); }
    });

    el.shelfForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const d = core.serializeForm(el.shelfForm);
        const payload = {
          system_id: Number(d.system_id),
          label: d.label,
          length_mm: Number(d.length_mm),
          width_mm: Number(d.width_mm),
          height_mm: Number(d.height_mm),
          ordinal: Number(d.ordinal || 1),
        };
        if (d.id) await core.api.put(`/api/shelves/${Number(d.id)}`, payload);
        else await core.api.post("/api/shelves", payload);
        await renderShelves();
        core.toast("Shelf saved", "success");
      } catch (e2) { core.toast(e2.message, "error"); }
    });

    el.userForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const d = core.serializeForm(el.userForm);
        const payload = {
          email: d.email,
          name: d.name,
          role: d.role,
          password: d.password,
          max_clearance_level: d.max_clearance_level === "" ? null : Number(d.max_clearance_level),
        };
        await core.api.post("/api/users", payload);
        await renderUsers();
        core.toast("User created", "success");
      } catch (e2) { core.toast(e2.message, "error"); }
    });
  }

  async function renderSystems() {
    const rows = await core.api.get("/api/systems", { include_deleted: "true" });
    el.systemsTable.innerHTML = rows.map(r => `
      <tr data-id="${r.id}">
        <td>${r.code}</td>
        <td>${r.notes ?? ""}</td>
        <td>${r.is_deleted ? "Deleted" : "Active"}</td>
        <td>
          <button class="edit">Edit</button>
          ${r.is_deleted
            ? `<button class="restore">Restore</button>`
            : `<button class="delete">Delete</button>`
          }
        </td>
      </tr>
    `).join("");
    el.systemsTable.querySelectorAll(".edit").forEach(btn => btn.addEventListener("click", () => fillSystemForm(btn)));
    el.systemsTable.querySelectorAll(".delete").forEach(btn => btn.addEventListener("click", () => softDeleteSystem(btn)));
    el.systemsTable.querySelectorAll(".restore").forEach(btn => btn.addEventListener("click", () => restoreSystem(btn)));
  }

  function fillSystemForm(btn) {
    const tr = btn.closest("tr");
    const id = Number(tr.dataset.id);
    const tds = tr.querySelectorAll("td");
    el.systemForm.innerHTML = `
      <input type="hidden" name="id" value="${id}" />
      <input name="code" placeholder="Code" value="${tds[0].textContent.trim()}" />
      <input name="notes" placeholder="Notes" value="${tds[1].textContent.trim()}" />
      <button type="submit">Save</button>
    `;
  }

  async function softDeleteSystem(btn) {
    const id = Number(btn.closest("tr").dataset.id);
    await core.api.del(`/api/systems/${id}`);
    await renderSystems();
  }
  async function restoreSystem(btn) {
    const id = Number(btn.closest("tr").dataset.id);
    await core.api.post(`/api/systems/${id}/restore`, {});
    await renderSystems();
  }

  async function renderShelves() {
    // For demo, list all shelves (you can filter by system id if desired)
    const shelves = await core.api.get("/api/shelves", { include_deleted: "true" });
    el.shelvesTable.innerHTML = shelves.map(s => `
      <tr data-id="${s.id}">
        <td>${s.system_id}</td>
        <td>${s.label}</td>
        <td>${s.length_mm}×${s.width_mm}×${s.height_mm}</td>
        <td>${s.ordinal}</td>
        <td>${s.is_deleted ? "Deleted" : "Active"}</td>
        <td>
          <button class="edit">Edit</button>
          ${s.is_deleted ? `<button class="restore">Restore</button>` : `<button class="delete">Delete</button>`}
        </td>
      </tr>
    `).join("");
    el.shelvesTable.querySelectorAll(".edit").forEach(btn => btn.addEventListener("click", () => fillShelfForm(btn)));
    el.shelvesTable.querySelectorAll(".delete").forEach(btn => btn.addEventListener("click", () => softDeleteShelf(btn)));
    el.shelvesTable.querySelectorAll(".restore").forEach(btn => btn.addEventListener("click", () => restoreShelf(btn)));
  }

  function fillShelfForm(btn) {
    const tr = btn.closest("tr");
    const id = Number(tr.dataset.id);
    const tds = tr.querySelectorAll("td");
    el.shelfForm.innerHTML = `
      <input type="hidden" name="id" value="${id}" />
      <input name="system_id" placeholder="System ID" value="${tds[0].textContent.trim()}" />
      <input name="label" placeholder="Label" value="${tds[1].textContent.trim()}" />
      <input name="length_mm" placeholder="Length mm" value="${tds[2].textContent.split('×')[0]}" />
      <input name="width_mm"  placeholder="Width mm"  value="${tds[2].textContent.split('×')[1]}" />
      <input name="height_mm" placeholder="Height mm" value="${tds[2].textContent.split('×')[2]}" />
      <input name="ordinal" placeholder="Ordinal" value="${tds[3].textContent.trim()}" />
      <button type="submit">Save</button>
    `;
  }

  async function softDeleteShelf(btn) {
    const id = Number(btn.closest("tr").dataset.id);
    await core.api.del(`/api/shelves/${id}`);
    await renderShelves();
  }
  async function restoreShelf(btn) {
    const id = Number(btn.closest("tr").dataset.id);
    await core.api.post(`/api/shelves/${id}/restore`, {});
    await renderShelves();
  }

  async function renderUsers() {
    const users = await core.api.get("/api/users/admin");
    el.usersTable.innerHTML = users.map(u => `
      <tr data-id="${u.id}">
        <td>${u.email}</td>
        <td>${u.name}</td>
        <td>${u.role}</td>
        <td>${u.max_clearance_level ?? "—"}</td>
        <td>
          <button class="reset">Reset PW</button>
          <button class="delete">Delete</button>
        </td>
      </tr>
    `).join("");
    el.usersTable.querySelectorAll(".reset").forEach(btn => btn.addEventListener("click", async () => {
      const id = Number(btn.closest("tr").dataset.id);
      const pw = prompt("New password for this user:");
      if (!pw) return;
      await core.api.post(`/api/users/${id}/reset_password`, { password: pw });
      core.toast("Password reset", "success");
    }));
    el.usersTable.querySelectorAll(".delete").forEach(btn => btn.addEventListener("click", async () => {
      const id = Number(btn.closest("tr").dataset.id);
      await core.api.del(`/api/users/${id}`);
      await renderUsers();
    }));
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", async () => {
  try { await core.me(); } catch {}
  await Admin.init();
});

// Wait until app sets currentUser, then init admin features
document.addEventListener("DOMContentLoaded", () => {
  const ready = setInterval(() => {
    if (window.core && window.core.state) {
      clearInterval(ready);
      // Expose to window for debugging if needed
      Admin.init();
    }
  }, 50);
});
