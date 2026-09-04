// 自訂關卡編輯器 — 俯視 2D、格線吸附、物件選取與座標面板、素材庫。
import type { LevelDef } from '@creafly/shared';
import {
  EDITOR_HALF,
  EDITOR_WORLD,
  LEVEL_KIT_CATEGORIES,
  applyLevelKitSnippet,
  getLevelKitSnippet,
  levelKitByCategory,
  snapClampXZ,
  type LevelKitSnippet,
} from '@creafly/shared';
import { ApiError, fetchTeacherLevel, patchTeacherLevel } from '../api';
import { ICONS } from '../icons';
import { openPreviewModal } from '../preview';
import { toast } from '../toast';

const HALF = EDITOR_HALF;
const WORLD = EDITOR_WORLD;
const CANVAS_PX = 480;

export interface LevelEditorPanel {
  destroy(): void;
}

type ObjKind = 'ring' | 'obstacle' | 'balloon' | 'zone';
type PlaceMode = 'select' | 'ring' | 'obstacle-solid' | 'obstacle-soft' | 'balloon';

interface Selection {
  kind: ObjKind;
  index: number;
}

function errText(err: unknown, doing: string): string {
  if (err instanceof ApiError) {
    if (err.isNetwork) return '無法連到伺服器';
    if (err.status === 401) return '登入已過期';
    return `${doing}失敗（HTTP ${err.status}）`;
  }
  return `${doing}失敗`;
}

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function defaultLevel(levelId: string, title: string): LevelDef {
  return {
    id: levelId,
    name: title,
    intro: '',
    hud: title,
    returnHome: true,
    rings: [],
    obstacles: [],
    passZones: [],
    balloons: [],
  };
}

function parseLevel(def: Record<string, unknown>, levelId: string, title: string): LevelDef {
  const raw = def as unknown as Partial<LevelDef>;
  const base = defaultLevel(levelId, title);
  return {
    ...base,
    ...raw,
    id: levelId,
    name: String(raw.name || title),
    rings: Array.isArray(raw.rings) ? [...raw.rings] : [],
    obstacles: Array.isArray(raw.obstacles) ? [...raw.obstacles] : [],
    passZones: Array.isArray(raw.passZones) ? [...raw.passZones] : [],
    balloons: Array.isArray(raw.balloons) ? [...raw.balloons] : [],
  };
}

const KIND_LABEL: Record<ObjKind, string> = {
  ring: '穿圈',
  obstacle: '障礙',
  balloon: '氣球',
  zone: '任務點',
};

export function openLevelEditor(levelPk: number, onSaved?: () => void): LevelEditorPanel {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal modal-xl lvl-editor-modal" role="dialog" aria-modal="true">
      <div class="modal-head">
        <div class="modal-head-text">
          <h2 class="modal-title" id="le-title">關卡編輯</h2>
          <p class="modal-desc" id="le-sub">載入中…</p>
        </div>
        <span class="lvl-save-hint" id="le-save-hint"></span>
        <button type="button" class="btn btn-ghost btn-sm" id="le-close">${ICONS.x}關閉</button>
      </div>
      <div class="lvl-editor-body">
        <div class="lvl-editor-form">
          <div class="field">
            <label class="field-label" for="le-name">關卡名稱</label>
            <input id="le-name" type="text" maxlength="200">
          </div>
          <div class="field">
            <label class="field-label" for="le-hud">HUD 提示</label>
            <input id="le-hud" type="text" maxlength="200">
          </div>
          <div class="field">
            <label class="field-label" for="le-intro">開場說明</label>
            <textarea id="le-intro" rows="3"></textarea>
          </div>
          <label class="check-row"><input type="checkbox" id="le-return">需返航降落才算過關</label>

          <div class="lvl-editor-toolbar" id="le-toolbar">
            <button type="button" class="btn btn-ghost btn-sm le-tool active" data-mode="select">選取</button>
            <button type="button" class="btn btn-ghost btn-sm le-tool" data-mode="ring">穿圈</button>
            <button type="button" class="btn btn-ghost btn-sm le-tool" data-mode="obstacle-solid">實心障礙</button>
            <button type="button" class="btn btn-ghost btn-sm le-tool" data-mode="obstacle-soft">標記柱</button>
            <button type="button" class="btn btn-ghost btn-sm le-tool" data-mode="balloon">氣球</button>
          </div>
          <div class="lvl-editor-snap">
            <span class="lvl-editor-snap-label">吸附格線</span>
            <label class="check-row"><input type="radio" name="le-snap" value="1" checked>1 m</label>
            <label class="check-row"><input type="radio" name="le-snap" value="0.5">0.5 m</label>
            <label class="check-row"><input type="radio" name="le-snap" value="0">0.1 m</label>
          </div>

          <div class="lvl-props" id="le-props" hidden>
            <h3 class="lvl-props-title" id="le-props-title">選取物件</h3>
            <div class="lvl-props-grid">
              <div class="field"><label class="field-label" for="le-px">X（左右）</label><input id="le-px" type="number" step="0.5" class="mono"></div>
              <div class="field"><label class="field-label" for="le-pz">Z（前後）</label><input id="le-pz" type="number" step="0.5" class="mono"></div>
              <div class="field" id="le-py-wrap"><label class="field-label" for="le-py">Y（高度）</label><input id="le-py" type="number" step="0.5" min="0" max="8" class="mono"></div>
              <div class="field" id="le-size-wrap" hidden><label class="field-label" for="le-size">邊長</label><input id="le-size" type="number" step="0.5" min="0.5" max="6" class="mono"></div>
              <div class="field" id="le-label-wrap" hidden><label class="field-label" for="le-label">標籤</label><input id="le-label" type="text" maxlength="40"></div>
              <div class="field" id="le-solid-wrap" hidden><label class="check-row"><input type="checkbox" id="le-solid">實心碰撞（會擋住）</label></div>
            </div>
            <button type="button" class="btn btn-ghost btn-sm" id="le-del-sel">刪除選取</button>
          </div>

          <div class="lvl-kit">
            <h3 class="lvl-kit-title">素材庫</h3>
            <p class="note lvl-kit-hint">點選插入片段；任務 / 畫畫類會覆寫步驟。</p>
            <div id="le-kit-panels"></div>
          </div>
        </div>
        <div class="lvl-editor-canvas-col">
          <div class="lvl-canvas-head">
            <span class="mono" id="le-cursor">X 0 · Z 0</span>
            <span class="note">↑ 前方為 -Z · 拖曳移動 · 方向鍵微調 · Del 刪除</span>
          </div>
          <div class="lvl-editor-canvas-wrap">
            <canvas id="le-canvas" width="${CANVAS_PX}" height="${CANVAS_PX}" aria-label="俯視編輯器"></canvas>
          </div>
          <p class="note lvl-legend">
            <span class="le-legend-ring">○ 圈</span>
            <span class="le-legend-solid">■ 實心</span>
            <span class="le-legend-soft">■ 標記</span>
            <span class="le-legend-balloon">● 氣球</span>
            <span class="le-legend-zone">▢ 任務</span>
          </p>
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="le-preview">${ICONS.play}預覽</button>
        <button type="button" class="btn btn-primary" id="le-save-now">${ICONS.check}立即儲存</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  const q = <T extends HTMLElement>(sel: string): T => backdrop.querySelector<T>(sel)!;
  const canvas = q<HTMLCanvasElement>('#le-canvas');
  const ctx = canvas.getContext('2d')!;
  const saveHint = q<HTMLElement>('#le-save-hint');
  const propsPanel = q<HTMLElement>('#le-props');
  const cursorEl = q<HTMLElement>('#le-cursor');

  let levelPkLocal = levelPk;
  let level: LevelDef = defaultLevel('', '');
  let selection: Selection | null = null;
  let dragSel: Selection | null = null;
  let placeMode: PlaceMode = 'select';
  let snapStep = 1;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;
  let syncingProps = false;

  const getSnapStep = (): number => {
    const v = backdrop.querySelector<HTMLInputElement>('input[name="le-snap"]:checked')?.value;
    return v === '0.5' ? 0.5 : v === '0' ? 0 : 1;
  };

  const worldToCanvas = (x: number, z: number): [number, number] => {
    const w = canvas.width;
    const h = canvas.height;
    return [((x + HALF) / WORLD) * w, ((z + HALF) / WORLD) * h];
  };

  const canvasToWorld = (px: number, py: number): { x: number; z: number } => {
    const w = canvas.width;
    const h = canvas.height;
    const rawX = (px / w) * WORLD - HALF;
    const rawZ = (py / h) * WORLD - HALF;
    return snapClampXZ(rawX, rawZ, snapStep);
  };

  const isSelected = (kind: ObjKind, index: number): boolean =>
    selection?.kind === kind && selection.index === index;

  const draw = (): void => {
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#1a2332';
    ctx.fillRect(0, 0, w, h);

    // 格線 + 座標標尺
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let m = -15; m <= 15; m += snapStep >= 1 ? 5 : 2.5) {
      const [gx] = worldToCanvas(m, 0);
      const [, gz] = worldToCanvas(0, m);
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, gz);
      ctx.lineTo(w, gz);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(148,163,184,0.55)';
    ctx.font = '9px monospace';
    for (let m = -10; m <= 10; m += 5) {
      if (m === 0) continue;
      const [gx] = worldToCanvas(m, 0);
      const [, gz] = worldToCanvas(0, m);
      ctx.fillText(String(m), gx + 2, h - 4);
      ctx.fillText(String(m), 4, gz - 2);
    }

    const [hx, hz] = worldToCanvas(0, 0);
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(hx, hz, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px sans-serif';
    ctx.fillText('起飛墊 0,0', hx + 10, hz + 4);

    // guide 折線（畫畫教室）
    const guide = level.guide;
    if (guide?.length) {
      ctx.strokeStyle = 'rgba(96,165,250,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      guide.forEach(([gx, gz], i) => {
        const [cx, cz] = worldToCanvas(gx, gz);
        if (i === 0) ctx.moveTo(cx, cz);
        else ctx.lineTo(cx, cz);
      });
      ctx.stroke();
    }

    (level.obstacles ?? []).forEach((obs, i) => {
      const [ox, oz] = worldToCanvas(obs.x, obs.z);
      const r = ((obs.size ?? 1) / WORLD) * w * 0.5;
      const sel = isSelected('obstacle', i);
      ctx.fillStyle = obs.solid ? 'rgba(248,113,113,0.55)' : 'rgba(74,222,128,0.4)';
      ctx.fillRect(ox - r, oz - r, r * 2, r * 2);
      if (sel) {
        ctx.strokeStyle = '#60a5fa';
        ctx.lineWidth = 2;
        ctx.strokeRect(ox - r - 2, oz - r - 2, r * 2 + 4, r * 2 + 4);
      }
    });

    (level.balloons ?? []).forEach((b, i) => {
      const [bx, bz] = worldToCanvas(b.x, b.z);
      ctx.fillStyle = 'rgba(251,191,36,0.75)';
      ctx.beginPath();
      ctx.arc(bx, bz, 10, 0, Math.PI * 2);
      ctx.fill();
      if (isSelected('balloon', i)) {
        ctx.strokeStyle = '#60a5fa';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });

    (level.passZones ?? []).forEach((zone, i) => {
      const [zx, zz] = worldToCanvas(zone.x, zone.z);
      ctx.strokeStyle = isSelected('zone', i) ? '#60a5fa' : 'rgba(167,139,250,0.85)';
      ctx.lineWidth = isSelected('zone', i) ? 2.5 : 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(zx - 12, zz - 12, 24, 24);
      ctx.setLineDash([]);
      ctx.fillStyle = '#c4b5fd';
      ctx.font = '9px sans-serif';
      ctx.fillText(String(i + 1), zx - 3, zz + 3);
    });

    (level.rings ?? []).forEach((ring, i) => {
      const [rx, rz] = worldToCanvas(ring.x, ring.z);
      ctx.strokeStyle = isSelected('ring', i) ? '#60a5fa' : ring.faceYaw != null ? '#f87171' : '#38bdf8';
      ctx.lineWidth = isSelected('ring', i) ? 3 : 2;
      ctx.beginPath();
      ctx.arc(rx, rz, 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '10px sans-serif';
      ctx.fillText(ring.label ?? String(i + 1), rx - 4, rz + 3);
    });
  };

  const syncFormFromLevel = (): void => {
    q<HTMLInputElement>('#le-name').value = level.name;
    q<HTMLInputElement>('#le-hud').value = level.hud ?? '';
    q<HTMLTextAreaElement>('#le-intro').value = level.intro ?? '';
    q<HTMLInputElement>('#le-return').checked = !!level.returnHome;
  };

  const syncLevelFromForm = (): void => {
    level.name = q<HTMLInputElement>('#le-name').value.trim() || level.name;
    level.hud = q<HTMLInputElement>('#le-hud').value.trim();
    level.intro = q<HTMLTextAreaElement>('#le-intro').value;
    level.returnHome = q<HTMLInputElement>('#le-return').checked;
  };

  const scheduleSave = (): void => {
    dirty = true;
    saveHint.textContent = '儲存中…';
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void flushSave(), 700);
  };

  const flushSave = async (): Promise<void> => {
    syncLevelFromForm();
    try {
      await patchTeacherLevel(levelPkLocal, {
        title: level.name,
        definition: level as unknown as Record<string, unknown>,
      });
      dirty = false;
      saveHint.textContent = '已儲存';
      onSaved?.();
    } catch (e) {
      saveHint.textContent = '儲存失敗';
      toast(errText(e, '儲存'), 'error');
    }
  };

  const setSelection = (sel: Selection | null): void => {
    selection = sel;
    syncPropsPanel();
    draw();
  };

  const syncPropsPanel = (): void => {
    if (!selection) {
      propsPanel.hidden = true;
      return;
    }
    propsPanel.hidden = false;
    const { kind, index } = selection;
    q<HTMLElement>('#le-props-title').textContent = `${KIND_LABEL[kind]} #${index + 1}`;

    const pyWrap = q<HTMLElement>('#le-py-wrap');
    const sizeWrap = q<HTMLElement>('#le-size-wrap');
    const labelWrap = q<HTMLElement>('#le-label-wrap');
    const solidWrap = q<HTMLElement>('#le-solid-wrap');

    syncingProps = true;
    if (kind === 'ring') {
      const r = level.rings![index];
      if (!r) return setSelection(null);
      q<HTMLInputElement>('#le-px').value = String(r.x);
      q<HTMLInputElement>('#le-pz').value = String(r.z);
      q<HTMLInputElement>('#le-py').value = String(r.y);
      pyWrap.hidden = false;
      sizeWrap.hidden = true;
      labelWrap.hidden = false;
      solidWrap.hidden = true;
      q<HTMLInputElement>('#le-label').value = r.label ?? '';
    } else if (kind === 'obstacle') {
      const o = level.obstacles![index];
      if (!o) return setSelection(null);
      q<HTMLInputElement>('#le-px').value = String(o.x);
      q<HTMLInputElement>('#le-pz').value = String(o.z);
      q<HTMLInputElement>('#le-py').value = String(o.y);
      q<HTMLInputElement>('#le-size').value = String(o.size ?? 1);
      q<HTMLInputElement>('#le-solid').checked = !!o.solid;
      pyWrap.hidden = false;
      sizeWrap.hidden = false;
      labelWrap.hidden = true;
      solidWrap.hidden = false;
    } else if (kind === 'balloon') {
      const b = level.balloons![index];
      if (!b) return setSelection(null);
      q<HTMLInputElement>('#le-px').value = String(b.x);
      q<HTMLInputElement>('#le-pz').value = String(b.z);
      q<HTMLInputElement>('#le-py').value = String(b.y);
      pyWrap.hidden = false;
      sizeWrap.hidden = true;
      labelWrap.hidden = true;
      solidWrap.hidden = true;
    } else {
      const z = level.passZones![index];
      if (!z) return setSelection(null);
      q<HTMLInputElement>('#le-px').value = String(z.x);
      q<HTMLInputElement>('#le-pz').value = String(z.z);
      q<HTMLInputElement>('#le-label').value = z.label;
      pyWrap.hidden = true;
      sizeWrap.hidden = true;
      labelWrap.hidden = false;
      solidWrap.hidden = true;
    }
    syncingProps = false;
  };

  const applyPropsToSelection = (): void => {
    if (!selection || syncingProps) return;
    const x = snapClampXZ(Number(q<HTMLInputElement>('#le-px').value) || 0, 0, snapStep).x;
    const z = snapClampXZ(0, Number(q<HTMLInputElement>('#le-pz').value) || 0, snapStep).z;
    const y = Number(q<HTMLInputElement>('#le-py').value) || 2;

    if (selection.kind === 'ring') {
      const rings = [...(level.rings ?? [])];
      const r = rings[selection.index];
      if (!r) return;
      rings[selection.index] = { ...r, x, z, y, label: q<HTMLInputElement>('#le-label').value.trim() || r.label };
      level.rings = rings;
    } else if (selection.kind === 'obstacle') {
      const obs = [...(level.obstacles ?? [])];
      const o = obs[selection.index];
      if (!o) return;
      const solid = q<HTMLInputElement>('#le-solid').checked;
      obs[selection.index] = {
        ...o,
        x,
        z,
        y,
        size: Number(q<HTMLInputElement>('#le-size').value) || 1,
        solid,
        type: solid ? 'cube' : 'soft-cube',
      };
      level.obstacles = obs;
    } else if (selection.kind === 'balloon') {
      const balloons = [...(level.balloons ?? [])];
      const b = balloons[selection.index];
      if (!b) return;
      balloons[selection.index] = { ...b, x, z, y };
      level.balloons = balloons;
    } else {
      const zones = [...(level.passZones ?? [])];
      const zn = zones[selection.index];
      if (!zn) return;
      zones[selection.index] = {
        ...zn,
        x,
        z,
        label: q<HTMLInputElement>('#le-label').value.trim() || zn.label,
      };
      level.passZones = zones;
    }
    draw();
    scheduleSave();
  };

  const deleteSelection = (): void => {
    if (!selection) return;
    const { kind, index } = selection;
    if (kind === 'ring') level.rings = (level.rings ?? []).filter((_, i) => i !== index);
    else if (kind === 'obstacle') level.obstacles = (level.obstacles ?? []).filter((_, i) => i !== index);
    else if (kind === 'balloon') level.balloons = (level.balloons ?? []).filter((_, i) => i !== index);
    else level.passZones = (level.passZones ?? []).filter((_, i) => i !== index);
    setSelection(null);
    scheduleSave();
  };

  const nudgeSelection = (dx: number, dz: number): void => {
    if (!selection) return;
    if (selection.kind === 'ring') {
      const rings = [...(level.rings ?? [])];
      const r = rings[selection.index];
      if (!r) return;
      const p = snapClampXZ(r.x + dx, r.z + dz, snapStep);
      rings[selection.index] = { ...r, x: p.x, z: p.z };
      level.rings = rings;
    } else if (selection.kind === 'obstacle') {
      const obs = [...(level.obstacles ?? [])];
      const o = obs[selection.index];
      if (!o) return;
      const p = snapClampXZ(o.x + dx, o.z + dz, snapStep);
      obs[selection.index] = { ...o, x: p.x, z: p.z };
      level.obstacles = obs;
    } else if (selection.kind === 'balloon') {
      const balloons = [...(level.balloons ?? [])];
      const b = balloons[selection.index];
      if (!b) return;
      const p = snapClampXZ(b.x + dx, b.z + dz, snapStep);
      balloons[selection.index] = { ...b, x: p.x, z: p.z };
      level.balloons = balloons;
    } else {
      const zones = [...(level.passZones ?? [])];
      const z = zones[selection.index];
      if (!z) return;
      const p = snapClampXZ(z.x + dx, z.z + dz, snapStep);
      zones[selection.index] = { ...z, x: p.x, z: p.z };
      level.passZones = zones;
    }
    syncPropsPanel();
    draw();
    scheduleSave();
  };

  const hitAt = (px: number, py: number): Selection | null => {
    const tryList = (kind: ObjKind, items: { x: number; z: number; size?: number }[]): Selection | null => {
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (!it) continue;
        const [cx, cz] = worldToCanvas(it.x, it.z);
        const hitR = kind === 'obstacle' ? ((it.size ?? 1) / WORLD) * canvas.width * 0.5 + 4 : 14;
        if (Math.hypot(px - cx, py - cz) <= hitR) return { kind, index: i };
      }
      return null;
    };
    return (
      tryList('ring', level.rings ?? []) ??
      tryList('obstacle', level.obstacles ?? []) ??
      tryList('balloon', level.balloons ?? []) ??
      tryList('zone', level.passZones ?? [])
    );
  };

  const placeAt = (wx: number, wz: number): void => {
    if (placeMode === 'ring') {
      level.rings = [
        ...(level.rings ?? []),
        { x: wx, y: 2.5, z: wz, label: String((level.rings?.length ?? 0) + 1) },
      ];
      setSelection({ kind: 'ring', index: level.rings.length - 1 });
    } else if (placeMode === 'obstacle-solid') {
      level.obstacles = [
        ...(level.obstacles ?? []),
        { type: 'cube', solid: true, x: wx, y: 1.5, z: wz, size: 1, color: '#f87171' },
      ];
      setSelection({ kind: 'obstacle', index: level.obstacles.length - 1 });
    } else if (placeMode === 'obstacle-soft') {
      level.obstacles = [
        ...(level.obstacles ?? []),
        { type: 'soft-cube', solid: false, x: wx, y: 1.5, z: wz, size: 1, color: '#4ade80' },
      ];
      setSelection({ kind: 'obstacle', index: level.obstacles.length - 1 });
    } else if (placeMode === 'balloon') {
      level.balloons = [...(level.balloons ?? []), { x: wx, y: 2.5, z: wz }];
      setSelection({ kind: 'balloon', index: level.balloons.length - 1 });
    }
    scheduleSave();
  };

  const canvasPos = (e: MouseEvent): [number, number] => {
    const rect = canvas.getBoundingClientRect();
    return [
      ((e.clientX - rect.left) / rect.width) * canvas.width,
      ((e.clientY - rect.top) / rect.height) * canvas.height,
    ];
  };

  canvas.addEventListener('mousemove', (e) => {
    const [px, py] = canvasPos(e);
    const { x, z } = canvasToWorld(px, py);
    cursorEl.textContent = `X ${x} · Z ${z}`;
    if (!dragSel) return;
    const drag = dragSel;
    const rings = level.rings ?? [];
    const obs = level.obstacles ?? [];
    const balloons = level.balloons ?? [];
    const zones = level.passZones ?? [];
    if (drag.kind === 'ring' && rings[drag.index]) {
      const p = snapClampXZ(x, z, snapStep);
      level.rings = rings.map((item, i) => (i === drag.index ? { ...item, x: p.x, z: p.z } : item));
    } else if (drag.kind === 'obstacle' && obs[drag.index]) {
      const p = snapClampXZ(x, z, snapStep);
      level.obstacles = obs.map((item, i) => (i === drag.index ? { ...item, x: p.x, z: p.z } : item));
    } else if (drag.kind === 'balloon' && balloons[drag.index]) {
      const p = snapClampXZ(x, z, snapStep);
      level.balloons = balloons.map((item, i) => (i === drag.index ? { ...item, x: p.x, z: p.z } : item));
    } else if (drag.kind === 'zone' && zones[drag.index]) {
      const p = snapClampXZ(x, z, snapStep);
      level.passZones = zones.map((item, i) => (i === drag.index ? { ...item, x: p.x, z: p.z } : item));
    }
    syncPropsPanel();
    draw();
  });

  canvas.addEventListener('mousedown', (e) => {
    const [px, py] = canvasPos(e);
    const hit = hitAt(px, py);
    if (hit) {
      setSelection(hit);
      dragSel = hit;
      return;
    }
    const { x, z } = canvasToWorld(px, py);
    if (placeMode !== 'select') {
      placeAt(x, z);
      draw();
      return;
    }
    setSelection(null);
  });

  const endDrag = (): void => {
    if (dragSel) {
      dragSel = null;
      scheduleSave();
    }
  };
  canvas.addEventListener('mouseup', endDrag);
  canvas.addEventListener('mouseleave', endDrag);

  backdrop.querySelectorAll<HTMLInputElement>('input[name="le-snap"]').forEach((inp) => {
    inp.addEventListener('change', () => {
      snapStep = getSnapStep();
      draw();
    });
  });

  q<HTMLElement>('#le-toolbar').querySelectorAll<HTMLButtonElement>('.le-tool').forEach((btn) => {
    btn.addEventListener('click', () => {
      placeMode = (btn.dataset['mode'] as PlaceMode) || 'select';
      q<HTMLElement>('#le-toolbar').querySelectorAll('.le-tool').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  ['#le-px', '#le-pz', '#le-py', '#le-size', '#le-label', '#le-solid'].forEach((sel) => {
    q<HTMLElement>(sel).addEventListener('input', () => applyPropsToSelection());
    q<HTMLElement>(sel).addEventListener('change', () => applyPropsToSelection());
  });

  q<HTMLButtonElement>('#le-del-sel').addEventListener('click', deleteSelection);

  backdrop.addEventListener('keydown', (e) => {
    if (!(e.target instanceof HTMLElement)) return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const step = snapStep || 0.5;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteSelection();
    } else if (e.key === 'ArrowLeft') nudgeSelection(-step, 0);
    else if (e.key === 'ArrowRight') nudgeSelection(step, 0);
    else if (e.key === 'ArrowUp') nudgeSelection(0, -step);
    else if (e.key === 'ArrowDown') nudgeSelection(0, step);
  });
  backdrop.tabIndex = -1;

  q<HTMLInputElement>('#le-name').addEventListener('input', scheduleSave);
  q<HTMLInputElement>('#le-hud').addEventListener('input', scheduleSave);
  q<HTMLTextAreaElement>('#le-intro').addEventListener('input', scheduleSave);
  q<HTMLInputElement>('#le-return').addEventListener('change', scheduleSave);

  const applySnippet = (snippet: LevelKitSnippet): void => {
    const mode =
      snippet.category === 'tasks' ||
      snippet.category === 'draw' ||
      snippet.category === 'races'
        ? 'replace-tasks'
        : 'append';
    level = applyLevelKitSnippet(level, snippet, mode);
    setSelection(null);
    syncFormFromLevel();
    draw();
    scheduleSave();
    toast(`已插入「${snippet.name}」`, 'success');
  };

  const kitHost = q<HTMLElement>('#le-kit-panels');
  kitHost.innerHTML = LEVEL_KIT_CATEGORIES
    .map((cat) => {
      const items = levelKitByCategory(cat.id);
      if (!items.length) return '';
      return `<details class="lvl-kit-group" ${cat.id === 'rings' ? 'open' : ''}>
        <summary class="lvl-kit-summary">${cat.label}（${items.length}）</summary>
        <div class="lvl-kit-grid">
          ${items
            .map(
              (s) =>
                `<button type="button" class="lvl-kit-card" data-kit="${s.id}" title="${esc(s.desc)}">
                  <span class="lvl-kit-card-name">${esc(s.name)}</span>
                  <span class="lvl-kit-card-desc">${esc(s.desc)}</span>
                </button>`,
            )
            .join('')}
        </div>
      </details>`;
    })
    .join('');

  kitHost.querySelectorAll<HTMLButtonElement>('[data-kit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const snippet = getLevelKitSnippet(btn.dataset['kit'] ?? '');
      if (snippet) applySnippet(snippet);
    });
  });

  q<HTMLButtonElement>('#le-preview').addEventListener('click', () => {
    syncLevelFromForm();
    void flushSave().then(() => openPreviewModal(level));
  });

  q<HTMLButtonElement>('#le-save-now').addEventListener('click', () => {
    void flushSave().then(() => toast('已儲存', 'success'));
  });

  const close = (): void => {
    if (dirty) void flushSave();
    backdrop.remove();
  };
  q<HTMLButtonElement>('#le-close').addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  void fetchTeacherLevel(levelPkLocal)
    .then((detail) => {
      levelPkLocal = detail.id;
      level = parseLevel(detail.definition, detail.levelId, detail.title);
      q<HTMLElement>('#le-title').textContent = `編輯 ${detail.levelId}`;
      q<HTMLElement>('#le-sub').textContent =
        detail.status === 'draft' ? '草稿會自動儲存' : '已發布 — 修改後學生端即時生效';
      snapStep = getSnapStep();
      syncFormFromLevel();
      draw();
      backdrop.focus();
    })
    .catch((e) => {
      toast(errText(e, '載入'), 'error');
      close();
    });

  return {
    destroy(): void {
      if (saveTimer) clearTimeout(saveTimer);
      backdrop.remove();
    },
  };
}
