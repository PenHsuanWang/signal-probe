"""Pydantic v2 output schema for the LLM Judge scorecard."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import json

from pydantic import BaseModel, Field


class DimensionScore(BaseModel):
    score: int = Field(..., ge=0, le=10)
    justification: str
    violations: list[str] = Field(default_factory=list)


class VibeCheck(BaseModel):
    passed: bool
    justification: str
    issues: list[str] = Field(default_factory=list)


class JudgeScorecard(BaseModel):
    # ── Core evaluation dimensions ─────────────────────────────────────────────
    instruction_adherence: DimensionScore
    architectural_alignment: DimensionScore
    code_quality: DimensionScore
    vibe_check: VibeCheck

    # ── Verdict ────────────────────────────────────────────────────────────────
    overall_verdict: str   # "APPROVED" | "NEEDS_WORK" | "BLOCKED"
    summary: str

    # ── Metadata (populated by runner, not LLM) ────────────────────────────────
    judge_model: str = ""
    prompt_version: str = ""
    evaluated_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    pr_id: str | None = None
    head_ref: str | None = None
    base_ref: str | None = None

    @property
    def overall_score(self) -> float:
        """Weighted composite score. Architectural alignment is weighted highest."""
        return round(
            self.instruction_adherence.score * 0.35
            + self.architectural_alignment.score * 0.40
            + self.code_quality.score * 0.25,
            1,
        )

    def all_violations(self) -> list[str]:
        return (
            self.instruction_adherence.violations
            + self.architectural_alignment.violations
            + self.code_quality.violations
            + self.vibe_check.issues
        )

    def save(self, directory: str) -> Path:
        """Persist to a timestamped JSON file for regression tracking (Phase 5)."""
        out_dir = Path(directory)
        out_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        filename = f"scorecard_{ts}_pr{self.pr_id or 'local'}.json"
        path = out_dir / filename
        path.write_text(self.model_dump_json(indent=2))
        return path

    @classmethod
    def load(cls, path: str | Path) -> "JudgeScorecard":
        return cls.model_validate(json.loads(Path(path).read_text()))
