<h1>Warehouse Management System (WMS)</h1>

<p>
  This is my ongoing attempt at building a file/warehouse management system from scratch.
  The first iteration was stable enough to be used in a small library-style setup.
  The long-term goal is much bigger: a warehouse-level system that can confidently
  sit inside a corporate environment.
</p>

<h2>Status</h2>

<p>
  <strong>Stable build:</strong> <code>main</code> (production-style, library-ready)<br />
  <strong>Current working branch:</strong> <code>new-internal-system</code><br />
  <strong>Reason for new branch:</strong> Reworking the internals to be more robust,
  auditable, and aligned with the long-term warehouse vision.
</p>

<p>
  The <code>main</code> branch is currently considered <strong>stable</strong>.
</p>

<p>
  Latest notable changes on the working branch:
</p>
<ul>
  <li>New UI layer to visually separate the software from typical “admin dashboard” competitors, while keeping it operator-friendly.</li>
</ul>

<h2>The Why</h2>

<p>
  This project is my way of learning and proving how far a carefully designed,
  opinionated internal tool can go when it’s treated like a real product,
  crafted with care and when the same level of attention is paid to the UI and the system architecture. 
</p>

<h2>The How</h2>

<p>
  The system is being rebuilt around a few core ideas:
</p>

<p>
  On the backend, it uses FastAPI with SQLite (for now) and a signed quantity
  movement ledger (<code>movements</code> table) that updates cached quantities
  on <code>items</code>. Every receive, issue, return, adjust, or transfer is
  stored as an atomic movement instead of silently editing a number in place.
  Soft-deletes cascade through systems -> shelves -> items, and clearance levels
  control who can see or touch what.
</p>

<p>
  On the frontend, it’s a single-page experience built with HTML, CSS, and vanilla JavaScript.
  The focus is on:
</p>
<ul>
  <li>A polished, high-contrast UI that feels like a dedicated internal tool, not a template.</li>
  <li>Operator-first flows: quick search, filters, keyboard-friendly actions, and clear status badges.</li>
  <li>Admin views for managing systems, shelves, and users without touching the database directly.</li>
</ul>

<p>
  Over time, this repo will track the evolution from a simple “file tracker”
  to a warehouse-ready system with proper auth, audit trails, imports/exports,
  and scheduled notifications.
</p>
