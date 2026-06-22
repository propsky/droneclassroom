# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

CREAFLY 教室版無人機模擬器 — a browser-based drone flight simulator for Taiwan K-12 programming education. Students fly a 3D drone either by manual stick/keyboard/gamepad control or by composing Blockly programs; a teacher dashboard tracks the class over WebSocket. Forked from `eccc20984/drone-simulator` (MIT).

Versions map to lessons: v1.3 = 6/22 first lesson (manual only), v1.4 = 6/29 second lesson (adds Blockly program mode).

## Commands

```bash
npm install            # installs ws (the only npm dependency)
node server.js         # dev server on :3000 (student) + :3000/teacher + ws://:8080
```

No build step, no bundler, no TypeScript, no test framework. Three.js, Blockly, and nipplejs are loaded from CDN in `index.html` — there is nothing to compile. Edit a file, reload the browser (server sends `no-store` headers so reloads are always fresh).

- Student UI: `http://localhost:3000/`
- Teacher dashboard: `http://localhost:3000/teacher` (served from `teacher.html`)

### Visual "tests" (screenshots, not assertions)

There is no unit test suite. Verification is done by headless-Chrome screenshots and DOM dumps. Pattern (see `screenshot-622.js`, `review-622.js`, `validate-b101001.js`): spawn `C:\Program Files\Google\Chrome\Application\chrome.exe --headless --screenshot=...` against `localhost:3000`, write PNGs into `screenshots/`. The server must already be running. These scripts are throwaway per-task validators named after the task (`screenshot-t102.js`, `review-t101.js`) — write a new one for the task at hand rather than forcing an old one to fit.

### Packaging a release

`node pack-zip.js` produces `creafly-drone-simulator-v1.4.zip` from `git ls-files` (tracked files only), excluding scratch files (`.pm-*`, `dom-snapshot`, `server.log/err`, old `shot-*`). Update the `ZIP_OUT` version and the `exclude` regex when cutting a new version.

## Architecture

Three files hold essentially everything; `main.js` is the bulk (~3000 lines, organized into numbered `// =====` sections).

### `main.js` — the entire client

Single global script (no modules). Section map:
- **§1–4** Three.js scene: drone model, lighting, environment (ground grid, clouds, rings).
- **§5** `droneState` — the physics/orientation source of truth. `player` (login/display name), `audioState` (Web Audio generated SFX), `wsState` (student WebSocket client).
- **§6** Input: keyboard, nipplejs virtual joystick, **and** the Web Gamepad API (`gamepadState`) for USB/Bluetooth controllers. §6c is a stick **calibration wizard**.
- **§T-101 mode switch** `MODE = { MANUAL, PROGRAM }` — the central UI bifurcation. Manual mode = sticks drive `droneState` directly; program mode = Blockly program drives it via the action API.
- **§7–8 Action API**: `cf_takeoff / cf_land / cf_forward / cf_backward / cf_left / cf_right / cf_hover / cf_rotateClockwise / cf_rotateCounterClockwise / cf_wait / cf_log / cf_elapsed / cf_timerReset`. These are `async` and animate `droneState` over time — **this is the contract between generated Blockly code and the simulator.** Any new block must map to a `cf_*` function.
- **§9 Blockly**: `defineCreaFlyBlocks()` registers custom blocks in categories (動作/移動/旋轉 + advanced 邏輯/迴圈/變數/時間). Block generators emit JS calling the `cf_*` API.
- **§10** `runProgram(workspace)` — generates JS from the workspace and executes it.
- **§12** Physics + animation main loop, including `checkRingCollisions()` and pass-zone checks.

### Level system

Levels are **data, not code**. `main.js` does `fetch('levels/chapter1.json')` on load, then `loadLevel('1-0')`. A level defines `rings` (fly-through targets) and/or `passZones` (step-by-step goal detection). Pass-zone types: `altitude` (`minY`/`maxY`), `position` (`minX/maxX/minZ/maxZ`), `heading` (`targetYaw` + `tolerance`). Completing all zones/rings = level passed, drives the HUD progress bar. **To change a level's tasks, edit `chapter1.json` — do not touch `main.js`.**

### Server (`server.js`)

Plain Node `http` static file server (no framework) + a `ws` WebSocketServer on **:8080**. Two roles distinguished by WS path: `/teacher` connections join `teachers`, everything else is a student in the `students` map. Students send `register` / `progress` / `complete_level`; the server fans out `student_list` / `student_update` to teachers, and relays teacher `broadcast` messages (load_level / reset_all / race_start / show_message) down to all students. State is in-memory only.

## Working conventions

- **All UI text, comments, level intros, and commit messages are in Traditional Chinese (zh-Hant).** Match this — including in commit messages (see git log: `v1.4: T-101 ...`).
- Work is dispatched as tasks under `docs/tasks/T-NNN-*.md` with reviews in `docs/reports/`. `.pm-dispatch-*.md` are PM hand-off notes (team is drone-pm / drone-coder / drone-reviewer). These coordination files are gitignored-style scratch — excluded from release zips.
- The server is often left running on a LAN address (e.g. `192.168.1.201:3000`) for live device testing; prefer reloading over restarting unless a `server.js` change requires it.
- Don't add a build tool, framework, or TS — the "no build step" constraint is intentional (runs from a static host / zip).
