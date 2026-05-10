# AI Agent Evaluation Harness: "Vibe Coding" Robustness Plan

## 1. Objective
To construct a comprehensive evaluation (eval) harness that measures the working performance, robustness, and "vibe coding" effectiveness of the AI coding agent in the `signal-probe` project.

## 2. The Four Pillars of the Evaluation Harness

### A. Deterministic CI & Code Quality Checks (The Baseline)
Before evaluating subjective "vibes", the code must run. This layer ensures the agent produces syntactically correct, safe, and type-safe code.
*   **Static Analysis Evals:**
    *   **Backend:** Automatically run `ruff check`, `ruff format --check`, and `mypy` or `pyright` on agent-generated Python code.
    *   **Frontend:** Automatically run `eslint` and `tsc --noEmit` on React/TypeScript code.
*   **Unit/Integration Testing:**
    *   Measure the agent's pass rate on the existing test suite (`pytest` for FastAPI, Vitest/Jest for React).
    *   *Eval Metrics:* "Does the agent break existing tests?" and "Can the agent write passing tests for its own new features?"
*   **Coverage Deltas:** Track if the agent maintains or improves test coverage, penalizing changes that lack appropriate test coverage.

### B. LLM-as-a-Judge (The "Vibe" & Adherence Checker)
Use a secondary, highly capable LLM evaluator to grade the primary agent's output based on qualitative and architectural metrics.
*   **Instruction Adherence:** Did the agent solve the user's core problem as stated in the prompt, or did it get distracted/hallucinate?
*   **Architectural Alignment:** Does the code strictly follow `ARCHITECTURE.md` and `GEMINI.md`? (e.g., enforcing the Storage Adapter Pattern, proper generic typing, and SOLID principles).
*   **"Vibe" Scoring:** Prompt the Judge LLM to evaluate if UI changes or code abstractions "make sense" contextually, feel modern, and align with the user's broader intent.

### C. Trajectory & Efficiency Analysis (The Process)
Evaluate *how* the agent arrived at the solution to optimize its speed and cost.
*   **Turn Count & Token Efficiency:** How many conversational turns and tokens did the agent consume? High counts often indicate confusion or getting stuck in loops.
*   **Tool Usage Accuracy:** Did the agent use the correct, most efficient tools? (e.g., using `grep_search` efficiently vs. dumping whole files into context unnecessarily).
*   **Error Recovery Rate:** When a build or test fails, how effectively does the agent read the logs, diagnose the root cause, and successfully self-correct?
*   **Context Management:** Did the agent pull in irrelevant files that confused it?

### D. End-to-End (E2E) & Visual Regression Testing (The User Experience)
Ensuring the application actually works and looks correct from an end-user perspective.
*   **Playwright / Cypress:** Run automated UI interactions to verify the agent didn't break core user workflows (e.g., uploading signal data, viewing spectrogram charts).
*   **Visual Regression Testing (Chromatic / Percy):** Capture visual snapshots of the React UI before and after the agent's changes.
    *   *Eval Metrics:* Did the agent break the Tailwind CSS layout? Does the new component visually match the existing design system?

## 3. Recommended Implementation Plan

To operationalize the four pillars and transition this eval harness into a production-grade MLOps system, follow these five actionable implementation phases.

### Phase 1: Secure & Isolated Sandbox Setup
To ensure reproducibility and protect the host system, every evaluation run must execute within an ephemeral sandbox.
*   **Docker Container Orchestration:** Use `docker-compose.yml` to spin up a fresh, isolated copy of the entire application stack (FastAPI backend, React frontend, database, and MinIO) for each evaluation run.
*   **Volume Mounting Strategy:** Mount the source code directory as a read-only volume initially, and copy it to a strictly mutable workspace for the agent to modify. This prevents destructive regressions on the host repo.
*   **Networking:** Isolate the network to prevent the agent from accidentally calling external production APIs, mocking necessary external services within the sandbox.

### Phase 2: Evaluation Dataset Construction
Build a golden benchmark suite of ~20-50 typical "vibe coding" tasks specific to `signal-probe`. Define these tasks in a structured `YAML` or `JSON` schema.

**Example `task.yaml` Schema:**
```yaml
task_id: "add_lttb_chart"
category: "frontend_feature"
instruction: "Add a new LTTB downsampling chart to the SignalsPage."
target_branch_or_commit: "main" # The starting state of the repo
validation_script: "npm run test:e2e -- --grep 'LTTB Chart'"
expected_metrics:
  max_turns: 15
  max_tokens: 30000
```

### Phase 3: The Evaluation Runner CLI
Develop a Python-based orchestrator (e.g., `eval_runner.py`) that manages the entire lifecycle of an experiment.
1.  **Initialize Sandbox:** Bring up the Docker containers for the specific `task_id` starting state.
2.  **Agent Execution:** Inject the task instruction and system prompts. Start the agent run.
3.  **Trajectory Capture:** Record all agent tool calls, file reads, and shell commands into a `trajectory.json` trace file.
4.  **Deterministic Verification:** Once the agent finishes, automatically trigger the CI pipeline (`ruff`, `eslint`, `pytest`, `playwright`) within the sandbox and record the exit codes.

### Phase 4: LLM-as-a-Judge Implementation
For subjective and architectural evaluations, use a secondary LLM with a strictly defined rubric. Provide the judge with the agent's final Git diff and the recorded trajectory.

**Judge Prompts should evaluate:**
*   **Instruction Adherence (0-10):** Did the agent fulfill the core requirement without hallucinating scope?
*   **Architectural Alignment (0-10):** Did the agent strictly follow the Storage Adapter Pattern and SOLID principles as defined in `ARCHITECTURE.md`?
*   **Vibe Check (Pass/Fail):** Do the UI changes look polished and align with the existing Tailwind CSS design system? (Can be combined with Visual Regression Testing results).

### Phase 5: Continuous Regression & Version Tracking
Single-run scores are insufficient for continuous improvement. You must track performance across experiments to measure progress.
*   **Versioned Scorecards:** Store the aggregated results of all pillars into a `scorecard.json` (or a central database like SQLite/PostgreSQL) tagged with the agent's underlying model (e.g., `claude-3.5-sonnet`, `gpt-4o`) and prompt version.
*   **Regression Detection CI/CD:** Implement a script that compares the current scorecard against a historical baseline. If the "Error Recovery Rate" drops or "Token Efficiency" worsens by more than 10%, flag the pipeline as a regression (Regression Failure).
