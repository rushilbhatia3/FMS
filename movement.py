from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
import db

router = APIRouter(prefix="/api/movements", tags=["movements"])

def require_operator():
    class U: email = "operator@example.com"
    return U()

class MovementIn(BaseModel):
    item_id: int
    movement_type: str  # 'in' | 'out' | 'adjust' | 'transfer'
    quantity: int
    holder_name: str | None = None
    operator_name: str | None = None
    note: str | None = None

    @field_validator("movement_type")
    @classmethod
    def check_type(cls, v):
        v = v.lower()
        if v not in ("in","out","adjust","transfer"):
            raise ValueError("invalid movement_type")
        return v

@router.post("")
def create_movement(payload: MovementIn):
    # enforce signed quantity convention if you want:
    # out => negative, in => positive
    if payload.movement_type == "out":
        if not payload.holder_name or not payload.holder_name.strip():
            raise HTTPException(status_code=400, detail="holder_name is required for 'out'")
        if payload.quantity > 0:
            payload.quantity = -payload.quantity
    elif payload.movement_type == "in":
        if payload.quantity < 0:
            payload.quantity = -payload.quantity

    sql = """
      INSERT INTO movements (item_id, movement_type, quantity, operator_name, holder_name, note)
      VALUES (:item_id, :movement_type, :quantity, :operator_name, :holder_name, :note)
    """
    db.execute(sql, {
        "item_id": payload.item_id,
        "movement_type": payload.movement_type,
        "quantity": payload.quantity,
        "operator_name": payload.operator_name or "admin",
        "holder_name": payload.holder_name,
        "note": payload.note,
    })
    return {"ok": True}
@router.get("", summary="Recent movements for an item")
def list_movements(item_id: int = Query(...), limit: int = 50):
    try:
        return db.list_movements(item_id=item_id, limit=limit)
    except Exception as e:
        raise HTTPException(400, f"list movements failed: {e}")
