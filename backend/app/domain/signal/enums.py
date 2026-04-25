from enum import StrEnum


class SignalState(StrEnum):
    IDLE = "IDLE"
    ACTIVE = "ACTIVE"


class ProcessingStatus(StrEnum):
    AWAITING_CONFIG = "AWAITING_CONFIG"
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
