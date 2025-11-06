-- schema.sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

-- ---------- DROP (idempotent) ----------
DROP TABLE IF EXISTS movements;
DROP TABLE IF EXISTS items;
DROP TABLE IF EXISTS shelves;
DROP TABLE IF EXISTS systems;
DROP TABLE IF EXISTS users;

DROP TABLE IF EXISTS items_fts;
DROP TRIGGER IF EXISTS trg_items_fts_ai;
DROP TRIGGER IF EXISTS trg_items_fts_ad;
DROP TRIGGER IF EXISTS trg_items_fts_au;

DROP VIEW IF EXISTS item_status_current;
DROP VIEW IF EXISTS current_out_by_holder;
DROP VIEW IF EXISTS latest_item_movements;

-- ---------- USERS ----------
CREATE TABLE users (
  id                    INTEGER PRIMARY KEY,
  email                 TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  role                  TEXT NOT NULL CHECK (role IN ('admin','user')),
  password_hash         TEXT NOT NULL,
  max_clearance_level   INTEGER,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- SYSTEMS ----------
CREATE TABLE systems (
  id          INTEGER PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  notes       TEXT,
  is_deleted  INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0,1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- SHELVES ----------
CREATE TABLE shelves (
  id           INTEGER PRIMARY KEY,
  system_id    INTEGER NOT NULL REFERENCES systems(id) ON DELETE RESTRICT,
  label        TEXT NOT NULL,
  length_mm    INTEGER NOT NULL,
  width_mm     INTEGER NOT NULL,
  height_mm    INTEGER NOT NULL,
  ordinal      INTEGER NOT NULL DEFAULT 1,
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
  quantity_on_hand     INTEGER NOT NULL DEFAULT 0,
  tag                  TEXT,
  note                 TEXT,
  is_deleted           INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0,1)),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_items_deleted_name   ON items(is_deleted, name);
CREATE INDEX idx_items_clearance      ON items(clearance_level);
CREATE INDEX idx_items_home_shelf     ON items(home_shelf_id);
CREATE INDEX idx_items_qty            ON items(quantity_on_hand);
CREATE INDEX idx_items_created_at     ON items(created_at);
CREATE INDEX idx_items_updated_at     ON items(updated_at);

-- ---------- MOVEMENTS (signed quantities) ----------
CREATE TABLE movements (
  id             INTEGER PRIMARY KEY,
  item_id        INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('receive','issue','return','adjust','transfer')),
  quantity       INTEGER NOT NULL,
  shelf_id       INTEGER NOT NULL REFERENCES shelves(id) ON DELETE RESTRICT,
  holder         TEXT,
  due_at         TEXT,
  actor_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  note           TEXT,
  timestamp      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_mov_item_ts      ON movements(item_id, timestamp DESC);
CREATE INDEX idx_mov_item_kind_ts ON movements(item_id, kind, timestamp DESC);
CREATE INDEX idx_mov_shelf_ts     ON movements(shelf_id, timestamp DESC);
CREATE INDEX idx_mov_holder       ON movements(holder);

-- ---------- TIMESTAMP BUMPS ----------
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
      WHEN NEW.kind = 'transfer' AND NEW.quantity = 0 THEN RAISE(ABORT, 'transfer requires non-zero quantity')
    END;
END;

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

CREATE TRIGGER trg_mov_shelf_required
BEFORE INSERT ON movements
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.shelf_id IS NULL THEN RAISE(ABORT, 'shelf_id is required') END;
END;

-- ---------- QUANTITY CACHE MAINTENANCE ----------
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
  UPDATE items
     SET quantity_on_hand = quantity_on_hand - OLD.quantity,
         updated_at = datetime('now')
   WHERE id = OLD.item_id;

  UPDATE items
     SET quantity_on_hand = quantity_on_hand + NEW.quantity,
         updated_at = datetime('now')
   WHERE id = NEW.item_id;
END;

-- Optional: prevent negative stock
-- CREATE TRIGGER trg_items_no_negative
-- AFTER UPDATE OF quantity_on_hand ON items
-- FOR EACH ROW
-- WHEN NEW.quantity_on_hand < 0
-- BEGIN
--   SELECT RAISE(ABORT, 'quantity_on_hand cannot go below 0');
-- END;

-- ---------- FTS5 ----------
CREATE VIRTUAL TABLE items_fts USING fts5(
  sku, name, tag, note, content='items', content_rowid='id'
);

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
