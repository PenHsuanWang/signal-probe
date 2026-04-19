from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_password_hash, verify_password
from app.domain.user.models import User
from app.domain.user.repository import UserRepository
from app.domain.user.schemas import UserCreate


class UserService:
    def __init__(self, session: AsyncSession):
        self.repo = UserRepository(session)

    async def authenticate(self, email: str, password: str) -> User | None:
        user = await self.repo.get_by_email(email)
        if not user:
            return None
        if not verify_password(password, user.hashed_password):
            return None
        return user

    async def create_user(self, user_in: UserCreate) -> User:
        existing_user = await self.repo.get_by_email(user_in.email)
        if existing_user:
            raise ValueError("User with this email already exists.")
        hashed_password = get_password_hash(user_in.password)
        return await self.repo.create(user_in, hashed_password)
