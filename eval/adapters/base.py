"""Abstract CI platform adapter interface."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class PRContext:
    """Everything the judge core needs about the PR. Zero CI platform knowledge."""
    description: str        # PR body / commit message describing the task
    diff: str               # Full unified diff text (git diff --unified=3)
    base_ref: str           # Base branch name or commit SHA
    head_ref: str           # Head branch name or commit SHA
    pr_id: str | None       # PR/MR numeric ID — used to post comment back


class ICIAdapter(ABC):
    """
    Implement this interface once per CI platform.
    The judge core (eval/judge/core.py) depends ONLY on this interface.
    """

    @abstractmethod
    def load_context(self) -> PRContext:
        """
        Read PR metadata and the git diff from the current CI environment.
        Called once at the start of a judge run.
        """
        ...

    @abstractmethod
    def post_comment(self, pr_id: str, body: str) -> None:
        """
        Post the formatted scorecard as a comment on the PR/MR.
        Implementations may be no-ops (e.g., CLI adapter prints to stdout instead).
        """
        ...

    @abstractmethod
    def set_exit_code(self, passed: bool) -> None:
        """
        Signal pass/fail to the CI runner.
        Typically sys.exit(0) on pass, sys.exit(1) on failure.
        """
        ...
