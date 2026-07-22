# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

CREAFLY 教室版無人機模擬器 — a browser-based drone flight simulator for Taiwan K-12 programming education. Students fly a 3D drone either by manual stick/keyboard/gamepad control or by composing Blockly programs; a teacher dashboard tracks the class over WebSocket. Originally forked from `eccc20984/drone-simulator` (MIT).

**Rewrite (current codebase)** on branch `rewrite/babylon-monorepo`: Three.js → **Babylon.js + TypeScript**, restructured as a **pnpm workspaces monorepo**. The full plan and architecture decisions live in `docs/rewrite-plan.md` — read it before making structural changes. The old single-file version is preserved intact in `legacy/` and serves as the behavior/visual parity baseline.

## Commands

```bash
pnpm install            # install all workspace deps
pnpm dev                # simulator (:5173) + teacher (:5174) + api (:3000) in parallel
pnpm dev:sim            # student client only
pnpm typecheck          # tsc --noEmit across all packages (must stay clean)
pnpm build              # production build → apps/simulator/dist (zero CDN deps)
pnpm legacy             # run the old Three.js version (node legacy/server.js, :3000)
```

No test framework yet; core logic in `apps/simulator/src/core/` is pure TS designed to be testable (Vitest planned). Visual verification is headless-Chrome screenshots — on macOS pass `--use-angle=swiftshader --enable-unsafe-swiftshader` for WebGL.

## Monorepo layout

| Path | Package | Notes |
|---|---|---|
| `apps/simulator` | `@creafly/simulator` | Student client: Babylon.js 8 + Vite + TS |
| `apps/api` | `@creafly/api` | FastAPI + uv backend; wire-compatible with legacy protocol; in-memory, no DB by design |
| `packages/shared` | `@creafly/shared` | Level schema, WS protocol types, pure math — **zero runtime deps, keep it that way** |
| `legacy/` | — | Old Three.js single-file app, still runnable; do not evolve it, only fix critical classroom bugs |

pnpm's strict `node_modules` enforces package isolation: an app may only import what its own `package.json` declares. Frontend deps live only in `apps/simulator`, backend (Python) deps managed by uv in `apps/api`.

## Architecture rules

- **`apps/simulator/src/core/` is framework-agnostic pure TS**: no `@babylonjs/core` imports, no DOM access. It owns `droneState`, the 60Hz fixed-timestep physics, level logic, and the `cf_*` program API. It communicates outward via the typed event bus (`core/events.ts`). `render/` (Babylon) and `ui/` (DOM) are subscribers.
- **Physics is fixed-timestep 60Hz** (accumulator + render interpolation). Feel constants (`THRUST=0.012`, `LIFT=0.015`, `DRAG=0.92`) are per-tick and intentionally identical to legacy per-frame values. Never tie simulation to rAF frame rate.
- **Coordinate convention**: Babylon runs with `useRightHandedSystem = true`; nose faces -Z, positive yaw = turn left. Level JSONs are shared with legacy unchanged — never re-author level coordinates.
- **`cf_*` Action API is the contract** between Blockly-generated code and the simulator (same semantics as legacy). Generated code runs via `new Function('CREAFLY', …)` injection — never `eval`. Any new block must map to a `cf_*` function in `core/program.ts`.
- **Levels are data, not code**: `apps/simulator/public/levels/chapter*.json` (schema types in `@creafly/shared`). To change level tasks, edit JSON only.
- **WS protocol** is typed in `packages/shared/src/protocol.ts` and stays wire-compatible with `legacy/server.js` during the transition; the FastAPI server validates all inbound messages (Pydantic, `apps/api/app/ws.py`).
- Phase roadmap (draw levels ch2/3, calibration wizard, arena/soccer multiplayer, Havok, React/Vue decision) is tracked in `docs/rewrite-plan.md` §4 — check the phase list before implementing "missing" features.

## Working conventions

- **All UI text, comments, level intros, and commit messages are in Traditional Chinese (zh-Hant).**
- The server is often left running on a LAN address for live device testing; prefer reloading over restarting unless a server change requires it.
- Don't add a UI framework yet (React/Vue decision is deliberately deferred; `ui/` is plain TS + DOM behind the event bus).
- `docs/tasks/T-NNN-*.md` + `docs/reports/` are the legacy task-dispatch convention; rewrite work is tracked in `docs/rewrite-plan.md`.
