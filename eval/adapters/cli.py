"""
Standalone CLI adapter — no CI platform required.

All inputs are passed via command-line arguments or read from a diff file.
Scorecard is printed to stdout.
Useful for:
  - Local development / manual review
  - Jenkins / bare shell scripts
  - Pre-commit hooks
  - Any CI platform not listed in the other adapters

Usage:
  python -m eval.runner \\
    --description "Add STFT window lock UI" \\
    --base-ref origin/dev \\
    --head-ref HEAD

  # Or supply a pre-captured diff file:
  python -m eval.runner \\
    --description "Fix lint errors" \\
    --diff-file changes.diff
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from .base import ICIAdapter, PRContext


class CLIAdapter(ICIAdapter):

    def __init__(
        self,
        description: str,
        base_ref: str = "HEAD~1",
        head_ref: str = "HEAD",
        diff_file: str | None = None,
        pr_id: str | None = None,
    ) -> None:
        self._description = description
        self._base_ref = base_ref
        self._head_ref = head_ref
        self._diff_file = diff_file
        self._pr_id = pr_id

    def load_context(self) -> PRContext:
        if self._diff_file:
            diff = Path(self._diff_file).read_text()
        else:
            diff = subprocess.check_output(
                ["git", "diff", self._base_ref, self._head_ref, "--unified=3"],
                text=True,
            )
        return PRContext(
            description=self._description,
            diff=diff,
            base_ref=self._base_ref,
            head_ref=self._head_ref,
            pr_id=self._pr_id,
        )

    def post_comment(self, pr_id: str, body: str) -> None:
        # No platform to post to — the comment is already printed to stdout by core.run()
        pass

    def set_exit_code(self, passed: bool) -> None:
        sys.exit(0 if passed else 1)
