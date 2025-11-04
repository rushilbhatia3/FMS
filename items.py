# items.py
from fastapi import APIRouter, Depends, HTTPException, Path, Query
from grpc import Status
from pydantic import BaseModel, field_validator
from typing import Any, Dict, Optional
from auth import require_admin
import db

router = APIRouter(prefix="/api/items", tags=["items"])

SORT_MAP = {
    "name": "i.name",
    "created_at": "i.created_at",
    "clearance_level": "i.clearance_level",
    "location": "l.system_number, l.shelf",
    "last_movement_ts": "s.last_movement_ts",  # your UI's prev_checkout maps to this
}


def require_operator():
    # reuse your existing auth dependency; stub here
    class U: email="operator@example.com"
    return U()

class LocationIn(BaseModel):
    system_number: Optional[str] = None
    shelf: Optional[str] = None

class ItemIn(BaseModel):
    name: str
    tag: Optional[str] = None
    note: Optional[str] = None
    clearance_level: Optional[int] = 1
    height_mm: Optional[float] = None
    width_mm: Optional[float] = None
    depth_mm: Optional[float] = None
    location: Optional[LocationIn] = None
    sku: Optional[str] = None
    category: Optional[str] = None
    unit: Optional[str] = "units"

    @field_validator("clearance_level")
    def _cl(cls, v):
        if v is None: return 1
        if v < 1 or v > 4: raise ValueError("clearance_level must be 1..4")
        return v

class ItemPatch(BaseModel):
    name: Optional[str] = None
    tag: Optional[str] = None
    note: Optional[str] = None
    clearance_level: Optional[int] = None
    location: Optional[LocationIn] = None
    height_mm: Optional[float] = None
    width_mm:  Optional[float] = None
    depth_mm:  Optional[float] = None
    is_deleted: Optional[int] = None 
    @field_validator('clearance_level')
    def _cl(cls, v):
        if v is None: return v
        if v < 1 or v > 4: raise ValueError("clearance_level must be 1..4")
        return v

@router.get("/stats")
@router.get("/stats/")
def items_stats(include_deleted: bool = True):
    return db.items_stats(include_deleted=include_deleted)

@router.post("", status_code=201)
def create_item(payload: ItemIn, user=Depends(require_operator)):
    try:
        loc_id = None
        if payload.location and (payload.location.system_number or payload.location.shelf):
            loc_id = db.upsert_location(payload.location.system_number, payload.location.shelf)

        item_id = db.insert_item(
            name=payload.name, tag=payload.tag, note=payload.note,
            clearance_level=payload.clearance_level,
            height_mm=payload.height_mm, width_mm=payload.width_mm, depth_mm=payload.depth_mm,
            location_id=loc_id, added_by=getattr(user, "email", None),
            sku=payload.sku, category=payload.category, unit=payload.unit
        )
        item = db.get_item(item_id)
        if not item: raise RuntimeError("insert ok but get_item returned None")
        return item
    except Exception as e:
        # TEMP log
        import traceback; traceback.print_exc()
        raise HTTPException(500, f"/api/items failed: {e}")

@router.get("")
def list_items(
    q: str = "",
    include_deleted: bool = False,
    status: str = Query("", pattern="^(|out|available)$"),
    sort: str = "created_at",
    dir: str = Query("desc", pattern="^(asc|desc)$"),
    page: int = 1,
    page_size: int = 50,
):
    try:
        return db.list_items(
            q=q,
            page=page,
            page_size=page_size,
            include_deleted=include_deleted,
            sort=sort,
            dir=dir,
            status=status,
        )
    except Exception as e:
        from fastapi import HTTPException
        raise HTTPException(500, f"/api/items failed: {e}")
    
    
@router.get("/{item_id}")
def get_item(item_id: int):
    item = db.get_item(item_id)
    if not item:
        raise HTTPException(404, "Not found")
    return item

@router.patch("/{item_id}/restore")
def restore_item(item_id: int = Path(...), user = Depends(require_admin)):
    c = db._connect(); cur = c.cursor()
    cur.execute("UPDATE items SET is_deleted = 0, updated_at = datetime('now') WHERE id = ?", (item_id,))
    c.commit(); c.close()
    return {"id": item_id, "deleted": False}

@router.delete("/{item_id}")
def soft_delete_item(item_id: int = Path(...), user=Depends(require_admin)):
    c = db._connect(); cur = c.cursor()

    # exists?
    cur.execute("SELECT is_deleted FROM items WHERE id=? LIMIT 1", (item_id,))
    row = cur.fetchone()
    if not row:
        c.close()
        raise HTTPException(404, "Item not found.")

    # last movement
    cur.execute("""
      WITH last_move AS (
        SELECT m.item_id, m.movement_type, m.timestamp
        FROM movements m
        JOIN (SELECT item_id, MAX(timestamp) ts FROM movements GROUP BY item_id) t
          ON t.item_id = m.item_id AND t.ts = m.timestamp
      )
      SELECT movement_type FROM last_move WHERE item_id = ?
    """, (item_id,))
    lr = cur.fetchone()
    if lr and lr["movement_type"] == "out":
        c.close()
        raise HTTPException(409, "Cannot archive: item is currently checked out (last movement is 'out').")

    # (optional) also block when quantity > 0
    cur.execute("SELECT quantity FROM items WHERE id=?", (item_id,))
    qty = int(cur.fetchone()["quantity"] or 0)
    if qty > 0:
        c.close()
        raise HTTPException(409, f"Cannot archive: quantity is {qty}. Return or adjust to 0 first.")

    if int(row["is_deleted"]) == 1:
        c.close()
        return {"id": item_id, "deleted": True}

    cur.execute("UPDATE items SET is_deleted=1, updated_at=datetime('now') WHERE id=?", (item_id,))
    c.commit(); c.close()
    return {"id": item_id, "deleted": True}


@router.patch("/{item_id}")
def update_item(item_id:int, payload: ItemPatch, user=Depends(require_operator)):
    loc_id = None
    if payload.location and (payload.location.system_number or payload.location.shelf):
        loc_id = db.upsert_location(payload.location.system_number, payload.location.shelf)
    db.update_item(
        item_id=item_id,
        name=payload.name,
        tag=payload.tag,
        note=payload.note,
        clearance_level=payload.clearance_level,
        height_mm=payload.height_mm,
        width_mm=payload.width_mm,
        depth_mm=payload.depth_mm,
        location_id=loc_id
    )
    item = db.get_item(item_id)
    if not item: raise HTTPException(404, "Not found")
    return item