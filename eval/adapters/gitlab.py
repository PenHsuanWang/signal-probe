"""
GitLab CI/CD adapter.

Environment variables set automatically by GitLab CI when running on a
merge request pipeline (rules: if: $CI_PIPELINE_SOURCE == "merge_request_event"):
  CI_MERGE_REQUEST_DIFF_BASE_SHA — base commit SHA
  CI_COMMIT_SHA                  — head commit SHA
  CI_MERGE_REQUEST_DESCRIPTION   — MR description (available in MR pipelines)
  CI_MERGE_REQUEST_IID           — MR internal ID (for posting notes)
  CI_PROJECT_ID                  — numeric project ID

Required CI/CD variables (Settings → CI/CD → Variables):
  GITLAB_TOKEN         — project/personal access token with api scope (post MR notes)
  GITLAB_API_URL       — GitLab instance API base (default: https://gitlab.com/api/v4)
  OPENAI_API_KEY or ANTHROPIC_API_KEY

.gitlab-ci.yml example:
  llm-judge:
    image: python:3.12-slim
    stage: review
    rules:
      - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    script:
      - pip install -r eval/requirements.txt
      - python -m eval.runner
"""
from __future__ import annotations

import os
import subprocess
import sys

import requests

from .base import ICIAdapter, PRContext


class GitLabAdapter(ICIAdapter):

    def _api_base(self) -> str:
        return os.environ.get("GITLAB_API_URL", "https://gitlab.com/api/v4")

    def _headers(self) -> dict[str, str]:
        token = os.environ.get("GITLAB_TOKEN", "")
        if not token:
            print("ERROR: GITLAB_TOKEN is not set.", file=sys.stderr)
            sys.exit(1)
        return {"PRIVATE-TOKEN": token}

    def load_context(self) -> PRContext:
        base = os.environ["CI_MERGE_REQUEST_DIFF_BASE_SHA"]
        head = os.environ["CI_COMMIT_SHA"]

        diff = subprocess.check_output(
            ["git", "diff", base, head, "--unified=3"],
            text=True,
        )

        return PRContext(
            description=os.environ.get("CI_MERGE_REQUEST_DESCRIPTION", ""),
            diff=diff,
            base_ref=base,
            head_ref=head,
            pr_id=os.environ.get("CI_MERGE_REQUEST_IID"),
        )

    def post_comment(self, pr_id: str, body: str) -> None:
        """GitLab MR notes endpoint."""
        project_id = os.environ.get("CI_PROJECT_ID", "")
        if not project_id:
            print("WARNING: CI_PROJECT_ID not set; skipping comment.", file=sys.stderr)
            return

        url = f"{self._api_base()}/projects/{project_id}/merge_requests/{pr_id}/notes"
        resp = requests.post(
            url,
            headers=self._headers(),
            json={"body": body},
            timeout=15,
        )
        if not resp.ok:
            print(
                f"WARNING: GitLab MR note POST failed {resp.status_code}: {resp.text[:200]}",
                file=sys.stderr,
            )

    def set_exit_code(self, passed: bool) -> None:
        sys.exit(0 if passed else 1)
