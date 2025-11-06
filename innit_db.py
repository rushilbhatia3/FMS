from contextlib import closing
import bcrypt
import db
    
MainScript = """ 
-- Safety: new connections must enable FKs
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;


-- ---------- USERS ----------
CREATE TABLE users (
  id                    INTEGER PRIMARY KEY,
  email                 TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  role                  TEXT NOT NULL CHECK (role IN ('admin','user')),
  password_hash         TEXT NOT NULL,                  -- bcrypt
  max_clearance_level   INTEGER,                        -- NULL => unlimited
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- SYSTEMS (e.g., "1A") ----------
CREATE TABLE systems (
  id          INTEGER PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,                     -- ex - "1A"
  notes       TEXT,
  is_deleted  INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0,1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- SHELVES (belong to a system) ----------
CREATE TABLE shelves (
  id           INTEGER PRIMARY KEY,
  system_id    INTEGER NOT NULL REFERENCES systems(id) ON DELETE RESTRICT,
  label        TEXT NOT NULL,                           -- ex - "1A-1"
  length_mm    INTEGER NOT NULL,                        -- dimensions in mm
  width_mm     INTEGER NOT NULL,
  height_mm    INTEGER NOT NULL,
  ordinal      INTEGER NOT NULL DEFAULT 1,              -- position within system
  is_deleted   INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0,1)),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (system_id, label)
);

CREATE INDEX idx_shelves_system_ordinal ON shelves(system_id, ordinal);

-- ---------- ITEMS ----------
CREATE TABLE items (
  id                   INTEGER PRIMARY KEY,
  sku                  TEXT NOT NULL UNIQUE,
  name                 TEXT NOT NULL,
  unit                 TEXT NOT NULL DEFAULT 'units',
  clearance_level      INTEGER NOT NULL CHECK (clearance_level >= 1),
  home_shelf_id        INTEGER REFERENCES shelves(id) ON DELETE SET NULL,
  quantity_on_hand     INTEGER NOT NULL DEFAULT 0,      -- cached; maintained by movement triggers
  tag                  TEXT,
  note                 TEXT,
  is_deleted           INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0,1)),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_items_deleted_name            ON items(is_deleted, name);
CREATE INDEX idx_items_clearance               ON items(clearance_level);
CREATE INDEX idx_items_home_shelf              ON items(home_shelf_id);
CREATE INDEX idx_items_qty                     ON items(quantity_on_hand);
CREATE INDEX idx_items_created_at              ON items(created_at);
CREATE INDEX idx_items_updated_at              ON items(updated_at);

-- ---------- MOVEMENTS (ledger; signed quantities) ----------
-- Convention:
--   receive  = +qty
--   issue    = -qty  (checkout)  -> requires holder, optional due_at
--   return   = +qty  (check-in)
--   adjust   = ±qty  (admin-only in app)
--   transfer = USE TWO ROWS: -qty at source shelf; +qty at dest shelf (kind should be 'transfer' in BOTH rows for clarity)
CREATE TABLE movements (
  id             INTEGER PRIMARY KEY,
  item_id        INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('receive','issue','return','adjust','transfer')),
  quantity       INTEGER NOT NULL,                      -- signed
  shelf_id       INTEGER NOT NULL REFERENCES shelves(id) ON DELETE RESTRICT,
  -- For transfers we persist two rows; one for source shelf (-qty), one for dest shelf (+qty),
  -- both with kind = 'transfer'. The app must write both rows.
  holder         TEXT,                                  -- required for issue; optional on return
  due_at         TEXT,                                  -- recommended on issue
  actor_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  note           TEXT,
  timestamp      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_mov_item_ts           ON movements(item_id, timestamp DESC);
CREATE INDEX idx_mov_item_kind_ts      ON movements(item_id, kind, timestamp DESC);
CREATE INDEX idx_mov_shelf_ts          ON movements(shelf_id, timestamp DESC);
CREATE INDEX idx_mov_holder            ON movements(holder);

-- ---------- TIMESTAMP BUMPS ----------
-- systems/shelves/items updated_at auto-bump on changes
CREATE TRIGGER trg_systems_updated_at
AFTER UPDATE ON systems
FOR EACH ROW BEGIN
  UPDATE systems SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER trg_shelves_updated_at
AFTER UPDATE ON shelves
FOR EACH ROW BEGIN
  UPDATE shelves SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER trg_items_updated_at
AFTER UPDATE ON items
FOR EACH ROW BEGIN
  UPDATE items SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- ---------- SOFT-DELETE CASCADES ----------
-- When a SYSTEM is soft-deleted, soft-delete all its shelves; shelves trigger will soft-delete items.
CREATE TRIGGER trg_systems_soft_delete_cascade
AFTER UPDATE OF is_deleted ON systems
FOR EACH ROW
WHEN NEW.is_deleted = 1
BEGIN
  UPDATE shelves
     SET is_deleted = 1,
         updated_at = datetime('now')
   WHERE system_id = NEW.id
     AND is_deleted = 0;
END;

-- When a SHELF is soft-deleted, soft-delete all items with that home_shelf_id.
CREATE TRIGGER trg_shelves_soft_delete_cascade
AFTER UPDATE OF is_deleted ON shelves
FOR EACH ROW
WHEN NEW.is_deleted = 1
BEGIN
  UPDATE items
     SET is_deleted = 1,
         updated_at = datetime('now')
   WHERE home_shelf_id = NEW.id
     AND is_deleted = 0;
END;

-- ---------- MOVEMENT GUARDS ----------
-- 1) Enforce signed quantity directions + forbid zero
CREATE TRIGGER trg_mov_sign_guard
BEFORE INSERT ON movements
FOR EACH ROW
BEGIN
  SELECT
    CASE
      WHEN NEW.quantity = 0 THEN RAISE(ABORT, 'quantity cannot be zero')
      WHEN NEW.kind = 'receive' AND NEW.quantity <= 0 THEN RAISE(ABORT, 'receive requires quantity > 0')
      WHEN NEW.kind = 'issue'   AND NEW.quantity >= 0 THEN RAISE(ABORT, 'issue requires quantity < 0')
      WHEN NEW.kind = 'return'  AND NEW.quantity <= 0 THEN RAISE(ABORT, 'return requires quantity > 0')
      -- adjust may be +/-; transfer must be +/- (two rows)
      WHEN NEW.kind = 'transfer' AND NEW.quantity = 0 THEN RAISE(ABORT, 'transfer requires non-zero quantity')
    END;
END;

-- 2) Holder rules: issue requires holder; others must not have holder EXCEPT return may echo holder (optional)
CREATE TRIGGER trg_mov_holder_guard
BEFORE INSERT ON movements
FOR EACH ROW
BEGIN
  SELECT
    CASE
      WHEN NEW.kind = 'issue' AND (NEW.holder IS NULL OR TRIM(NEW.holder) = '')
        THEN RAISE(ABORT, 'issue requires holder')
      WHEN NEW.kind IN ('receive','adjust','transfer') AND NEW.holder IS NOT NULL
        THEN RAISE(ABORT, 'holder allowed only for issue/return')
    END;
END;

-- 3) Require shelf context always (including adjust). App must supply source/dest via two rows for transfer.
CREATE TRIGGER trg_mov_shelf_required
BEFORE INSERT ON movements
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.shelf_id IS NULL THEN RAISE(ABORT, 'shelf_id is required') END;
END;

-- ---------- QUANTITY CACHE MAINTENANCE ----------
-- Items.quantity_on_hand reflects the sum of movement quantities.
-- Maintain it on INSERT/DELETE/UPDATE.

CREATE TRIGGER trg_mov_ai_update_item_qty
AFTER INSERT ON movements
FOR EACH ROW
BEGIN
  UPDATE items
     SET quantity_on_hand = quantity_on_hand + NEW.quantity,
         updated_at = datetime('now')
   WHERE id = NEW.item_id;
END;

CREATE TRIGGER trg_mov_ad_update_item_qty
AFTER DELETE ON movements
FOR EACH ROW
BEGIN
  UPDATE items
     SET quantity_on_hand = quantity_on_hand - OLD.quantity,
         updated_at = datetime('now')
   WHERE id = OLD.item_id;
END;

CREATE TRIGGER trg_mov_au_update_item_qty
AFTER UPDATE OF quantity, item_id ON movements
FOR EACH ROW
BEGIN
  -- Remove old effect
  UPDATE items
     SET quantity_on_hand = quantity_on_hand - OLD.quantity,
         updated_at = datetime('now')
   WHERE id = OLD.item_id;

  -- Add new effect
  UPDATE items
     SET quantity_on_hand = quantity_on_hand + NEW.quantity,
         updated_at = datetime('now')
   WHERE id = NEW.item_id;
END;

-- Optional: disallow negative stock (comment out if you allow backorders)
-- CREATE TRIGGER trg_items_no_negative
-- AFTER UPDATE OF quantity_on_hand ON items
-- FOR EACH ROW
-- WHEN NEW.quantity_on_hand < 0
-- BEGIN
--   SELECT RAISE(ABORT, 'quantity_on_hand cannot go below 0');
-- END;

-- ---------- FTS5 FOR ITEMS SEARCH ----------
-- Virtual table mirrors key text columns for fast "q" search.
CREATE VIRTUAL TABLE items_fts USING fts5(
  sku, name, tag, note, content='items', content_rowid='id'
);

-- Keep FTS in sync
CREATE TRIGGER trg_items_fts_ai
AFTER INSERT ON items
BEGIN
  INSERT INTO items_fts(rowid, sku, name, tag, note)
  VALUES (NEW.id, NEW.sku, NEW.name, NEW.tag, NEW.note);
END;

CREATE TRIGGER trg_items_fts_ad
AFTER DELETE ON items
BEGIN
  INSERT INTO items_fts(items_fts, rowid, sku, name, tag, note)
  VALUES('delete', OLD.id, OLD.sku, OLD.name, OLD.tag, OLD.note);
END;

CREATE TRIGGER trg_items_fts_au
AFTER UPDATE OF sku, name, tag, note ON items
BEGIN
  INSERT INTO items_fts(items_fts, rowid, sku, name, tag, note)
  VALUES('delete', OLD.id, OLD.sku, OLD.name, OLD.tag, OLD.note);
  INSERT INTO items_fts(rowid, sku, name, tag, note)
  VALUES (NEW.id, NEW.sku, NEW.name, NEW.tag, NEW.note);
END;

-- ---------- STATUS & REPORTING VIEWS ----------

-- Per-holder outstanding: negative net means currently checked out
DROP VIEW IF EXISTS current_out_by_holder;
CREATE VIEW current_out_by_holder AS
WITH ledger AS (
  SELECT item_id,
         holder,
         SUM(quantity) AS net_qty
  FROM movements
  WHERE kind IN ('issue','return')
  GROUP BY item_id, holder
)
SELECT item_id, holder, net_qty AS qty_outstanding
FROM ledger
WHERE holder IS NOT NULL AND net_qty < 0;

-- Item status summary (one row per item)
DROP VIEW IF EXISTS item_status_current;
CREATE VIEW item_status_current AS
WITH last_any AS (
  SELECT m.item_id,
         MAX(m.timestamp) AS last_movement_ts
  FROM movements m
  GROUP BY m.item_id
),
last_issue AS (
  SELECT m.item_id, MAX(m.timestamp) AS last_issue_ts
  FROM movements m
  WHERE m.kind = 'issue'
  GROUP BY m.item_id
),
last_return AS (
  SELECT m.item_id, MAX(m.timestamp) AS last_return_ts
  FROM movements m
  WHERE m.kind = 'return'
  GROUP BY m.item_id
),
out_now AS (
  SELECT item_id, 1 AS is_out
  FROM current_out_by_holder
  GROUP BY item_id
)
SELECT
  i.id                 AS item_id,
  i.sku,
  i.name,
  i.unit,
  i.clearance_level,
  i.quantity_on_hand,
  i.is_deleted,
  s.id                 AS shelf_id,
  s.label              AS shelf_label,
  sys.code             AS system_code,
  COALESCE(o.is_out, 0)           AS is_out,
  li.last_issue_ts,
  lr.last_return_ts,
  la.last_movement_ts
FROM items i
LEFT JOIN shelves s   ON s.id = i.home_shelf_id
LEFT JOIN systems sys ON sys.id = s.system_id
LEFT JOIN last_any   la ON la.item_id = i.id
LEFT JOIN last_issue li ON li.item_id = i.id
LEFT JOIN last_return lr ON lr.item_id = i.id
LEFT JOIN out_now     o  ON o.item_id = i.id;

-- Last 10 movements per item (kind, signed qty, holder, shelf, actor, ts)
DROP VIEW IF EXISTS latest_item_movements;
CREATE VIEW latest_item_movements AS
WITH ranked AS (
  SELECT
    m.id,
    m.item_id,
    m.kind,
    m.quantity,
    m.shelf_id,
    m.holder,
    m.due_at,
    m.actor_user_id,
    m.note,
    m.timestamp,
    ROW_NUMBER() OVER (PARTITION BY m.item_id ORDER BY m.timestamp DESC, m.id DESC) AS rn
  FROM movements m
)
SELECT
  id, item_id, kind, quantity, shelf_id, holder, due_at, actor_user_id, note, timestamp
FROM ranked
WHERE rn <= 10
ORDER BY item_id, timestamp DESC, id DESC;









"""    
    
 
def executor(executee):
    with db._connect() as cursor: 
        print(cursor.executescript(executee))
    


def reset_users():
    print(" Resetting all users...")
    with closing(db.get_conn()) as conn, conn:
        # 1️⃣  Drop all existing users
        conn.execute("DELETE FROM users;")

        # 2️⃣  Optionally reset auto-increment counter
        conn.execute("DELETE FROM sqlite_sequence WHERE name='users';")

        # 3️⃣  Define your new base users
        seed_users = [
            {
                "email": "admin@hocc.com",
                "password": "12345678",
                "role": "admin",
            },
            {
                "email": "rushil@hocc.com",
                "password": "Bread@1234",
                "role": "admin",
            },
            {
                "email": "user@hocc.com",
                "password": "Rushil@12",
                "role": "user",
            },
        ]

        # 4️⃣  Insert them with bcrypt hashes
        for u in seed_users:
            pw_hash = bcrypt.hashpw(u["password"].encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
            conn.execute(
                "INSERT INTO users (email, password_hash, role, active) VALUES (?, ?, ?, 1)",
                (u["email"].lower(), pw_hash, u["role"])
            )
        print(f"✅  Inserted {len(seed_users)} users.")

#reset_users()
executor(MainScript)