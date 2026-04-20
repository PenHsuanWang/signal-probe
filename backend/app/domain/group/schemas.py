import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class GroupMemberResponse(BaseModel):
    id: uuid.UUID
    signal_id: uuid.UUID
    display_order: int
    channel_colors: dict[str, str]  # {ch_name: "#hex"}
    time_offset_s: float

    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def model_validate(cls, obj, **kwargs):  # type: ignore[override]
        import json

        instance = super().model_validate(obj, **kwargs)
        raw = getattr(obj, "channel_colors", None)
        if isinstance(raw, str):
            try:
                instance.channel_colors = json.loads(raw)
            except Exception:
                instance.channel_colors = {}
        elif not isinstance(raw, dict):
            instance.channel_colors = {}
        return instance


class GroupResponse(BaseModel):
    id: uuid.UUID
    owner_id: uuid.UUID
    name: str
    description: str | None
    members: list[GroupMemberResponse]
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class GroupCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None


class GroupUpdateRequest(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None


class GroupMemberUpsert(BaseModel):
    signal_id: uuid.UUID
    display_order: int = 0
    channel_colors: dict[str, str] = Field(default_factory=dict)
    time_offset_s: float = 0.0
