from fastapi import APIRouter, Depends, HTTPException, Query, status, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_validator, Field
from typing import Optional, List, Literal, Dict, Any, Sequence
import csv, io, json, db, zipfile
from auth import get_current_user, require_admin

router = APIRouter(tags=["items"])

# ---------- Pydantic models ----------

class ItemCreate(BaseModel):
    sku: str
    name: str
    unit: str = "units"
    clearance_level: int = Field(..., ge=1, le=4)
    system_code: str = Field(..., min_length=1, max_length=64)
    shelf_label: str = Field(..., min_length=1, max_length=64)
    quantity: int = Field(..., ge=0)

    tag: Optional[str] = None
    note: Optional[str] = None

    @field_validator("sku", "name")
    @classmethod
    def not_blank(cls, v: str) -> str:
        if not str(v).strip():
            raise ValueError("Required field cannot be blank")
        return v.strip()

    @field_validator("clearance_level")
    @classmethod
    def cl_positive(cls, v: int) -> int:
        if v < 1:
            raise ValueError("clearance_level must be >= 1")
        return v

class ItemUpdate(BaseModel):
    name: Optional[str] = None
    sku: Optional[str] = None
    unit: Optional[str] = None
    clearance_level: Optional[int] = None
    system_code: Optional[str] = None
    shelf_label: Optional[str] = None
    shelf_id: Optional[int] = None
    tag: Optional[str] = None
    note: Optional[str] = None

class ItemOut(BaseModel):
    id: int
    sku: str
    name: str
    unit: str
    clearance_level: int
    quantity: int
    is_deleted: int
    shelf_id: Optional[int] = None
    shelf_label: Optional[str] = None
    system_code: Optional[str] = None
    is_out: int = 0
    last_issue_ts: Optional[str] = None
    last_return_ts: Optional[str] = None
    last_movement_ts: Optional[str] = None

class ItemDetailOut(ItemOut):
    tag: Optional[str] = None
    note: Optional[str] = None
    created_at: str
    updated_at: str

class PaginatedItems(BaseModel):
    items: List[ItemOut]
    page: int
    page_size: int
    total: int

REQUIRED_IMPORT_HEADERS = [
    "sku",
    "name",
    "unit",
    "clearance_level",
    "system_code",
    "shelf_label",
    "quantity",
    "tag",
    "note",
]

# ---------- Helpers ----------
def _row_lower_headers(fieldnames: List[str] | None) -> List[str]:
    return [h.strip().lower() for h in (fieldnames or [])]

def _qmarks(n: int) -> str:
    return ", ".join(["?"] * n)

def _current_user_clearance(user: Dict[str, Any]) -> Optional[int]:
    if user["role"] == "admin":
        return None
    return user.get("max_clearance_level")

def _order_clause_filtered(sort: str, dir_: str) -> str:
    #ORDER by for the item_status_current CTE.
    direction = "ASC" if str(dir_).lower() == "asc" else "DESC"
    if sort == "sku":
        #ordered by numeric value then by text.
        return f"""
        CASE
          WHEN sku GLOB '[0-9]*' AND sku NOT GLOB '*[^0-9]*' THEN 0
          ELSE 1
        END {direction},
        CASE
          WHEN sku GLOB '[0-9]*' AND sku NOT GLOB '*[^0-9]*'
          THEN CAST(sku AS INTEGER)
        END {direction},
        sku {direction},
        item_id {direction}
        """

    allowed = {
        "last_movement_ts": "last_movement_ts",
        "created_at":       "created_at",
        "name":             "name",
        "sku":              "sku",
        "quantity":         "quantity",
        "clearance_level":  "clearance_level",
        "system_code":      "system_code",
        "shelf_label":      "shelf_label",
    }
    key = allowed.get(sort, "last_movement_ts")
    return f"{key} {direction}, item_id {direction}"

def _log_item_event(
    item_id: int,
    kind: str,
    actor: Optional[str],
    summary: str,
    details: Optional[Dict[str, Any]] = None,
) -> None:
    db.db_write(
        """
        INSERT INTO item_events (item_id, kind, actor, summary, details)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            item_id,
            kind,
            actor,
            summary,
            json.dumps(details) if details is not None else None,
        ),
    )

def generate_items_csv_for_bundle(
    q: str,
    status_filter: str,
    include_deleted: bool,
    system_code: str,
    shelf_label: str,
    holder: str,
    min_qty: Optional[int],
    max_qty: Optional[int],
    user,
) -> bytes:
    #sort by SKU asc for bundle
    sort = "sku"
    direction = "asc"

    buf = io.StringIO()
    writer = csv.writer(buf)

    writer.writerow([
        "id",
        "sku",
        "name",
        "unit",
        "clearance_level",
        "quantity",
        "system_code",
        "shelf_label",
        "is_deleted",
        "is_out",
        "last_issue_ts",
        "last_return_ts",
        "last_movement_ts",
        "tag",
        "note",
        "current_holder",
    ])

    page_no = 1
    page_size = 500

    while True:
        page_data = list_items(
            q=q,
            status_filter=status_filter,
            include_deleted=include_deleted,
            system_code=system_code,
            shelf_label=shelf_label,
            holder=holder,
            min_qty=min_qty,
            max_qty=max_qty,
            sort=sort,
            dir=direction,
            page=page_no,
            page_size=page_size,
            user=user,
        )

        items = page_data["items"]
        total = page_data["total"]

        if not items:
            break

        for it in items:
            writer.writerow([
                it["id"],
                it.get("sku") or "",
                it.get("name") or "",
                it.get("unit") or "",
                it.get("clearance_level") or "",
                it.get("quantity") or 0,
                it.get("system_code") or "",
                it.get("shelf_label") or "",
                it.get("is_deleted") or 0,
                it.get("is_out") or 0,
                it.get("last_issue_ts") or "",
                it.get("last_return_ts") or "",
                it.get("last_movement_ts") or "",
                it.get("tag") or "",
                it.get("note") or "",
                it.get("current_holder") or "",
            ])

        if page_no * page_size >= total:
            break
        page_no += 1

    return buf.getvalue().encode("utf-8")


# ---------- List items ----------
@router.get("/items", response_model=PaginatedItems)
def list_items(
    q: str = Query("", description="FTS query over sku/name/tag/note + holder lookup"),
    status_filter: Literal["", "available", "checked_out", "deleted"] = Query("", alias="status"),
    include_deleted: bool = Query(False),
    system_code: str = Query(""),
    shelf_label: str = Query(""),
    holder: str = Query("", description="(optional) explicit holder filter, usually not used now"),
    min_qty: Optional[int] = Query(None),
    max_qty: Optional[int] = Query(None),
    sort: str = Query("last_movement_ts"),
    dir: Literal["asc", "desc"] = Query("desc", alias="dir"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    user=Depends(get_current_user),
):
    user_maxCL = _current_user_clearance(user)
    # Normalise search input
    q_norm = (q or "").strip()
    include_del_flag = 1 if (include_deleted or status_filter == "deleted") else 0
    params = {
        "maxCL": user_maxCL,                         # None means unlimited
        "include_del": 1 if include_deleted else 0,
        "system_code": (system_code or "").strip(),
        "shelf_label": (shelf_label or "").strip(),
        "status": (status_filter or "").strip(),     # '', 'available', 'checked_out'. -------> extend to include deleted as well
        "min_qty": min_qty,
        "max_qty": max_qty,
        "holder": (holder or "").strip(),
        "q": q_norm,
        # shared substring pattern for all LIKE checks
        "q_like": f"%{q_norm.lower()}%" if q_norm else None,
    }

    # CTE applying all filters except paging and ordering
    filtered_cte = """
    WITH filtered AS (
      SELECT isc.*
      FROM item_status_current isc
      WHERE (:maxCL IS NULL OR isc.clearance_level <= :maxCL)
        AND (:include_del = 1 OR isc.is_deleted = 0)
        AND (:system_code = '' OR isc.system_code = :system_code)
        AND (:shelf_label = '' OR isc.shelf_label = :shelf_label)
        AND (
              :status = ''
           OR (:status = 'available'    AND isc.is_out = 0)
           OR (:status = 'checked_out'  AND isc.is_out = 1)
           OR (:status = 'deleted'      AND isc.is_deleted = 1)
        )
        AND (:min_qty IS NULL OR isc.quantity >= :min_qty)
        AND (:max_qty IS NULL OR isc.quantity <= :max_qty)
        AND (:holder = '' OR EXISTS (
              SELECT 1 FROM current_out_by_holder h
              WHERE h.item_id = isc.item_id AND h.holder = :holder
            ))
        AND (
              :q = ''

           -- 1) FTS over items_fts 
           OR isc.item_id IN (
                SELECT rowid
                FROM items_fts
                WHERE items_fts MATCH :q
              )

           -- 2) Substring match on basic item fields 
           OR (
                :q_like IS NOT NULL AND (
                     LOWER(isc.name)        LIKE :q_like
                  OR LOWER(isc.sku)         LIKE :q_like
                  OR LOWER(isc.system_code) LIKE :q_like
                  OR LOWER(isc.shelf_label) LIKE :q_like
                )
              )

           OR EXISTS (
                SELECT 1
                FROM holder_index hi
                WHERE hi.item_id = isc.item_id
                  AND (:q_like IS NOT NULL AND hi.holder_norm LIKE :q_like)
              )
        )
    )
    """
    
    
    # Total count
    count_sql = filtered_cte + "SELECT COUNT(1) AS total FROM filtered;"
    total_rows = db.db_read(count_sql, params)
    total = int(total_rows[0]["total"]) if total_rows else 0

    # Paging
    params_page = dict(params)
    params_page.update({
        "limit":  page_size,
        "offset": (page - 1) * page_size,
    })

    order_sql = _order_clause_filtered(sort, dir)

    page_sql = filtered_cte + f"""
        SELECT
        item_id,
        sku,
        name,
        unit,
        clearance_level,
        quantity,
        is_deleted,
        shelf_id,
        shelf_label,
        system_code,
        is_out,
        last_issue_ts,
        last_return_ts,
        last_movement_ts,
        (
            SELECT GROUP_CONCAT(h.holder, ', ')
            FROM current_out_by_holder h
            WHERE h.item_id = filtered.item_id
        ) AS current_holder
        FROM filtered
        ORDER BY {order_sql}
        LIMIT :limit OFFSET :offset;
        """

    rows = db.db_read(page_sql, params_page)

    items = [
    {
        "id":               r["item_id"],
        "sku":              r["sku"],
        "name":             r["name"],
        "unit":             r["unit"],
        "clearance_level":  r["clearance_level"],
        "quantity":         r["quantity"],
        "is_deleted":       r["is_deleted"],
        "shelf_id":         r["shelf_id"],
        "shelf_label":      r["shelf_label"],
        "system_code":      r["system_code"],
        "is_out":           r["is_out"],
        "last_issue_ts":    r["last_issue_ts"],
        "last_return_ts":   r["last_return_ts"],
        "last_movement_ts": r["last_movement_ts"],
        "current_holder":   r["current_holder"],
    }
    for r in rows
]


    return {
        "items": items,
        "page": page,
        "page_size": page_size,
        "total": total,
    }
       
#--------- Export Items -> Needs to be here otherwise this hits /items/item_id -> which fails since export is not a number    
@router.get("/items/export")
def export_items(
    q: str = Query("", description="FTS query over sku/name/tag/note + holder lookup"),
    status_filter: Literal["", "available", "checked_out"] = Query("", alias="status"),
    include_deleted: bool = Query(False),
    system_code: str = Query(""),
    shelf_label: str = Query(""),
    holder: str = Query(""),
    min_qty: Optional[int] = Query(None),
    max_qty: Optional[int] = Query(None),
    sort: str = Query("last_movement_ts"),
    dir: Literal["asc", "desc"] = Query("desc", alias="dir"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    user=Depends(get_current_user),
):
    sort = "sku"
    dir = "asc"
    
    def row_iter():
        # header
        header = [
            "id",
            "sku",
            "name",
            "unit",
            "clearance_level",
            "quantity",
            "system_code",
            "shelf_label",
            "is_deleted",
            "is_out",
            "last_issue_ts",
            "last_return_ts",
            "last_movement_ts",
            "tag",
            "note",
            "current_holder",
        ]
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(header)
        yield buf.getvalue()
        buf.seek(0)
        buf.truncate(0)

        # page through all results using the existing list_items function
        page_no = 1
        export_page_size = 500  # internal page size for export

        while True:
            page_data = list_items(
                q=q,
                status_filter=status_filter,
                include_deleted=include_deleted,
                system_code=system_code,
                shelf_label=shelf_label,
                holder=holder,
                min_qty=min_qty,
                max_qty=max_qty,
                sort=sort,
                dir=dir,
                page=page_no,
                page_size=export_page_size,
                user=user,
            )

            items = page_data["items"]
            total = page_data["total"]

            if not items:
                break

            for it in items:
                writer.writerow([
                    it["id"],
                    it.get("sku") or "",
                    it.get("name") or "",
                    it.get("unit") or "",
                    it.get("clearance_level") or "",
                    it.get("quantity") or 0,
                    it.get("system_code") or "",
                    it.get("shelf_label") or "",
                    it.get("is_deleted") or 0,
                    it.get("is_out") or 0,
                    it.get("last_issue_ts") or "",
                    it.get("last_return_ts") or "",
                    it.get("last_movement_ts") or "",
                    it.get("tag") or "",
                    it.get("note") or "",
                    it.get("current_holder") or "",
                ])

            yield buf.getvalue()
            buf.seek(0)
            buf.truncate(0)

            if page_no * export_page_size >= total:
                break
            page_no += 1

    filename = "items_export.csv"
    return StreamingResponse(
        row_iter(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
  
# ---------- Single item ----------
@router.get("/items/{item_id}", response_model=ItemDetailOut)
def get_item(item_id: int, user=Depends(get_current_user)):
    user_maxCL = _current_user_clearance(user)
    lim = None if user_maxCL is None else user_maxCL

    row = db.db_read(
        """
        SELECT
          i.id, i.sku, i.name, i.unit, i.clearance_level, i.quantity,
          i.tag, i.note, i.is_deleted, i.created_at, i.updated_at,
          isc.shelf_id, isc.shelf_label, isc.system_code, isc.is_out,
          isc.last_issue_ts, isc.last_return_ts, isc.last_movement_ts
        FROM items i
        LEFT JOIN item_status_current isc ON isc.item_id = i.id
        WHERE i.id = ?
          AND (? IS NULL OR i.clearance_level <= ?)
        """,
        (item_id, lim, lim),
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found or not permitted")
    r = row[0]
    return {
        "id": r["id"],
        "sku": r["sku"],
        "name": r["name"],
        "unit": r["unit"],
        "clearance_level": r["clearance_level"],
        "quantity": r["quantity"],
        "is_deleted": r["is_deleted"],
        "shelf_id": r["shelf_id"],
        "shelf_label": r["shelf_label"],
        "system_code": r["system_code"],
        "is_out": r["is_out"],
        "last_issue_ts": r["last_issue_ts"],
        "last_return_ts": r["last_return_ts"],
        "last_movement_ts": r["last_movement_ts"],
        "tag": r["tag"],
        "note": r["note"],
        "created_at": r["created_at"],
        "updated_at": r["updated_at"],
    }

# ---------- Create item ----------
def _enforce_clearance_for_create(user: dict, cl: int):
    maxCL = user.get("max_clearance_level")
    role = (user.get("role") or "").lower()
    if role == "admin":
        return
    if maxCL is None:
        return
    if cl > int(maxCL):
        raise HTTPException(
            status_code=403,
            detail=f"clearance_level {cl} exceeds your max_clearance_level {maxCL}",
        )

def _resolve_shelf_id(system_code: str, shelf_label: str) -> int:
    rows = db.db_read(
        """
        SELECT sh.id
        FROM shelves sh
        JOIN systems sys ON sys.id = sh.system_id
        WHERE LOWER(TRIM(sys.code)) = LOWER(TRIM(?))
          AND LOWER(TRIM(sh.label)) = LOWER(TRIM(?))
          AND COALESCE(sys.is_deleted,0) = 0
          AND COALESCE(sh.is_deleted,0) = 0
        LIMIT 1
        """,
        (system_code, shelf_label),
    )
    if not rows:
        raise HTTPException(
            status_code=400,
            detail="Invalid system_code or shelf_label (not found or deleted)",
        )
    return int(rows[0]["id"])

@router.post("/items", response_model=ItemOut, status_code=201)
def create_item(payload: ItemCreate, user=Depends(get_current_user)):
    _enforce_clearance_for_create(user, int(payload.clearance_level))

    shelf_id = _resolve_shelf_id(payload.system_code, payload.shelf_label)

    # ----------------- CREATE ITEM -----------------
    try:
        sql = """
            INSERT INTO items
            (sku, name, unit, clearance_level, quantity, shelf_id, tag, note,
             created_at, updated_at, is_deleted, added_by)
            VALUES
            (:sku, :name, :unit, :clearance_level, 0, :shelf_id, :tag, :note,
             datetime('now'), datetime('now'), 0, :added_by)
        """
        params = {
            "sku": payload.sku,
            "name": payload.name,
            "unit": payload.unit or None,
            "clearance_level": int(payload.clearance_level),
            "shelf_id": shelf_id,
            "tag": payload.tag or None,
            "note": payload.note or None,
            "added_by": (user.get("email") or user.get("name") or "system"),
        }
        item_id = db.db_write(sql, params)
        
        actor = user.get("email") or user.get("name") or "system"
        _log_item_event(
            item_id=item_id,
            kind="create",
            actor=actor,
            summary="Created item",
            details={
                "sku": payload.sku,
                "name": payload.name,
                "unit": payload.unit,
                "clearance_level": int(payload.clearance_level),
                "shelf_id": shelf_id,
                "tag": payload.tag,
                "note": payload.note,
            },
        )
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"failed to insert item: {e}")

    # Record initial receive movement if quantity > 0
    initial_qty = int(payload.quantity or 0)
    if initial_qty > 0:
        try:
            cols_rows = db.db_read("PRAGMA table_info('movements');")
            mov_cols = {r["name"] for r in cols_rows}

            cols = ["item_id", "qty", "type", "operator_name", "note"]
            values = {
                "item_id": item_id,
                "qty": initial_qty,
                "type": "receive",
                "operator_name": (user.get("email") or user.get("name") or "system"),
                "note": "initial receive on create"
                if not payload.note
                else f"create: {payload.note}",
            }

            if "shelf_id" in mov_cols and shelf_id is not None:
                # insert shelf_id before operator_name
                cols.insert(3, "shelf_id")
                values["shelf_id"] = shelf_id

            placeholders = ", ".join([f":{c}" for c in cols])
            col_list = ", ".join(cols)
            sql_mov = f"INSERT INTO movements ({col_list}) VALUES ({placeholders})"

            db.db_write(sql_mov, values)
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"item created but failed to record initial movement: {e}",
            )

    # ----------------- RETURN CREATED RECORD -----------------
    row = db.db_read(
        """
        SELECT i.id, i.sku, i.name, i.unit, i.clearance_level, i.quantity,
               COALESCE(sys.code,'') AS system_code,
               COALESCE(sh.label,'') AS shelf_label,
               i.is_deleted
        FROM items i
        LEFT JOIN shelves sh ON sh.id = i.shelf_id
        LEFT JOIN systems sys ON sys.id = sh.system_id
        WHERE i.id = ?
        """,
        (item_id,),
    )
    if not row:
        raise HTTPException(status_code=500, detail="created item not found")
    r = row[0]
    return ItemOut(
        id=int(r["id"]),
        sku=r["sku"],
        name=r["name"],
        unit=r["unit"],
        clearance_level=int(r["clearance_level"]),
        quantity=int(r["quantity"]),
        system_code=r["system_code"],
        shelf_label=r["shelf_label"],
        is_deleted=int(r["is_deleted"]),
    )

# ---------- Update / delete / restore ----------
@router.put("/items/{item_id}", response_model=ItemDetailOut, dependencies=[Depends(require_admin)])
def update_item(item_id: int, payload: ItemUpdate, user=Depends(require_admin)):
    old_rows = db.db_read("SELECT * FROM items WHERE id = ?", (item_id,))
    if not old_rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
    old = old_rows[0]

    sets: List[str] = []
    params: List[Any] = []
    diffs: Dict[str, Any] = {}

    #resolve target shelf 
    new_shelf_id: Optional[int] = None

    if payload.shelf_id is not None:
        #direct numeric shelf id
        sh = db.db_read("SELECT id FROM shelves WHERE id = ?", (payload.shelf_id,))
        if not sh:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shelf not found")
        new_shelf_id = payload.shelf_id

    elif payload.system_code is not None or payload.shelf_label is not None:
        if not (payload.system_code and payload.shelf_label):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Both system_code and shelf_label are required to change location.",
            )
        new_shelf_id = _resolve_shelf_id(payload.system_code, payload.shelf_label)


    if payload.name is not None:
        new_name = payload.name.strip()
        if new_name != old["name"]:
            sets.append("name = ?")
            params.append(new_name)
            diffs["name"] = {"old": old["name"], "new": new_name}

    if hasattr(payload, "sku") and payload.sku is not None:
        new_sku = payload.sku.strip() or None
        if new_sku != old["sku"]:
            sets.append("sku = ?")
            params.append(new_sku)
            diffs["sku"] = {"old": old["sku"], "new": new_sku}

    if payload.unit is not None:
        new_unit = (payload.unit or "").strip() or None
        if new_unit != old["unit"]:
            sets.append("unit = ?")
            params.append(new_unit)
            diffs["unit"] = {"old": old["unit"], "new": new_unit}

    if payload.clearance_level is not None:
        if payload.clearance_level < 1:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="clearance_level must be >= 1",
            )
        if payload.clearance_level != old["clearance_level"]:
            sets.append("clearance_level = ?")
            params.append(payload.clearance_level)
            diffs["clearance_level"] = {
                "old": old["clearance_level"],
                "new": payload.clearance_level,
            }


    if new_shelf_id is not None and new_shelf_id != old["shelf_id"]:
        sets.append("shelf_id = ?")
        params.append(new_shelf_id)
        diffs["location"] = {
            "old": {"shelf_id": old["shelf_id"]},
            "new": {"shelf_id": new_shelf_id},
        }

    if payload.tag is not None:
        new_tag = payload.tag or None
        if new_tag != old["tag"]:
            sets.append("tag = ?")
            params.append(new_tag)
            diffs["tag"] = {"old": old["tag"], "new": new_tag}

    if payload.note is not None:
        new_note = payload.note or None
        if new_note != old["note"]:
            sets.append("note = ?")
            params.append(new_note)
            diffs["note"] = {"old": old["note"], "new": new_note}

    #if nothing is changed
    if not sets:
        return get_item(item_id, user=user)

    params.append(item_id)
    db.db_write(
        f"UPDATE items SET {', '.join(sets)}, updated_at = datetime('now') WHERE id = ?",
        params,
    )

    if diffs:
        actor = user.get("email") or user.get("name") or "system"
        summary = "Updated " + ", ".join(diffs.keys())
        _log_item_event(
            item_id=item_id,
            kind="metadata_update",
            actor=actor,
            summary=summary,
            details=diffs,
        )

    return get_item(item_id, user=user)

@router.delete("/items/{item_id}", status_code=204, dependencies=[Depends(require_admin)])
def soft_delete_item(item_id: int, user=Depends(require_admin)):
    row = db.db_read("SELECT id, is_deleted FROM items WHERE id = ?", (item_id,))
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
    if row[0]["is_deleted"] == 1:
        return {"deleted": True}
    db.db_write(
        "UPDATE items SET is_deleted = 1, updated_at = datetime('now') WHERE id = ?",
        (item_id,),
    )

    actor = user.get("email") or user.get("name") or "system"
    _log_item_event(
        item_id=item_id,
        kind="soft_delete",
        actor=actor,
        summary="Soft-deleted item",
        details=None,
    )

    return {"deleted": True}

@router.post("/items/{item_id}/restore", response_model=ItemDetailOut, dependencies=[Depends(require_admin)])
def restore_item(item_id: int, user=Depends(require_admin)):
    found = db.db_read("SELECT id FROM items WHERE id = ?", (item_id,))
    if not found:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
    db.db_write(
        "UPDATE items SET is_deleted = 0, updated_at = datetime('now') WHERE id = ?",
        (item_id,),
    )

    actor = user.get("email") or user.get("name") or "system"
    _log_item_event(
        item_id=item_id,
        kind="restore",
        actor=actor,
        summary="Restored item",
        details=None,
    )

    return get_item(item_id, user=user)

# ---------- Item movements (detail drawer) ----------
@router.get("/items/{item_id}/movements")
def item_movements(item_id: int, user=Depends(get_current_user)):
    rows = db.db_read(
        """
        SELECT
          m.id,
          m.item_id,
          m.type        AS kind,
          m.qty         AS quantity,
          m.shelf_id,
          m.operator_name,
          m.holder      AS holder,
          m.due_at,
          m.note,
          m.timestamp,
          m.xfer_key
        FROM movements m
        WHERE m.item_id = ?
        ORDER BY m.timestamp DESC, m.id DESC
        LIMIT 50
        """,
        (item_id,),
    )
    return [dict(r) for r in rows]

@router.get("/items/{item_id}/timeline")
def item_timeline(item_id: int, user=Depends(get_current_user)):
    # Enforce clearance on this item
    user_maxCL = _current_user_clearance(user)
    lim = None if user_maxCL is None else user_maxCL

    row = db.db_read(
        "SELECT clearance_level FROM items WHERE id = ?",
        (item_id,),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Item not found")
    if lim is not None and row[0]["clearance_level"] > lim:
        raise HTTPException(status_code=404, detail="Item not found or not permitted")

    rows = db.db_read(
        """
        SELECT
          'movement'        AS source,
          m.timestamp       AS timestamp,
          m.type            AS kind,
          m.qty             AS quantity,
          m.shelf_id        AS shelf_id,
          m.holder          AS holder,
          m.note            AS note,
          m.operator_name   AS actor
        FROM movements m
        WHERE m.item_id = ?

        UNION ALL

        SELECT
          'event'           AS source,
          e.created_at      AS timestamp,
          e.kind            AS kind,
          NULL              AS quantity,
          NULL              AS shelf_id,
          NULL              AS holder,
          e.summary         AS note,
          e.actor           AS actor
        FROM item_events e
        WHERE e.item_id = ?

        ORDER BY timestamp DESC, kind ASC
        LIMIT 100
        """,
        (item_id, item_id),
    )
    return [dict(r) for r in rows]

# ---------- Import / Export ----------
@router.post("/items/import", status_code=201, dependencies=[Depends(require_admin)])
def import_items(file: UploadFile = File(...), user=Depends(get_current_user)):
    # --- parse CSV ---
    raw = file.file.read().decode("utf-8", errors="ignore")
    reader = csv.DictReader(io.StringIO(raw))
    headers = _row_lower_headers(reader.fieldnames)

    if headers[:len(REQUIRED_IMPORT_HEADERS)] != REQUIRED_IMPORT_HEADERS:
        expected = ",".join(REQUIRED_IMPORT_HEADERS)
        got = ",".join(headers)
        raise HTTPException(
            status_code=400,
            detail=f"Header mismatch. Expected '{expected}'. Found: '{got or '(empty)'}'",
        )

    rows_norm: List[Dict[str, Any]] = []
    errors: List[str] = []
    skipped = 0

    for idx, row in enumerate(reader, start=2):
        try:
            sku = (row.get("sku") or "").strip() or None
            name = (row.get("name") or "").strip()
            unit = (row.get("unit") or "units").strip()
            cl = int((row.get("clearance_level") or "0").strip())
            sysc = (row.get("system_code") or "").strip()
            shlbl = (row.get("shelf_label") or "").strip()
            qty = int((row.get("quantity") or "0").strip())
            tag = (row.get("tag") or "").strip() or None
            note = (row.get("note") or "").strip() or None

            if not sku or not name or not sysc or not shlbl:
                skipped += 1
                continue
            if cl < 1 or cl > 4:
                raise ValueError("clearance_level must be 1..4")
            if qty < 0:
                raise ValueError("quantity must be >= 0")

            rows_norm.append(
                {
                    "sku": sku,
                    "name": name,
                    "unit": unit,
                    "clearance_level": cl,
                    "system_code": sysc,
                    "shelf_label": shlbl,
                    "quantity": qty,
                    "tag": tag,
                    "note": note,
                    "_csv_row": idx,
                }
            )
        except Exception as e:
            errors.append(f"Row {idx}: {e}")
            skipped += 1

    if not rows_norm:
        return {"inserted": 0, "updated": 0, "skipped": skipped, "errors": errors}

    # --- resolve shelf_id for system_code, shelf_label ---
    wanted = sorted({(r["system_code"], r["shelf_label"]) for r in rows_norm})
    shelf_ids: Dict[tuple, int] = {}

    # fetch system ids for all needed codes
    sys_codes = sorted({sc for sc, _ in wanted})
    if sys_codes:
        q = f"""
        SELECT id, code
        FROM systems
        WHERE is_deleted = 0 AND code IN ({_qmarks(len(sys_codes))})
        """
        sys_rows = db.db_read(q, sys_codes)
        sys_id_by_code = {r["code"]: r["id"] for r in sys_rows}
    else:
        sys_id_by_code = {}

    for sysc, shlbl in wanted:
        sys_id = sys_id_by_code.get(sysc)
        if not sys_id:
            for r in [x for x in rows_norm if x["system_code"] == sysc]:
                errors.append(f"Row {r['_csv_row']}: System '{sysc}' not found or deleted")
            continue
        sh = db.db_read(
            "SELECT id FROM shelves WHERE system_id = ? AND label = ? AND is_deleted = 0",
            (sys_id, shlbl),
        )
        if sh:
            shelf_ids[(sysc, shlbl)] = sh[0]["id"]
        else:
            for r in [
                x
                for x in rows_norm
                if x["system_code"] == sysc and x["shelf_label"] == shlbl
            ]:
                errors.append(f"Row {r['_csv_row']}: Shelf '{sysc}/{shlbl}' not found or deleted")

    # keep only rows with a resolvable shelf_id
    rows_norm = [r for r in rows_norm if (r["system_code"], r["shelf_label"]) in shelf_ids]
    if not rows_norm:
        return {"inserted": 0, "updated": 0, "skipped": skipped, "errors": errors}

    # --- insert by SKU into items(shelf_id) schema ---
    db.db_write("CREATE UNIQUE INDEX IF NOT EXISTS ux_items_sku ON items(sku)")

    csv_skus = [r["sku"] for r in rows_norm]
    existing: set[str] = set()
    if csv_skus:
        q2 = f"SELECT sku FROM items WHERE sku IN ({_qmarks(len(csv_skus))})"
        for rr in db.db_read(q2, csv_skus):
            if rr["sku"]:
                existing.add(rr["sku"])

    predicted_inserts = sum(1 for r in rows_norm if r["sku"] not in existing)
    predicted_updates = len(rows_norm) - predicted_inserts

    up_rows: List[Sequence[Any]] = []
    for r in rows_norm:
        shelf_id = shelf_ids[(r["system_code"], r["shelf_label"])]
        up_rows.append(
            (
                r["sku"],
                r["name"],
                r["unit"],
                r["clearance_level"],
                shelf_id,
                r["quantity"],
                r["tag"],
                r["note"],
            )
        )

    sql = """
    INSERT INTO items (sku, name, unit, clearance_level, shelf_id, quantity, tag, note, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(sku) DO UPDATE SET
      name            = excluded.name,
      unit            = excluded.unit,
      clearance_level = excluded.clearance_level,
      shelf_id        = excluded.shelf_id,
      quantity        = excluded.quantity,
      tag             = excluded.tag,
      note            = excluded.note,
      updated_at      = CURRENT_TIMESTAMP
    """

    try:
        try:
            db.db_execmany(sql, up_rows)
        except AttributeError:
            conn = db._connect()
            try:
                with conn:
                    conn.executemany(sql, up_rows)
            finally:
                conn.close()
    except Exception as e:
        errors.append(f"Database error during import: {e}")
        return {
            "inserted": 0,
            "updated": 0,
            "skipped": skipped + len(rows_norm),
            "errors": errors,
        }

    return {
        "inserted": predicted_inserts,
        "updated": predicted_updates,
        "skipped": skipped,
        "errors": errors,
    }

def generate_movements_csv_for_bundle(
    system_code: str,
    shelf_label: str,
    user,
) -> bytes:
    sql = """
      SELECT
        m.id,
        m.item_id,
        i.sku,
        i.name,
        m.kind,
        m.qty,
        m.shelf_id,
        s.label      AS shelf_label,
        sys.code     AS system_code,
        m.actor_user_id,
        u.email      AS actor_email,
        m.note,
        m.timestamp
      FROM movements m
      JOIN items   i   ON m.item_id = i.id
      JOIN shelves s   ON m.shelf_id = s.id
      JOIN systems sys ON s.system_id = sys.id
      LEFT JOIN users u ON m.actor_user_id = u.id
      WHERE 1=1
    """
    params = []

    if system_code:
        sql += " AND sys.code = ?"
        params.append(system_code)

    if shelf_label:
        sql += " AND s.label = ?"
        params.append(shelf_label)

    sql += " ORDER BY m.timestamp DESC"

    rows = db.db_read(sql, tuple(params))

    buf = io.StringIO()
    writer = csv.writer(buf)

    writer.writerow([
        "id",
        "timestamp",
        "item_id",
        "sku",
        "name",
        "kind",
        "qty",
        "system_code",
        "shelf_label",
        "shelf_id",
        "actor_email",
        "note",
    ])

    for r in rows:
        writer.writerow([
            r["id"],
            r["timestamp"],
            r["item_id"],
            r["sku"],
            r["name"],
            r["kind"],
            r["qty"],
            r["system_code"],
            r["shelf_label"],
            r["shelf_id"],
            r["actor_email"] or "",
            r["note"] or "",
        ])

    return buf.getvalue().encode("utf-8")

@router.get("/import/bundle", dependencies=[Depends(require_admin)])
def export_bundle(
    q: str = Query(""),
    status_filter: Literal["", "available", "checked_out"] = Query("", alias="status"),
    include_deleted: bool = Query(False),
    system_code: str = Query(""),
    shelf_label: str = Query(""),
    holder: str = Query(""),
    min_qty: Optional[int] = Query(None),
    max_qty: Optional[int] = Query(None),
    user=Depends(get_current_user),
):
    items_bytes = generate_items_csv_for_bundle(
        q=q,
        status_filter=status_filter,
        include_deleted=include_deleted,
        system_code=system_code,
        shelf_label=shelf_label,
        holder=holder,
        min_qty=min_qty,
        max_qty=max_qty,
        user=user,
    )

    movements_bytes = generate_movements_csv_for_bundle(
        system_code=system_code,
        shelf_label=shelf_label,
        user=user,
    )

    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("items.csv", items_bytes)
        zf.writestr("movements.csv", movements_bytes)

    zip_buf.seek(0)

    return StreamingResponse(
        zip_buf,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="wms_export_bundle.zip"'},
    )