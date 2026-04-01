from fastapi import APIRouter, HTTPException
from app.supabase_client import supabase
from app.schemas import UserProfileUpdate

router = APIRouter()

@router.get("/user-profiles/{user_profile_id}")
def get_user_profile(user_profile_id: str):
    response = (
        supabase.table("user_profiles")
        .select("*")
        .eq("id", user_profile_id)
        .execute()
    )

    if not response.data:
        raise HTTPException(status_code=404, detail="User profile not found")

    return response.data[0]

@router.patch("/user-profiles/{user_profile_id}")
def update_user_profile(user_profile_id: str, payload: UserProfileUpdate):
    updates = payload.dict(exclude_none=True)

    response = (
        supabase.table("user_profiles")
        .update(updates)
        .eq("id", user_profile_id)
        .execute()
    )

    if not response.data:
        raise HTTPException(status_code=404, detail="User profile not found")

    return response.data[0]
