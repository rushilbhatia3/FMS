# status.py
from fastapi import APIRouter, Depends, HTTPException, Query, status
from typing import Optional, List, Dict, Any

import db
from auth import get_current_user

router = APIRouter(tags=["status"])


def _user_max_cl(user: Dict[str, Any]) -> Optional[int]:
    return None if user["role"] == "admin" else user.get("max_clearance_level")


@router.get("/status/current_out_by_holder")
def current_out_by_holder(
    holder: Optional[str] = Query(None),
    item_id: Optional[int] = Query(None),
    user=Depends(get_current_user),
):
    maxcl = _user_max_cl(user)
    sql = """
    SELECT h.item_id, i.sku, i.name, h.holder, -h.qty_outstanding AS qty_out
    FROM current_out_by_holder h
    JOIN items i ON i.id = h.item_id
    WHERE (? IS NULL OR h.holder = ?)
      AND (? IS NULL OR h.item_id = ?)
      AND (? IS NULL OR i.clearance_level <= ?)
    ORDER BY i.name COLLATE NOCASE, h.holder
    """
    rows = db.db_read(
        sql,
        (
            holder, holder,
            item_id, item_id,
            None if maxcl is None else maxcl, None if maxcl is None else maxcl,
        ),
    )
    return [dict(r) for r in rows]


@router.get("/status/item_status/{item_id}")
def item_status(item_id: int, user=Depends(get_current_user)):
    maxcl = _user_max_cl(user)
    row = db.db_read(
        """
        SELECT *
        FROM item_status_current
        WHERE item_id = ?
          AND (? IS NULL OR clearance_level <= ?)
        """,
        (item_id, None if maxcl is None else maxcl, None if maxcl is None else maxcl),
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found or not permitted")
    return dict(row[0])


@router.get("/status/overdue")
def overdue(
    holder: Optional[str] = Query(None),
    user=Depends(get_current_user),
):
    maxcl = _user_max_cl(user)
    sql = """
    SELECT h.item_id, i.sku, i.name, h.holder, -h.qty_outstanding AS qty_out,
           MIN(m.due_at) AS earliest_due_at
    FROM current_out_by_holder h
    JOIN items i ON i.id = h.item_id
    JOIN movements m ON m.item_id = h.item_id AND m.kind='issue' AND m.holder = h.holder
    WHERE m.due_at IS NOT NULL
      AND m.due_at < datetime('now')
      AND (? IS NULL OR h.holder = ?)
      AND (? IS NULL OR i.clearance_level <= ?)
    GROUP BY h.item_id, i.sku, i.name, h.holder, h.qty_outstanding
    ORDER BY earliest_due_at ASC
    """
    rows = db.db_read(
        sql,
        (
            holder, holder,
            None if maxcl is None else maxcl, None if maxcl is None else maxcl,
        ),
    )
    return [dict(r) for r in rows]
