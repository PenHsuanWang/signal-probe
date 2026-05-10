"""
Parse a git unified diff into a structured ChangeSummary.

Responsibilities:
- Extract changed file paths and classify them by area (backend / frontend / config / test).
- Detect which architectural layers are touched (domain / application / infrastructure /
  presentation — backend-only).
- Count lines added and removed per file.
- Build a human-readable summary table for injection into the judge prompt.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum


class FileArea(str, Enum):
    BACKEND_DOMAIN = "backend:domain"
    BACKEND_APPLICATION = "backend:application"
    BACKEND_INFRASTRUCTURE = "backend:infrastructure"
    BACKEND_PRESENTATION = "backend:presentation"
    BACKEND_CORE = "backend:core"
    BACKEND_TEST = "backend:test"
    BACKEND_OTHER = "backend:other"
    FRONTEND_COMPONENT = "frontend:component"
    FRONTEND_PAGE = "frontend:page"
    FRONTEND_HOOK = "frontend:hook"
    FRONTEND_CONTEXT = "frontend:context"
    FRONTEND_LIB = "frontend:lib"
    FRONTEND_TEST = "frontend:test"
    FRONTEND_OTHER = "frontend:other"
    EVAL = "eval"
    CI_CONFIG = "ci"
    DOCS = "docs"
    ROOT_CONFIG = "config"
    OTHER = "other"


@dataclass
class FileChange:
    path: str
    area: FileArea
    lines_added: int = 0
    lines_removed: int = 0

    @property
    def net_change(self) -> int:
        return self.lines_added - self.lines_removed


@dataclass
class ChangeSummary:
    files: list[FileChange] = field(default_factory=list)

    # Derived flags used by the prompt builder
    has_backend: bool = False
    has_frontend: bool = False
    has_domain_changes: bool = False
    has_presentation_changes: bool = False
    has_test_changes: bool = False

    @property
    def total_added(self) -> int:
        return sum(f.lines_added for f in self.files)

    @property
    def total_removed(self) -> int:
        return sum(f.lines_removed for f in self.files)

    def as_prompt_table(self) -> str:
        """Return a compact table for injection into the judge prompt."""
        if not self.files:
            return "(no changed files detected)"
        rows = ["| File | Area | +Lines | -Lines |", "|------|------|--------|--------|"]
        for f in self.files:
            rows.append(f"| `{f.path}` | {f.area.value} | +{f.lines_added} | -{f.lines_removed} |")
        rows.append(f"| **TOTAL** | | **+{self.total_added}** | **-{self.total_removed}** |")
        return "\n".join(rows)


# ── Classification helpers ─────────────────────────────────────────────────────

def _classify(path: str) -> FileArea:
    p = path.lower()

    # Eval / CI
    if p.startswith("eval/"):
        return FileArea.EVAL
    if p.startswith(".github/") or p.startswith(".gitlab-ci") or p.startswith("bitbucket-pipelines"):
        return FileArea.CI_CONFIG

    # Docs
    if any(p.endswith(ext) for ext in (".md", ".rst", ".txt")) and not p.startswith("backend/tests"):
        return FileArea.DOCS

    # Root config
    if p in ("docker-compose.yml", "pyproject.toml", "ruff.toml", ".judge.yml") or p.startswith("."):
        return FileArea.ROOT_CONFIG

    # Backend classification
    if p.startswith("backend/"):
        rest = p[len("backend/"):]
        if rest.startswith("tests/") or "/tests/" in rest:
            return FileArea.BACKEND_TEST
        if "app/domain/" in rest:
            return FileArea.BACKEND_DOMAIN
        if "app/application/" in rest:
            return FileArea.BACKEND_APPLICATION
        if "app/infrastructure/" in rest:
            return FileArea.BACKEND_INFRASTRUCTURE
        if "app/presentation/" in rest:
            return FileArea.BACKEND_PRESENTATION
        if "app/core/" in rest:
            return FileArea.BACKEND_CORE
        return FileArea.BACKEND_OTHER

    # Frontend classification
    if p.startswith("frontend/"):
        rest = p[len("frontend/"):]
        if "tests/" in rest or rest.endswith(".spec.ts") or rest.endswith(".test.ts") or rest.endswith(".test.tsx"):
            return FileArea.FRONTEND_TEST
        if "src/components/" in rest:
            return FileArea.FRONTEND_COMPONENT
        if "src/pages/" in rest:
            return FileArea.FRONTEND_PAGE
        if "src/hooks/" in rest:
            return FileArea.FRONTEND_HOOK
        if "src/context/" in rest:
            return FileArea.FRONTEND_CONTEXT
        if "src/lib/" in rest or "src/types/" in rest:
            return FileArea.FRONTEND_LIB
        return FileArea.FRONTEND_OTHER

    return FileArea.OTHER


# ── Parser ─────────────────────────────────────────────────────────────────────

_FILE_HEADER = re.compile(r"^diff --git a/(.+?) b/(.+)$")
_HUNK_STAT   = re.compile(r"^@@")


def parse_diff(diff_text: str) -> ChangeSummary:
    """Parse a unified diff string into a ChangeSummary."""
    summary = ChangeSummary()
    current: FileChange | None = None

    for line in diff_text.splitlines():
        m = _FILE_HEADER.match(line)
        if m:
            current = FileChange(path=m.group(2), area=_classify(m.group(2)))
            summary.files.append(current)
            continue

        if current is None:
            continue

        if line.startswith("+") and not line.startswith("+++"):
            current.lines_added += 1
        elif line.startswith("-") and not line.startswith("---"):
            current.lines_removed += 1

    # Populate derived flags
    areas = {f.area for f in summary.files}
    summary.has_backend = any(a.value.startswith("backend") for a in areas)
    summary.has_frontend = any(a.value.startswith("frontend") for a in areas)
    summary.has_domain_changes = FileArea.BACKEND_DOMAIN in areas
    summary.has_presentation_changes = FileArea.BACKEND_PRESENTATION in areas
    summary.has_test_changes = FileArea.BACKEND_TEST in areas or FileArea.FRONTEND_TEST in areas

    return summary
