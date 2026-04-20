from fastapi import APIRouter

from app.presentation.api.v1.endpoints import auth, groups, signals, users

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(signals.router, prefix="/signals", tags=["signals"])
api_router.include_router(groups.router, prefix="/groups", tags=["groups"])
