import uuid

from pydantic import BaseModel, ConfigDict, Field, model_validator


class LotEventCreate(BaseModel):
    lot_id: str = Field(..., max_length=64)
    recipe: str = Field(..., max_length=128)
    wafer_count: int = Field(..., ge=1)
    check_in_time: float = Field(..., description="Unix epoch seconds")
    check_out_time: float = Field(..., description="Unix epoch seconds")

    @model_validator(mode="after")
    def _checkout_after_checkin(self) -> "LotEventCreate":
        if self.check_out_time <= self.check_in_time:
            raise ValueError("check_out_time must be after check_in_time")
        return self


class LotEventUpdate(BaseModel):
    recipe: str | None = Field(None, max_length=128)
    wafer_count: int | None = Field(None, ge=1)
    check_in_time: float | None = None
    check_out_time: float | None = None

    @model_validator(mode="after")
    def _checkout_after_checkin(self) -> "LotEventUpdate":
        if self.check_in_time is not None and self.check_out_time is not None:
            if self.check_out_time <= self.check_in_time:
                raise ValueError("check_out_time must be after check_in_time")
        return self


class LotEventResponse(BaseModel):
    id: uuid.UUID
    signal_id: uuid.UUID
    lot_id: str
    recipe: str
    wafer_count: int
    check_in_time: float
    check_out_time: float

    model_config = ConfigDict(from_attributes=True)


class RowError(BaseModel):
    row: int
    lot_id: str | None
    reason: str


class BulkImportResult(BaseModel):
    imported: int
    skipped: int
    errors: list[RowError]
