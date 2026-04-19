from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm

from app.application.user.service import UserService
from app.core.security import create_access_token
from app.domain.user.schemas import Token, UserCreate, UserResponse
from app.presentation.api.dependencies import DbSession

router = APIRouter()


@router.post("/login", response_model=Token)
async def login_access_token(
    session: DbSession, form_data: Annotated[OAuth2PasswordRequestForm, Depends()]
) -> Token:
    user_service = UserService(session)
    user = await user_service.authenticate(
        email=form_data.username, password=form_data.password
    )
    if not user:
        raise HTTPException(status_code=400, detail="Incorrect email or password")
    elif not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")

    return Token(access_token=create_access_token(user.id))


@router.post("/register", response_model=UserResponse)
async def register_user(session: DbSession, user_in: UserCreate) -> UserResponse:
    user_service = UserService(session)
    try:
        user = await user_service.create_user(user_in)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e),
        )
    return user
