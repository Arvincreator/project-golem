# Agent Harness Engineering Design (Agent-Only v1)

Date: 2026-04-03  
Owner: Project Golem runtime/core

## 1. Confirmed Decisions

This design is locked to the decisions confirmed during brainstorming:

1. Implementation strategy: in-process event-sourced harness.
2. Delivery order: Trace+Replay -> Eval+Gate -> Permission+Audit.
3. Phase 1 scope: all `agent_*` flows only (including `planning_auto` and API-triggered flows).
4. Gate policy: branch-tiered.
   - `develop`: warning-only.
   - `main`: hard gate.
5. KPI priority: success rate and operational stability.
6. Baseline strategy: hybrid.
   - Track rolling baseline and fixed baseline at the same time.
   - Hard gate uses rolling degradation.
7. Hard gate threshold on `main`: fail when success-rate degradation is greater than 5%.

## 2. Context and Problem

Project Golem already has strong multi-agent primitives:

1. Coordinator/worker protocol and strict phase order.
2. Agent and task kernels with persistence, status transitions, and audit data.
3. Runtime event bridge and dashboard real-time streaming.

Current gap: evidence exists, but no complete harness pipeline for reproducible trace -> replay -> regression gate.  
Result: regressions can still pass if they are not covered by current test slices.

## 3. Objectives

## 3.1 Primary Objective

Build an agent harness pipeline that makes multi-agent behavior:

1. Traceable.
2. Replayable.
3. Gateable in CI.

## 3.2 Success Metrics (v1)

1. Replay pass rate for agent traces.
2. Agent flow success rate.
3. Recovery pass rate after restart/recovery scenarios.
4. Regression detection rate on CI (via replay/gate failures).

## 4. Scope

## 4.1 In Scope (v1)

1. `agent_*` lifecycle tracing (session, worker, wait, stop, resume, message, orchestration decisions).
2. Trace persistence and retrieval.
3. Deterministic replay engine (`strict` and `lenient` modes).
4. Baseline comparison and CI policy wiring.
5. Permission/audit field hardening for agent mutation lineage.

## 4.2 Out of Scope (v1)

1. Full `task_*` trace/replay.
2. Command approval full-chain harness.
3. Provider billing reconciliation-grade accounting.
4. Sidecar harness service split.

## 5. Architecture

## 5.1 Overview

1. Runtime emits normalized harness events from existing agent state transitions.
2. Events append to per-trace JSONL files (event-sourced log).
3. Replay engine re-evaluates events using invariant pack.
4. Compare engine checks current results vs rolling/fixed baselines.
5. CI gate consumes compare output by branch policy.

## 5.2 Core Components

1. `src/harness/HarnessEventSchema.js`
   - Canonical schema validator/normalizer for all harness events.
2. `src/harness/HarnessTraceStore.js`
   - Append-only trace writer/reader.
3. `src/harness/HarnessReplayEngine.js`
   - Deterministic replay runtime with strict/lenient modes.
4. `src/harness/HarnessInvariantPack.js`
   - Replay invariants and structural validation rules.
5. `scripts/harness/replay-agent-trace.js`
   - CLI to replay one or many traces and emit report JSON.
6. `scripts/harness/compare-baseline.js`
   - Compare current metrics against rolling/fixed baselines.

## 5.3 Integration Points

1. `src/managers/AgentKernel.js`
   - Emit session/worker transition events with actor/source/usage/version lineage.
2. `src/core/CoordinatorEngine.js`
   - Emit orchestration decision events (`nextAction`, blockers, current phase).
3. `src/runtime/RuntimeController.js` and `apps/runtime/worker.js`
   - Emit runtime-level events for recovery/resume/restart boundaries.

## 6. Harness Event Model

Each event must include:

1. `eventId`
2. `ts`
3. `traceId`
4. `golemId`
5. `sessionId`
6. `workerId` (nullable)
7. `action`
8. `phase`
9. `status`
10. `actor`
11. `source`
12. `idempotencyKey` (nullable)
13. `version`
14. `usageSnapshot`
15. `errorCode` (nullable)
16. `payloadDigest`
17. `correlationId`

Notes:

1. `traceId` is stable for one session lifecycle and must survive recovery.
2. `correlationId` links related operations across runtime/kernel/coordinator layers.
3. `payloadDigest` prevents silent payload drift between trace and replay.

## 7. Trace Storage and Layout

Directory layout:

`logs/harness/agent-traces/<golemId>/<yyyy-mm-dd>/<traceId>.jsonl`

Storage rules:

1. Append-only writes, no in-place rewrite.
2. Monotonic ordering by append time.
3. Optional segment rolling when file exceeds configured size.
4. Reader supports stream mode for CI memory safety.

## 8. Replay and Invariants

## 8.1 Replay Modes

1. `strict`
   - Exact structural correctness required.
   - Any illegal transition or missing phase boundary fails.
2. `lenient`
   - Allows non-critical metadata drift and timing noise.
   - Still fails on state-machine violations and illegal orchestration.

## 8.2 Invariant Pack (v1)

1. Enforce phase chain:
   `research -> synthesis -> implementation -> verification`.
2. No worker spawn after terminal session.
3. Worker/session transitions must obey kernel transition rules.
4. Recovery path must end in either:
   - resumable state with valid continuation, or
   - explicit terminal state with reason.
5. Orchestration decisions must be consistent with observed state.

## 9. CI and Gate Policy

## 9.1 Branch Policy

1. `develop`
   - Run replay + baseline compare.
   - Publish warnings only.
2. `main`
   - Hard fail on structural replay errors.
   - Hard fail on rolling success-rate degradation > 5%.
   - Fixed baseline degradation is warning-only.

## 9.2 Baseline Strategy (Hybrid)

1. Rolling baseline:
   - Latest passing baseline from `main`.
2. Fixed baseline:
   - Curated reference baseline version, manually updated when needed.
3. Compare output includes both tracks for observability.

## 10. Implementation Phases

## 10.1 Phase 1: Trace + Replay

Deliverables:

1. Harness schema and trace store.
2. Agent instrumentation in kernel/coordinator/runtime.
3. Replay engine and invariant pack.
4. Replay report output (`replay_report.json`).

## 10.2 Phase 2: Eval + Gate

Deliverables:

1. Baseline compare runner (`baseline_compare.json`).
2. CI branch-aware policy integration.
3. Warning/hard-fail behavior aligned to branch policy.

## 10.3 Phase 3: Permission + Audit Hardening

Deliverables:

1. Enforce required lineage fields on mutation-related events.
2. Replay checks for decision chain integrity.
3. Audit summary output from traces.

## 11. Test Plan

## 11.1 Unit

1. Schema normalization and validation behavior.
2. Trace append/read ordering and integrity.
3. Replay engine strict/lenient branch behavior.
4. Invariant checks for phase/transition/recovery.

## 11.2 Integration

1. `planning_auto` full agent trace and strict replay pass.
2. API-driven `agent_*` flow replay pass.
3. Recovery/restart scenarios replay pass.
4. Fault injection:
   - version conflict
   - budget violation
   - invalid transition

## 11.3 CI Verification

1. `develop` pipeline emits warning artifacts.
2. `main` pipeline blocks on configured hard-fail conditions.
3. Baseline compare reports both rolling and fixed results.

## 12. Acceptance Criteria

v1 is accepted when all are true:

1. `agent_*` traces are produced for all targeted entry paths.
2. Replay engine can process trace corpus deterministically.
3. Structural regressions fail replay in CI.
4. On `main`, success-rate degradation > 5% (rolling baseline) blocks merge.
5. Fixed baseline comparison is visible in artifacts and logs.
6. Permission/audit lineage fields are present and replay-validated for mutation events.

## 13. Risks and Mitigations

1. Event volume growth:
   - Mitigation: segment rolling, retention policy, streaming replay.
2. Instrumentation overhead:
   - Mitigation: lightweight normalization and async append path.
3. Flaky gating from noisy traces:
   - Mitigation: strict vs lenient separation and deterministic digest checks.
4. Baseline drift:
   - Mitigation: hybrid strategy and explicit baseline refresh process.

## 14. Assumptions and Defaults

1. Existing multi-agent flow remains coordinator/worker hard-cut.
2. Existing dashboard sockets remain the primary real-time transport.
3. `agent_*` is the only harness domain in v1.
4. Billing remains estimate-based in this milestone.
5. Runtime/kernel event semantics stay backward compatible for current APIs.
