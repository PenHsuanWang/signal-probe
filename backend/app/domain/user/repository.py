import logging
import uuid

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictException, InfrastructureException
from app.domain.user.models import User
from app.domain.user.schemas import UserCreate

logger = logging.getLogger(__name__)


class UserRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_by_email(self, email: str) -> User | None:
        try:
            result = await self.session.execute(select(User).where(User.email == email))
            return result.scalars().first()
        except SQLAlchemyError as exc:
            logger.error("Database error fetching user by email: %s", exc)
            raise InfrastructureException(
                "Database error while fetching user."
            ) from exc

    async def get_by_id(self, user_id: uuid.UUID) -> User | None:
        try:
            result = await self.session.execute(select(User).where(User.id == user_id))
            return result.scalars().first()
        except SQLAlchemyError as exc:
            logger.error("Database error fetching user %s: %s", user_id, exc)
            raise InfrastructureException(
                "Database error while fetching user."
            ) from exc

    async def create(self, user_in: UserCreate, hashed_password: str) -> User:
        db_obj = User(
            email=user_in.email,
            hashed_password=hashed_password,
            is_active=user_in.is_active,
            is_superuser=user_in.is_superuser,
        )
        self.session.add(db_obj)
        try:
            await self.session.commit()
            await self.session.refresh(db_obj)
        except IntegrityError as exc:
            await self.session.rollback()
            raise ConflictException(
                "User creation failed: a user with this email already exists."
            ) from exc
        except SQLAlchemyError as exc:
            await self.session.rollback()
            logger.error("Database error creating user: %s", exc)
            raise InfrastructureException(
                "Database error while creating user."
            ) from exc
        return db_obj
