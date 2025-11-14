from contextlib import closing
import bcrypt
import db
    
MainScript = """ 
-- Safety: new connections must enable FKs
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;


-- ---------- USERS ----------
CREATE TABLE  IF NOT EXISTS users  (
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
CREATE TABLE IF NOT EXISTS systems (
  id          INTEGER PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,                     -- ex - "1A"
  notes       TEXT,
  is_deleted  INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0,1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- SHELVES (belong to a system) ----------
CREATE TABLE IF NOT EXISTS shelves (
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

CREATE INDEX IF NOT EXISTS idx_shelves_system_ordinal ON shelves(system_id, ordinal);

-- ---------- ITEMS ----------
CREATE TABLE IF NOT EXISTS items (
  id                   INTEGER PRIMARY KEY,
  sku                  TEXT NOT NULL UNIQUE,
  name                 TEXT NOT NULL,
  unit                 TEXT NOT NULL DEFAULT 'units',
  clearance_level      INTEGER NOT NULL CHECK (clearance_level >= 1),
  shelf_id        INTEGER REFERENCES shelves(id) ON DELETE SET NULL,
  quantity     INTEGER NOT NULL DEFAULT 0,      -- cached; maintained by movement triggers
  tag                  TEXT,
  note                 TEXT,
  is_deleted           INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0,1)),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_items_deleted_name            ON items(is_deleted, name);
CREATE INDEX IF NOT EXISTS idx_items_clearance               ON items(clearance_level);
CREATE INDEX IF NOT EXISTS idx_items_shelf              ON items(shelf_id);
CREATE INDEX IF NOT EXISTS idx_items_qty                     ON items(quantity);
CREATE INDEX IF NOT EXISTS idx_items_created_at              ON items(created_at);
CREATE INDEX IF NOT EXISTS idx_items_updated_at              ON items(updated_at);

-- ---------- MOVEMENTS (ledger; signed quantities) ----------
-- Convention:
--   receive  = +qty
--   issue    = -qty  (checkout)  -> requires holder, optional due_at
--   return   = +qty  (check-in)
--   adjust   = ±qty  (admin-only in app)
--   transfer = USE TWO ROWS: -qty at source shelf; +qty at dest shelf (kind should be 'transfer' in BOTH rows for clarity)

DROP TABLE IF EXISTS movements;

CREATE TABLE IF NOT EXISTS movements (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id        INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,

  -- signed qty (+receive, -issue, +return, +/-adjust, transfer uses two rows)
  qty            INTEGER NOT NULL,

  -- movement category
  type           TEXT NOT NULL CHECK (type IN ('receive','issue','return','adjust','transfer')),

  -- fields used by your existing views/guards
  shelf_id       INTEGER REFERENCES shelves(id),
  holder         TEXT,
  due_at         TEXT,
  actor_user_id  INTEGER REFERENCES users(id),

  -- audit
  operator_name  TEXT,
  note           TEXT,

  -- keep this (many parts of your app use it)
  timestamp      TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE INDEX IF NOT EXISTS idx_movements_item_id    ON movements(item_id);
CREATE INDEX IF NOT EXISTS idx_movements_type       ON movements(type);
CREATE INDEX IF NOT EXISTS idx_movements_timestamp  ON movements(timestamp);
CREATE INDEX IF NOT EXISTS idx_mov_item_ts          ON movements(item_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_mov_item_type_ts     ON movements(item_id, type, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_mov_shelf_ts         ON movements(shelf_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_mov_holder           ON movements(holder);


DROP TRIGGER IF EXISTS trg_movements_ai;

CREATE TRIGGER trg_movements_ai
AFTER INSERT ON movements
FOR EACH ROW
BEGIN
  UPDATE items
  SET quantity = quantity + NEW.qty
  WHERE id = NEW.item_id;
END;

-- ---------- TIMESTAMP BUMPS ----------
-- systems/shelves/items updated_at auto-bump on changes
CREATE TRIGGER IF NOT EXISTS trg_systems_updated_at
AFTER UPDATE ON systems
FOR EACH ROW BEGIN
  UPDATE systems SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_shelves_updated_at
AFTER UPDATE ON shelves
FOR EACH ROW BEGIN
  UPDATE shelves SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_items_updated_at
AFTER UPDATE ON items
FOR EACH ROW BEGIN
  UPDATE items SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- ---------- SOFT-DELETE CASCADES ----------
-- When a SYSTEM is soft-deleted, soft-delete all its shelves; shelves trigger will soft-delete items.
CREATE TRIGGER IF NOT EXISTS trg_systems_soft_delete_cascade
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

-- When a SHELF is soft-deleted, soft-delete all items with that shelf_id.
CREATE TRIGGER IF NOT EXISTS trg_shelves_soft_delete_cascade
AFTER UPDATE OF is_deleted ON shelves
FOR EACH ROW
WHEN NEW.is_deleted = 1
BEGIN
  UPDATE items
     SET is_deleted = 1,
         updated_at = datetime('now')
   WHERE shelf_id = NEW.id
     AND is_deleted = 0;
END;

-- ---------- MOVEMENT GUARDS ----------
-- 1) Enforce signed quantity directions + forbid zero
DROP TRIGGER IF EXISTS trg_mov_sign_guard;
DROP TRIGGER IF EXISTS trg_mov_holder_guard;
DROP TRIGGER IF EXISTS trg_mov_shelf_required;

CREATE TRIGGER IF NOT EXISTS trg_mov_sign_guard
BEFORE INSERT ON movements
FOR EACH ROW
BEGIN
  SELECT
    CASE
      WHEN NEW.qty = 0 THEN RAISE(ABORT, 'qty cannot be zero')
      WHEN NEW.type = 'receive' AND NEW.qty <= 0 THEN RAISE(ABORT, 'receive requires qty > 0')
      WHEN NEW.type = 'issue'   AND NEW.qty >= 0 THEN RAISE(ABORT, 'issue requires qty < 0')
      WHEN NEW.type = 'return'  AND NEW.qty <= 0 THEN RAISE(ABORT, 'return requires qty > 0')
      WHEN NEW.type = 'transfer' AND NEW.qty = 0 THEN RAISE(ABORT, 'transfer requires non-zero qty')
    END;
END;

CREATE TRIGGER IF NOT EXISTS trg_mov_holder_guard
BEFORE INSERT ON movements
FOR EACH ROW
BEGIN
  SELECT
    CASE
      WHEN NEW.type = 'issue' AND (NEW.holder IS NULL OR TRIM(NEW.holder) = '')
        THEN RAISE(ABORT, 'issue requires holder')
      WHEN NEW.type IN ('receive','adjust','transfer') AND NEW.holder IS NOT NULL
        THEN RAISE(ABORT, 'holder allowed only for issue/return')
    END;
END;

-- Keep this ONLY if you truly want a shelf on every movement.
-- If not, drop this trigger or relax it.
CREATE TRIGGER IF NOT EXISTS trg_mov_shelf_required
BEFORE INSERT ON movements
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.shelf_id IS NULL THEN RAISE(ABORT, 'shelf_id is required') END;
END;

-- ---------- QUANTITY CACHE MAINTENANCE ----------
-- Items.quantity reflects the sum of movement quantities.
-- Maintain it on INSERT/DELETE/UPDATE.

DROP TRIGGER IF EXISTS trg_mov_ai_update_item_qty;
DROP TRIGGER IF EXISTS trg_mov_ad_update_item_qty;
DROP TRIGGER IF EXISTS trg_mov_au_update_item_qty;

CREATE TRIGGER IF NOT EXISTS trg_mov_ai_update_item_qty
AFTER INSERT ON movements
FOR EACH ROW
BEGIN
  UPDATE items
     SET quantity = quantity + NEW.qty,
         updated_at = datetime('now')
   WHERE id = NEW.item_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_mov_ad_update_item_qty
AFTER DELETE ON movements
FOR EACH ROW
BEGIN
  UPDATE items
     SET quantity = quantity - OLD.qty,
         updated_at = datetime('now')
   WHERE id = OLD.item_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_mov_au_update_item_qty
AFTER UPDATE OF qty, item_id ON movements
FOR EACH ROW
BEGIN
  UPDATE items
     SET quantity = quantity - OLD.qty,
         updated_at = datetime('now')
   WHERE id = OLD.item_id;

  UPDATE items
     SET quantity = quantity + NEW.qty,
         updated_at = datetime('now')
   WHERE id = NEW.item_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_mov_au_update_item_qty
AFTER UPDATE OF quantity, item_id ON movements
FOR EACH ROW
BEGIN
  -- Remove old effect
  UPDATE items
     SET quantity = quantity - OLD.quantity,
         updated_at = datetime('now')
   WHERE id = OLD.item_id;

  -- Add new effect
  UPDATE items
     SET quantity = quantity + NEW.quantity,
         updated_at = datetime('now')
   WHERE id = NEW.item_id;
END;

-- Optional: disallow negative stock (comment out if you allow backorders)
-- CREATE TRIGGER trg_items_no_negative
-- AFTER UPDATE OF quantity ON items
-- FOR EACH ROW
-- WHEN NEW.quantity < 0
-- BEGIN
--   SELECT RAISE(ABORT, 'quantity cannot go below 0');
-- END;

-- ---------- FTS5 FOR ITEMS SEARCH ----------
-- Virtual table mirrors key text columns for fast "q" search.
CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  sku, name, tag, note, content='items', content_rowid='id'
);

-- Keep FTS in sync
CREATE TRIGGER IF NOT EXISTS trg_items_fts_ai
AFTER INSERT ON items
BEGIN
  INSERT INTO items_fts(rowid, sku, name, tag, note)
  VALUES (NEW.id, NEW.sku, NEW.name, NEW.tag, NEW.note);
END;

CREATE TRIGGER IF NOT EXISTS trg_items_fts_ad
AFTER DELETE ON items
BEGIN
  INSERT INTO items_fts(items_fts, rowid, sku, name, tag, note)
  VALUES('delete', OLD.id, OLD.sku, OLD.name, OLD.tag, OLD.note);
END;

CREATE TRIGGER IF NOT EXISTS trg_items_fts_au
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
         SUM(qty) AS net_qty
  FROM movements
  WHERE type IN ('issue','return')
  GROUP BY item_id, holder
)
SELECT item_id, holder, net_qty AS qty_outstanding
FROM ledger
WHERE holder IS NOT NULL AND net_qty < 0;

DROP VIEW IF EXISTS item_status_current;
CREATE VIEW item_status_current AS
WITH last_any AS (
  SELECT m.item_id, MAX(m.timestamp) AS last_movement_ts
  FROM movements m
  GROUP BY m.item_id
),
last_issue AS (
  SELECT m.item_id, MAX(m.timestamp) AS last_issue_ts
  FROM movements m
  WHERE m.type = 'issue'
  GROUP BY m.item_id
),
last_return AS (
  SELECT m.item_id, MAX(m.timestamp) AS last_return_ts
  FROM movements m
  WHERE m.type = 'return'
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
  i.quantity,
  i.is_deleted,
  s.id                 AS shelf_id,
  s.label              AS shelf_label,
  sys.code             AS system_code,
  COALESCE(o.is_out, 0)           AS is_out,
  li.last_issue_ts,
  lr.last_return_ts,
  la.last_movement_ts
FROM items i
LEFT JOIN shelves s   ON s.id = i.shelf_id
LEFT JOIN systems sys ON sys.id = s.system_id
LEFT JOIN last_any   la ON la.item_id = i.id
LEFT JOIN last_issue li ON li.item_id = i.id
LEFT JOIN last_return lr ON lr.item_id = i.id
LEFT JOIN out_now     o  ON o.item_id = i.id;

DROP VIEW IF EXISTS latest_item_movements;
CREATE VIEW latest_item_movements AS
WITH ranked AS (
  SELECT
    m.id,
    m.item_id,
    m.type AS movement_type, 
    m.qty,
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
  id, item_id, movement_type, qty, shelf_id, holder, due_at, actor_user_id, note, timestamp
FROM ranked
WHERE rn <= 10
ORDER BY item_id, timestamp DESC, id DESC;



---------- new update to include shelf_id ----------

DROP TABLE IF EXISTS items;

CREATE TABLE items (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    sku              TEXT NOT NULL UNIQUE,
    name             TEXT NOT NULL,
    unit             TEXT,
    clearance_level  INTEGER NOT NULL CHECK (clearance_level BETWEEN 1 AND 4),

    tag              TEXT,
    note             TEXT,

    shelf_id         INTEGER NOT NULL REFERENCES shelves(id)
                      ON UPDATE CASCADE ON DELETE CASCADE,

    quantity         INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),

    added_by         TEXT NOT NULL DEFAULT 'admin',
    created_at       TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at       TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    deleted_at       TEXT,
    is_deleted       INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0,1))
);


CREATE INDEX IF NOT EXISTS idx_items_name         ON items(name);
CREATE INDEX IF NOT EXISTS idx_items_tag          ON items(tag);
CREATE INDEX IF NOT EXISTS idx_items_shelf_id     ON items(shelf_id);
CREATE INDEX IF NOT EXISTS idx_items_is_deleted   ON items(is_deleted);
CREATE INDEX IF NOT EXISTS idx_items_clearance    ON items(clearance_level);
CREATE INDEX IF NOT EXISTS idx_items_created_at   ON items(created_at);
CREATE INDEX IF NOT EXISTS idx_items_quantity     ON items(quantity);
CREATE INDEX IF NOT EXISTS idx_items_sku          ON items(sku);


CREATE TRIGGER IF NOT EXISTS trg_items_updated_at
AFTER UPDATE ON items
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE items SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

ALTER TABLE systems ADD COLUMN deleted_at TEXT;

--new things we have added and run as a seperate script to ensure the data in the table stays as is
ALTER TABLE movements ADD COLUMN xfer_key TEXT;        -- nullable; only set for transfers
CREATE INDEX IF NOT EXISTS idx_movements_xfer ON movements(xfer_key, item_id, timestamp);

"""    
    
 
def executor(executee):
    with db._connect() as cursor: 
        print(cursor.executescript(executee))


scriptadd1= """
-- ALTER TABLE movements ADD COLUMN xfer_key TEXT;      nullable; only set for transfers
-- CREATE INDEX IF NOT EXISTS idx_movements_xfer ON movements(xfer_key, item_id, timestamp);

--CREATE UNIQUE INDEX IF NOT EXISTS ux_items_sku ON items(sku);
-- ALTER TABLE items ADD COLUMN system_code TEXT;
-- ALTER TABLE items ADD COLUMN shelf_label TEXT;
-- ALTER TABLE items ADD COLUMN quantity INTEGER DEFAULT 0;
--CREATE UNIQUE INDEX IF NOT EXISTS ux_items_sku ON items(sku);

CREATE TABLE IF NOT EXISTS holder_index (
  holder_norm TEXT NOT NULL,   -- lowercased, for case-insensitive search
  holder      TEXT NOT NULL,   -- original casing, for display / debugging
  item_id     INTEGER NOT NULL,
  qty_out     INTEGER NOT NULL,
  PRIMARY KEY (holder_norm, item_id)
);

CREATE INDEX IF NOT EXISTS idx_holder_index_item
  ON holder_index(item_id);

CREATE INDEX IF NOT EXISTS idx_holder_index_qty
  ON holder_index(qty_out);

-- 2) Trigger: after each movement, recompute the holder index for that item
DROP TRIGGER IF EXISTS trg_holder_index_rebuild;

CREATE TRIGGER trg_holder_index_rebuild
AFTER INSERT ON movements
BEGIN
  -- Clear existing index rows for this item
  DELETE FROM holder_index WHERE item_id = NEW.item_id;

  -- Rebuild from the full movement history for this item
  INSERT INTO holder_index (holder_norm, holder, item_id, qty_out)
  SELECT
    LOWER(COALESCE(m.holder_name, m.holder))         AS holder_norm,
    COALESCE(m.holder_name, m.holder)                AS holder,
    m.item_id                                        AS item_id,
    SUM(
      CASE
        WHEN m.type = 'issue'  THEN -m.qty   -- issues take stock out
        WHEN m.type = 'return' THEN  m.qty   -- returns bring it back
        ELSE 0
      END
    ) AS qty_out
  FROM movements m
  WHERE m.item_id = NEW.item_id
    AND COALESCE(m.holder_name, m.holder) IS NOT NULL
  GROUP BY holder_norm, holder, m.item_id
  HAVING qty_out > 0;   -- only keep holders who currently have something out
END;
"""


NewAdd="""

ALTER TABLE movements
ADD COLUMN holder_name TEXT;
UPDATE movements
SET holder_name = holder
WHERE holder_name IS NULL
  AND holder IS NOT NULL;
  
CREATE TABLE IF NOT EXISTS holder_index (
holder_norm TEXT NOT NULL,         -- lowercased normalized name
holder      TEXT NOT NULL,         -- display/original name
item_id     INTEGER NOT NULL,
qty_out     INTEGER NOT NULL,      -- how many units currently out with this holder

PRIMARY KEY (holder_norm, item_id),
FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_holder_index_holder_norm
  ON holder_index(holder_norm);

CREATE INDEX IF NOT EXISTS idx_holder_index_item_id
  ON holder_index(item_id);
  

--   For a given item_id, sum:
--     +qty for type='issue'   (stock issued to holder)
--     -qty for type='return'  (stock returned from holder)
--   Only keep rows where qty_out > 0
--
--   We always use COALESCE(holder_name, holder) so:
--     - new rows can use holder_name
--     - old rows from before the column existed still work



--After INSERT:
CREATE TRIGGER IF NOT EXISTS trg_holder_index_ai
AFTER INSERT ON movements
BEGIN
  DELETE FROM holder_index
  WHERE item_id = NEW.item_id;

  INSERT INTO holder_index (holder_norm, holder, item_id, qty_out)
  SELECT
    LOWER(COALESCE(holder_name, holder))      AS holder_norm,
    COALESCE(holder_name, holder)             AS holder,
    item_id                                   AS item_id,
    SUM(
      CASE
        WHEN type = 'issue'  THEN qty
        WHEN type = 'return' THEN -qty
        ELSE 0
      END
    )                                         AS qty_out
  FROM movements
  WHERE item_id = NEW.item_id
    AND COALESCE(holder_name, holder) IS NOT NULL
  GROUP BY holder_norm, holder, item_id
  HAVING qty_out > 0;
END;


--After UPDATE:
CREATE TRIGGER IF NOT EXISTS trg_holder_index_au
AFTER UPDATE ON movements
BEGIN
  DELETE FROM holder_index
  WHERE item_id = NEW.item_id;

  INSERT INTO holder_index (holder_norm, holder, item_id, qty_out)
  SELECT
    LOWER(COALESCE(holder_name, holder))      AS holder_norm,
    COALESCE(holder_name, holder)             AS holder,
    item_id                                   AS item_id,
    SUM(
      CASE
        WHEN type = 'issue'  THEN qty
        WHEN type = 'return' THEN -qty
        ELSE 0
      END
    )                                         AS qty_out
  FROM movements
  WHERE item_id = NEW.item_id
    AND COALESCE(holder_name, holder) IS NOT NULL
  GROUP BY holder_norm, holder, item_id
  HAVING qty_out > 0;
END;

-- After Delete
CREATE TRIGGER IF NOT EXISTS trg_holder_index_ad
AFTER DELETE ON movements
BEGIN
  DELETE FROM holder_index
  WHERE item_id = OLD.item_id;

  INSERT INTO holder_index (holder_norm, holder, item_id, qty_out)
  SELECT
    LOWER(COALESCE(holder_name, holder))      AS holder_norm,
    COALESCE(holder_name, holder)             AS holder,
    item_id                                   AS item_id,
    SUM(
      CASE
        WHEN type = 'issue'  THEN qty
        WHEN type = 'return' THEN -qty
        ELSE 0
      END
    )                                         AS qty_out
  FROM movements
  WHERE item_id = OLD.item_id
    AND COALESCE(holder_name, holder) IS NOT NULL
  GROUP BY holder_norm, holder, item_id
  HAVING qty_out > 0;
END;


--One time rebuild
DELETE FROM holder_index;

INSERT INTO holder_index (holder_norm, holder, item_id, qty_out)
SELECT
  LOWER(COALESCE(holder_name, holder))      AS holder_norm,
  COALESCE(holder_name, holder)             AS holder,
  item_id                                   AS item_id,
  SUM(
    CASE
      WHEN type = 'issue'  THEN qty
      WHEN type = 'return' THEN -qty
      ELSE 0
    END
  )                                         AS qty_out
FROM movements
WHERE COALESCE(holder_name, holder) IS NOT NULL
GROUP BY holder_norm, holder, item_id
HAVING qty_out > 0;

"""

Newadd2="""--UPDATE items
--SET quantity = COALESCE(
  --(
   -- SELECT SUM(m.qty)
   -- FROM movements m
   -- WHERE m.item_id = items.id
  --),
 -- 0
--);

DROP TRIGGER IF EXISTS trg_movements_ai;
UPDATE items
SET quantity = COALESCE(
  (SELECT SUM(m.qty) FROM movements m WHERE m.item_id = items.id),
  0
);
"""

executor(Newadd2)