from fastapi import APIRouter, Depends
from typing import Optional, Dict, Any

import db
from auth import get_current_user

router = APIRouter(tags=["stats"])


def _user_max_cl(user: Dict[str, Any]) -> Optional[int]:
    if user["role"] == "admin":
        return None
    return user.get("max_clearance_level")


@router.get("/stats/summary")
def stats_summary(user=Depends(get_current_user)):
    maxcl = _user_max_cl(user)

    sql = """
    SELECT
      COUNT(*) AS total_items,
      SUM(CASE WHEN is_deleted = 0 THEN 1 ELSE 0 END) AS active_items,
      SUM(CASE WHEN is_deleted = 1 THEN 1 ELSE 0 END) AS deleted_items,
      SUM(CASE WHEN is_deleted = 0 AND is_out = 0 THEN 1 ELSE 0 END) AS available_items,
      SUM(CASE WHEN is_deleted = 0 AND is_out = 1 THEN 1 ELSE 0 END) AS checked_out_items
    FROM item_status_current
    WHERE (? IS NULL OR clearance_level <= ?)
    """
    rows = db.db_read(sql, (maxcl, maxcl))
    row = rows[0] if rows else None

    if not row:
        return {
            "total_items": 0,
            "active_items": 0,
            "deleted_items": 0,
            "available_items": 0,
            "checked_out_items": 0,
        }

    def as_int(name: str) -> int:
        v = row[name]
        return int(v) if v is not None else 0

    return {
        "total_items": as_int("total_items"),
        "active_items": as_int("active_items"),
        "deleted_items": as_int("deleted_items"),
        "available_items": as_int("available_items"),
        "checked_out_items": as_int("checked_out_items"),
    }
