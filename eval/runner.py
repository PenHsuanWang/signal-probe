"""
eval.runner — platform auto-detection entrypoint.

Run as:
  python -m eval.runner                         # auto-detect CI platform
  python -m eval.runner --description "..." \\  # force CLI mode
    [--base-ref HEAD~1] [--head-ref HEAD] [--diff-file path.diff] [--pr-id 42]

Platform detection order (first match wins):
  1. GITHUB_ACTIONS   env var → GitHubAdapter
  2. BITBUCKET_WORKSPACE      → BitbucketAdapter
  3. GITLAB_CI                → GitLabAdapter
  4. CLI args                 → CLIAdapter  (fallback)
"""
from __future__ import annotations

import argparse
import os
import sys

from eval.judge import core
from eval.adapters.base import ICIAdapter


def _detect_adapter() -> ICIAdapter:
    from eval.adapters.github import GitHubAdapter
    from eval.adapters.bitbucket import BitbucketAdapter
    from eval.adapters.gitlab import GitLabAdapter
    from eval.adapters.cli import CLIAdapter

    if os.getenv("GITHUB_ACTIONS") == "true":
        print("ℹ️  Detected: GitHub Actions", file=sys.stderr)
        return GitHubAdapter()

    if os.getenv("BITBUCKET_WORKSPACE"):
        print("ℹ️  Detected: Bitbucket Pipelines", file=sys.stderr)
        return BitbucketAdapter()

    if os.getenv("GITLAB_CI") == "true":
        print("ℹ️  Detected: GitLab CI", file=sys.stderr)
        return GitLabAdapter()

    # Fallback: parse CLI arguments
    print("ℹ️  No CI platform detected — using CLI adapter", file=sys.stderr)
    parser = argparse.ArgumentParser(
        description="signal-probe LLM Judge: evaluate a git diff against architectural rules.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--description", "-d",
        required=True,
        help="PR/commit description — the task the agent was asked to perform.",
    )
    parser.add_argument(
        "--base-ref", default="HEAD~1",
        help="Base git ref for the diff (default: HEAD~1).",
    )
    parser.add_argument(
        "--head-ref", default="HEAD",
        help="Head git ref for the diff (default: HEAD).",
    )
    parser.add_argument(
        "--diff-file",
        help="Path to a pre-captured unified diff file (overrides --base-ref / --head-ref).",
    )
    parser.add_argument(
        "--pr-id",
        help="PR/MR numeric ID (optional; used for comment posting in hybrid setups).",
    )
    args = parser.parse_args()

    return CLIAdapter(
        description=args.description,
        base_ref=args.base_ref,
        head_ref=args.head_ref,
        diff_file=args.diff_file,
        pr_id=args.pr_id,
    )


def main() -> None:
    adapter = _detect_adapter()
    core.run(adapter)


if __name__ == "__main__":
    main()
