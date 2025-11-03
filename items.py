# items.py
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
from typing import Optional
import db

router = APIRouter(prefix="/api/items", tags=["items"])

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

@router.post("", status_code=201)
def create_item(payload: ItemIn, user=Depends(require_operator)):
    loc_id = None
    if payload.location and (payload.location.system_number or payload.location.shelf):
        loc_id = db.upsert_location(payload.location.system_number, payload.location.shelf)

    item_id = db.insert_item(
        name=payload.name,
        tag=payload.tag,
        note=payload.note,
        clearance_level=payload.clearance_level,
        height_mm=payload.height_mm,
        width_mm=payload.width_mm,
        depth_mm=payload.depth_mm,
        location_id=loc_id,
        added_by=getattr(user, "email", None),
        sku=payload.sku,
        category=payload.category,
        unit=payload.unit
    )
    item = db.get_item(item_id)
    if not item:
        raise HTTPException(500, "Failed to create item")
    return item

@router.get("")
def list_items(
    q: str = Query("", description="search in name/tag/note/sku"),
    include_deleted: bool = False,
    page: int = 1,
    page_size: int = 100
):
    return db.list_items(q=q, page=page, page_size=page_size, include_deleted=include_deleted)

@router.get("/{item_id}")
def get_item(item_id: int):
    item = db.get_item(item_id)
    if not item:
        raise HTTPException(404, "Not found")
    return item
