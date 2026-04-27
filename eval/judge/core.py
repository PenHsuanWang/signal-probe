"""
Core judge logic — entirely platform-agnostic.

Flow:
  1. Load config from eval/.judge.yml
  2. Ask the adapter for PRContext (diff + description)
  3. Parse the diff into a ChangeSummary
  4. Build and send the prompt to the judge LLM
  5. Parse the structured JSON response into a JudgeScorecard
  6. Check thresholds
  7. Format and post the PR comment via the adapter
  8. Optionally save the scorecard for regression tracking
  9. Signal pass/fail to the CI runner via adapter.set_exit_code()
"""
from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from .diff_parser import ChangeSummary, parse_diff
from .prompts import (
    BACKEND_SECTION_HEADER,
    EVALUATION_TEMPLATE,
    FRONTEND_SECTION_HEADER,
    PROMPT_VERSION,
    SYSTEM_PROMPT,
)
from .rubric import BACKEND_INVARIANTS, FRONTEND_INVARIANTS, VIBE_RULES
from .scorecard import JudgeScorecard
from ..adapters.base import ICIAdapter, PRContext

# ── Configuration ──────────────────────────────────────────────────────────────

_CONFIG_PATH = Path(__file__).parent.parent / ".judge.yml"


@dataclass
class JudgeConfig:
    model: str = "gpt-4o"
    temperature: float = 0.0
    max_diff_chars: int = 40_000
    prompt_version: str = PROMPT_VERSION

    threshold_instruction: int = 6
    threshold_architecture: int = 6
    threshold_quality: int = 5
    vibe_check_blocks: bool = False
    fail_on_blocked: bool = True

    post_comment: bool = True
    save_scorecard: bool = True
    scorecard_dir: str = ".judge-scores"
    soft_gate: bool = False


def load_config(path: Path = _CONFIG_PATH) -> JudgeConfig:
    if not path.exists():
        return JudgeConfig()
    raw: dict[str, Any] = yaml.safe_load(path.read_text()) or {}
    j = raw.get("judge", {})
    t = raw.get("thresholds", {})
    b = raw.get("behavior", {})
    return JudgeConfig(
        model=j.get("model", "gpt-4o"),
        temperature=float(j.get("temperature", 0)),
        max_diff_chars=int(j.get("max_diff_chars", 40_000)),
        prompt_version=j.get("prompt_version", PROMPT_VERSION),
        threshold_instruction=int(t.get("instruction_adherence", 6)),
        threshold_architecture=int(t.get("architectural_alignment", 6)),
        threshold_quality=int(t.get("code_quality", 5)),
        vibe_check_blocks=bool(t.get("vibe_check_blocks", False)),
        fail_on_blocked=bool(t.get("fail_on_blocked", True)),
        post_comment=bool(b.get("post_comment", True)),
        save_scorecard=bool(b.get("save_scorecard", True)),
        scorecard_dir=b.get("scorecard_dir", ".judge-scores"),
        soft_gate=bool(b.get("soft_gate", False)),
    )


# ── LLM providers ─────────────────────────────────────────────────────────────

def _call_openai(system: str, user: str, cfg: JudgeConfig) -> str:
    try:
        from openai import OpenAI  # type: ignore[import]
    except ImportError:
        print("ERROR: openai package not installed. Run: pip install openai", file=sys.stderr)
        sys.exit(1)

    client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
    response = client.chat.completions.create(
        model=cfg.model,
        temperature=cfg.temperature,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )
    return response.choices[0].message.content or ""


def _call_anthropic(system: str, user: str, cfg: JudgeConfig) -> str:
    try:
        import anthropic  # type: ignore[import]
    except ImportError:
        print("ERROR: anthropic package not installed. Run: pip install anthropic", file=sys.stderr)
        sys.exit(1)

    client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
    message = client.messages.create(
        model=cfg.model,
        max_tokens=2048,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    return message.content[0].text


def _call_llm(system: str, user: str, cfg: JudgeConfig) -> str:
    """Route to the correct provider based on model name prefix."""
    if cfg.model.startswith("claude"):
        return _call_anthropic(system, user, cfg)
    return _call_openai(system, user, cfg)


# ── Prompt builder ─────────────────────────────────────────────────────────────

def _build_prompt(ctx: PRContext, summary: ChangeSummary, cfg: JudgeConfig) -> str:
    diff = ctx.diff
    if len(diff) > cfg.max_diff_chars:
        diff = diff[: cfg.max_diff_chars] + "\n\n... [diff truncated — too large to display fully]"

    backend_section = BACKEND_SECTION_HEADER if summary.has_backend else ""
    frontend_section = FRONTEND_SECTION_HEADER if summary.has_frontend else ""

    backend_rules = BACKEND_INVARIANTS if summary.has_backend else "(no backend changes)"
    frontend_rules = FRONTEND_INVARIANTS if summary.has_frontend else "(no frontend changes)"
    vibe = VIBE_RULES if summary.has_frontend else "(no frontend changes — skip vibe check)"

    return EVALUATION_TEMPLATE.format(
        pr_description=ctx.description or "(no PR description provided)",
        changed_files_summary=summary.as_prompt_table(),
        backend_section=backend_section,
        frontend_section=frontend_section,
        diff=diff,
        backend_rules=backend_rules,
        frontend_rules=frontend_rules,
        vibe_rules=vibe,
    )


# ── Scorecard parsing ──────────────────────────────────────────────────────────

def _parse_scorecard(raw_json: str, ctx: PRContext, cfg: JudgeConfig) -> JudgeScorecard:
    try:
        data = json.loads(raw_json)
    except json.JSONDecodeError as exc:
        print(f"ERROR: LLM returned invalid JSON: {exc}", file=sys.stderr)
        print("Raw response:", raw_json[:500], file=sys.stderr)
        sys.exit(1)

    try:
        card = JudgeScorecard.model_validate(data)
    except Exception as exc:
        print(f"ERROR: Scorecard schema validation failed: {exc}", file=sys.stderr)
        sys.exit(1)

    # Stamp metadata
    card.judge_model = cfg.model
    card.prompt_version = cfg.prompt_version
    card.pr_id = ctx.pr_id
    card.head_ref = ctx.head_ref
    card.base_ref = ctx.base_ref
    return card


# ── Threshold checking ─────────────────────────────────────────────────────────

def _check_thresholds(card: JudgeScorecard, cfg: JudgeConfig) -> tuple[bool, list[str]]:
    failures: list[str] = []

    if card.instruction_adherence.score < cfg.threshold_instruction:
        failures.append(
            f"instruction_adherence {card.instruction_adherence.score}/10 "
            f"< threshold {cfg.threshold_instruction}"
        )
    if card.architectural_alignment.score < cfg.threshold_architecture:
        failures.append(
            f"architectural_alignment {card.architectural_alignment.score}/10 "
            f"< threshold {cfg.threshold_architecture}"
        )
    if card.code_quality.score < cfg.threshold_quality:
        failures.append(
            f"code_quality {card.code_quality.score}/10 "
            f"< threshold {cfg.threshold_quality}"
        )
    if cfg.vibe_check_blocks and not card.vibe_check.passed:
        failures.append("vibe_check failed (configured to block)")
    if cfg.fail_on_blocked and card.overall_verdict == "BLOCKED":
        failures.append("overall_verdict is BLOCKED")

    return len(failures) == 0, failures


# ── PR comment formatter ───────────────────────────────────────────────────────

def _format_comment(card: JudgeScorecard, failures: list[str]) -> str:
    verdict_icon = {"APPROVED": "✅", "NEEDS_WORK": "⚠️", "BLOCKED": "🚫"}.get(
        card.overall_verdict, "❓"
    )
    vibe_icon = "✅" if card.vibe_check.passed else "❌"

    score_bar = _score_bar(card.overall_score)

    lines = [
        f"## {verdict_icon} LLM Judge — {card.overall_verdict}",
        f"**Overall score: {card.overall_score}/10** {score_bar}",
        f"*Model: {card.judge_model} · Prompt v{card.prompt_version}*",
        "",
        f"> {card.summary}",
        "",
        "| Dimension | Score | Justification |",
        "|-----------|:-----:|---------------|",
        f"| Instruction Adherence | **{card.instruction_adherence.score}/10** | {card.instruction_adherence.justification} |",
        f"| Architectural Alignment | **{card.architectural_alignment.score}/10** | {card.architectural_alignment.justification} |",
        f"| Code Quality | **{card.code_quality.score}/10** | {card.code_quality.justification} |",
        f"| UI Vibe Check | {vibe_icon} {'Pass' if card.vibe_check.passed else 'Fail'} | {card.vibe_check.justification} |",
    ]

    all_issues = card.all_violations()
    if all_issues:
        lines += ["", "<details>", "<summary>🔍 Issues found</summary>", ""]
        for issue in all_issues:
            lines.append(f"- {issue}")
        lines.append("</details>")

    if failures:
        lines += ["", "---", "**CI Gate Failures:**"]
        for f in failures:
            lines.append(f"- ❌ {f}")

    return "\n".join(lines)


def _score_bar(score: float) -> str:
    filled = round(score)
    return "█" * filled + "░" * (10 - filled)


# ── Main entrypoint ────────────────────────────────────────────────────────────

def run(adapter: ICIAdapter) -> None:
    """
    Full judge lifecycle. Works identically on any CI platform.
    The adapter is the only platform-specific piece.
    """
    cfg = load_config()

    print("🔍 Loading PR context...", file=sys.stderr)
    ctx = adapter.load_context()

    print(f"📂 Parsing diff ({len(ctx.diff):,} chars)...", file=sys.stderr)
    summary = parse_diff(ctx.diff)
    print(
        f"   {len(summary.files)} files changed "
        f"(+{summary.total_added} / -{summary.total_removed} lines)",
        file=sys.stderr,
    )

    print(f"🤖 Calling judge LLM ({cfg.model})...", file=sys.stderr)
    prompt = _build_prompt(ctx, summary, cfg)
    raw_response = _call_llm(SYSTEM_PROMPT, prompt, cfg)

    print("📊 Parsing scorecard...", file=sys.stderr)
    card = _parse_scorecard(raw_response, ctx, cfg)

    passed, failures = _check_thresholds(card, cfg)
    comment = _format_comment(card, failures)

    # Always print to stdout (useful for CLI mode / debugging)
    print(comment)

    if cfg.post_comment and ctx.pr_id:
        print("💬 Posting comment to PR...", file=sys.stderr)
        try:
            adapter.post_comment(ctx.pr_id, comment)
        except Exception as exc:
            print(f"WARNING: Failed to post comment: {exc}", file=sys.stderr)

    if cfg.save_scorecard:
        saved = card.save(cfg.scorecard_dir)
        print(f"💾 Scorecard saved to {saved}", file=sys.stderr)

    if not passed:
        print("\n🚫 Judge FAILED CI thresholds:", file=sys.stderr)
        for f in failures:
            print(f"   • {f}", file=sys.stderr)

    if cfg.soft_gate:
        print("ℹ️  soft_gate=true: overriding exit code to 0", file=sys.stderr)
        adapter.set_exit_code(True)
    else:
        adapter.set_exit_code(passed)
