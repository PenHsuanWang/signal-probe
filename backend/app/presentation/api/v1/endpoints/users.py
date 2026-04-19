from fastapi import APIRouter

from app.domain.user.schemas import UserResponse
from app.presentation.api.dependencies import CurrentUser

router = APIRouter()


@router.get("/me", response_model=UserResponse)
async def read_user_me(current_user: CurrentUser) -> UserResponse:
    return current_user
