"""
GitHub Actions adapter.

Environment variables read (set automatically by GitHub Actions + workflow):
  GITHUB_BASE_SHA       — base commit SHA of the PR
  GITHUB_HEAD_SHA       — head commit SHA of the PR
  GITHUB_REPOSITORY     — "owner/repo"
  GITHUB_TOKEN          — auto-provided by Actions for API calls
  PR_NUMBER             — pull request number (set explicitly in workflow step)
  PR_BODY               — pull request description (set explicitly in workflow step)

Required secrets (repository settings → Secrets):
  OPENAI_API_KEY or ANTHROPIC_API_KEY
"""
from __future__ import annotations

import os
import subprocess
import sys

import requests

from .base import ICIAdapter, PRContext


class GitHubAdapter(ICIAdapter):

    def load_context(self) -> PRContext:
        base = os.environ["GITHUB_BASE_SHA"]
        head = os.environ["GITHUB_HEAD_SHA"]

        diff = subprocess.check_output(
            ["git", "diff", base, head, "--unified=3"],
            text=True,
        )

        return PRContext(
            description=os.environ.get("PR_BODY", ""),
            diff=diff,
            base_ref=base,
            head_ref=head,
            pr_id=os.environ.get("PR_NUMBER"),
        )

    def post_comment(self, pr_id: str, body: str) -> None:
        token = os.environ.get("GITHUB_TOKEN", "")
        repo = os.environ.get("GITHUB_REPOSITORY", "")
        if not token or not repo:
            print("WARNING: GITHUB_TOKEN or GITHUB_REPOSITORY not set; skipping comment.", file=sys.stderr)
            return

        url = f"https://api.github.com/repos/{repo}/issues/{pr_id}/comments"
        resp = requests.post(
            url,
            json={"body": body},
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            timeout=15,
        )
        if not resp.ok:
            print(f"WARNING: GitHub comment POST failed {resp.status_code}: {resp.text[:200]}", file=sys.stderr)

    def set_exit_code(self, passed: bool) -> None:
        sys.exit(0 if passed else 1)
