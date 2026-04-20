## Summary

> _One or two sentences describing **what** this PR does and **why**._

Closes #<!-- issue number -->

---

## Type of Change

<!-- Check all that apply -->

- [ ] `feat:` — New feature or endpoint
- [ ] `fix:` — Bug fix
- [ ] `refactor:` — Internal restructuring, no behaviour change
- [ ] `docs:` — HANDSBOOK, README, or docstring-only changes
- [ ] `test:` — Tests only
- [ ] `chore:` — Tooling, CI config, dependency bumps

---

## Changes

<!-- Bullet list of what was added, changed, or removed -->

-

---

## Backend Checklist

> Skip if this PR contains no backend changes.

- [ ] All new code uses **strict Python type hints** (no `Any` without justification)
- [ ] **Domain Layer** has zero framework imports (`fastapi`, `sqlalchemy`, etc.)
- [ ] New business logic lives in **Application or Domain layers**, not in routers
- [ ] New API responses are validated by a **Pydantic v2 schema**
- [ ] `ruff check app/` and `ruff format --check app/` pass locally
- [ ] No new secrets or credentials in source code

---

## Frontend Checklist

> Skip if this PR contains no frontend changes.

- [ ] No TypeScript errors (`npm run build` passes locally)
- [ ] ESLint passes (`npm run lint` passes locally)
- [ ] New components follow the **dark zinc-950/900** theme and `JetBrains Mono` monospace font
- [ ] Charts use **WebGL/Plotly** with scientific visual standards (no decorative chart junk, deep red `#ef4444` for OOC markers)
- [ ] New Tailwind classes use `brand-400`/`brand-500` tokens from `index.css @theme` for brand colours

---

## Testing

- [ ] Existing tests still pass
- [ ] New logic is covered by tests (or explain why not below)

> **Explanation (if untested):**

---

## Screenshots / Recordings

> Add screenshots or screen recordings for **any UI or visualization change**.
> Delete this section if not applicable.

| Before | After |
|--------|-------|
|        |       |

---

## How to Test

> Step-by-step instructions for a reviewer to verify this change locally.

1. `docker compose up -d` (or start backend + frontend manually)
2.
3.

---

## Notes for Reviewer

> Anything the reviewer should pay special attention to, known trade-offs, or follow-up work.
