from enum import StrEnum


class SignalState(StrEnum):
    IDLE = "IDLE"
    ACTIVE = "ACTIVE"
    OOC = "OOC"


class ProcessingStatus(StrEnum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
