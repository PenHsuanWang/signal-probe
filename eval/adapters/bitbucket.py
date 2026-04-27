"""
Bitbucket Pipelines adapter.

Environment variables set automatically by Bitbucket Pipelines:
  BITBUCKET_WORKSPACE            — workspace slug (e.g., "mycompany")
  BITBUCKET_REPO_SLUG            — repository slug (e.g., "signal-probe")
  BITBUCKET_PR_ID                — pull request numeric ID
  BITBUCKET_COMMIT               — HEAD commit SHA
  BITBUCKET_PR_DESTINATION_BRANCH — target/base branch name

Required secrets (repository settings → Repository variables):
  BITBUCKET_ACCESS_TOKEN         — project/repo access token with pullrequest:write + repository:read
  OPENAI_API_KEY or ANTHROPIC_API_KEY

NOTE: BITBUCKET_PR_DESCRIPTION is NOT a built-in pipeline variable.
The adapter fetches the PR description via the Bitbucket REST API 2.0.
The diff is also fetched via the API to avoid git history depth issues in pipelines.

bitbucket-pipelines.yml example:
  image: python:3.12-slim
  pipelines:
    pull-requests:
      '**':
        - step:
            name: LLM Judge
            script:
              - pip install -r eval/requirements.txt
              - python -m eval.runner
"""
from __future__ import annotations

import os
import sys

import requests

from .base import ICIAdapter, PRContext


class BitbucketAdapter(ICIAdapter):

    def _base_url(self) -> str:
        ws = os.environ["BITBUCKET_WORKSPACE"]
        repo = os.environ["BITBUCKET_REPO_SLUG"]
        return f"https://api.bitbucket.org/2.0/repositories/{ws}/{repo}"

    def _auth_headers(self) -> dict[str, str]:
        token = os.environ.get("BITBUCKET_ACCESS_TOKEN", "")
        if not token:
            print("ERROR: BITBUCKET_ACCESS_TOKEN is not set.", file=sys.stderr)
            sys.exit(1)
        return {"Authorization": f"Bearer {token}"}

    def load_context(self) -> PRContext:
        pr_id = os.environ["BITBUCKET_PR_ID"]
        head = os.environ["BITBUCKET_COMMIT"]

        # Fetch PR metadata (description, destination branch) via API
        pr_resp = requests.get(
            f"{self._base_url()}/pullrequests/{pr_id}",
            headers=self._auth_headers(),
            timeout=15,
        )
        pr_resp.raise_for_status()
        pr_data = pr_resp.json()

        description: str = pr_data.get("description", "")
        dest_branch: str = pr_data["destination"]["branch"]["name"]

        # Fetch the unified diff via Bitbucket API
        # Returns a raw diff; max ~20 MB which is plenty for code review
        diff_resp = requests.get(
            f"{self._base_url()}/pullrequests/{pr_id}/diff",
            headers=self._auth_headers(),
            timeout=30,
        )
        diff_resp.raise_for_status()
        diff_text: str = diff_resp.text

        return PRContext(
            description=description,
            diff=diff_text,
            base_ref=dest_branch,
            head_ref=head,
            pr_id=pr_id,
        )

    def post_comment(self, pr_id: str, body: str) -> None:
        """
        Bitbucket REST API 2.0: POST /pullrequests/{id}/comments
        Body must use the {"content": {"raw": "..."}} envelope.
        Bitbucket renders the "raw" field as Markdown.
        """
        resp = requests.post(
            f"{self._base_url()}/pullrequests/{pr_id}/comments",
            headers=self._auth_headers(),
            json={"content": {"raw": body}},
            timeout=15,
        )
        if not resp.ok:
            print(
                f"WARNING: Bitbucket comment POST failed {resp.status_code}: {resp.text[:200]}",
                file=sys.stderr,
            )

    def set_exit_code(self, passed: bool) -> None:
        sys.exit(0 if passed else 1)
