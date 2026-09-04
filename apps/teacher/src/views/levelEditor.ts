// 自訂關卡編輯器 — 俯視 2D、格線吸附、物件選取與座標面板、素材庫。
import type {
  AltitudeZone,
  HeadingZone,
  LevelDef,
  PassZoneDef,
  PositionZone,
  TeacherLevelKitBrief,
} from '@creafly/shared';
import {
  EDITOR_HALF,
  EDITOR_MAX_Y,
  EDITOR_WORLD,
  heightHueColor,
  LEVEL_KIT_CATEGORIES,
  applyLevelKitSnippet,
  applyLevelGoalPreset,
  extractLevelKitPatch,
  getLevelGoalPreset,
  getLevelKitSnippet,
  inferLevelKitCategory,
  isLevelLayoutEmpty,
  levelKitByCategory,
  snapClampXZ,
  teacherKitToSnippet,
  validateLevelKitPatch,
  type LevelKitCategory,
  type LevelKitSnippet,
} from '@creafly/shared';
import {
  ApiError,
  createTeacherLevelKit,
  deleteTeacherLevelKit,
  fetchTeacherLevel,
  fetchTeacherLevelKit,
  fetchTeacherLevelKits,
  patchTeacherLevel,
  patchTeacherLevelKit,
} from '../api';
import { ICONS } from '../icons';
import { openPreviewModal } from '../preview';
import { toast } from '../toast';
import { openLevelGoalWizard } from './levelGoalWizard';

const HALF = EDITOR_HALF;
const WORLD = EDITOR_WORLD;
const CANVAS_PX = 480;

export interface LevelEditorPanel {
  destroy(): void;
}

type ObjKind = 'ring' | 'obstacle' | 'balloon' | 'zone';
type PlaceMode = 'select' | 'ring' | 'obstacle-solid' | 'obstacle-soft' | 'balloon' | 'zone';

interface Selection {
  kind: ObjKind;
  index: number;
}

function errText(err: unknown, doing: string): string {
  if (err instanceof ApiError) {
    if (err.isNetwork) return '無法連到伺服器';
    if (err.status === 401) return '登入已過期';
    if (err.message && err.message !== `HTTP ${err.status}`) return err.message;
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

export interface LevelEditorOptions {
  /** 開啟後自動顯示教學目標精靈 */
  showWizard?: boolean;
}

export function openLevelEditor(
  levelPk: number,
  onSaved?: () => void,
  editorOpts?: LevelEditorOptions,
): LevelEditorPanel {
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
        <div id="le-empty-banner" class="lvl-empty-banner" hidden>
          <span>這是空白關卡，可用精靈快速起稿</span>
          <button type="button" class="btn btn-primary btn-sm" id="le-wizard-btn">${ICONS.pencil}快速起稿</button>
        </div>
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
          <label class="check-row"><input type="checkbox" id="le-freeplay">自由活動（無順序過關）</label>
          <label class="check-row"><input type="checkbox" id="le-draw">畫畫教室模式</label>

          <div class="lvl-editor-toolbar" id="le-toolbar">
            <button type="button" class="btn btn-ghost btn-sm le-tool active" data-mode="select">選取</button>
            <button type="button" class="btn btn-ghost btn-sm le-tool" data-mode="ring">穿圈</button>
            <button type="button" class="btn btn-ghost btn-sm le-tool" data-mode="obstacle-solid">實心障礙</button>
            <button type="button" class="btn btn-ghost btn-sm le-tool" data-mode="obstacle-soft">標記柱</button>
            <button type="button" class="btn btn-ghost btn-sm le-tool" data-mode="balloon">氣球</button>
            <button type="button" class="btn btn-ghost btn-sm le-tool" data-mode="zone">任務點</button>
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
              <div class="field" id="le-py-wrap">
                <label class="field-label" for="le-py">Y（高度）<span id="le-py-readout" class="mono le-py-readout"></span></label>
                <input id="le-py-range" type="range" min="0" max="8" step="0.5" class="le-height-range" aria-label="高度滑桿">
                <input id="le-py" type="number" step="0.5" min="0" max="8" class="mono">
                <div class="le-height-presets" id="le-height-presets">
                  <button type="button" class="btn btn-ghost btn-xs" data-y="0.5">地面</button>
                  <button type="button" class="btn btn-ghost btn-xs" data-y="1.5">低空</button>
                  <button type="button" class="btn btn-ghost btn-xs" data-y="2">穿圈</button>
                  <button type="button" class="btn btn-ghost btn-xs" data-y="3.5">中高</button>
                  <button type="button" class="btn btn-ghost btn-xs" data-y="5">高空</button>
                </div>
                <p class="note">PgUp / PgDn 微調高度 · 側視圖確認</p>
              </div>
              <div class="field" id="le-size-wrap" hidden><label class="field-label" for="le-size">邊長</label><input id="le-size" type="number" step="0.5" min="0.5" max="6" class="mono"></div>
              <div class="field" id="le-label-wrap" hidden><label class="field-label" for="le-label">標籤</label><input id="le-label" type="text" maxlength="40"></div>
              <div class="field" id="le-solid-wrap" hidden><label class="check-row"><input type="checkbox" id="le-solid">實心碰撞（會擋住）</label></div>
              <div class="field" id="le-face-wrap" hidden>
                <label class="field-label" for="le-face-yaw">機頭朝向 yaw（度，空=不限）</label>
                <input id="le-face-yaw" type="number" step="15" min="-180" max="180" class="mono" placeholder="不限">
                <label class="field-label" for="le-face-tol">朝向容差（度）</label>
                <input id="le-face-tol" type="number" step="5" min="5" max="90" value="35" class="mono">
              </div>
              <div id="le-zone-wrap" hidden>
                <div class="field">
                  <label class="field-label" for="le-zone-type">任務類型</label>
                  <select id="le-zone-type" class="field-input">
                    <option value="position">位置區域</option>
                    <option value="altitude">高度</option>
                    <option value="heading">朝向</option>
                  </select>
                </div>
                <div class="lvl-props-grid" id="le-zone-position">
                  <div class="field"><label class="field-label" for="le-zone-minx">minX</label><input id="le-zone-minx" type="number" step="0.5" class="mono"></div>
                  <div class="field"><label class="field-label" for="le-zone-maxx">maxX</label><input id="le-zone-maxx" type="number" step="0.5" class="mono"></div>
                  <div class="field"><label class="field-label" for="le-zone-minz">minZ</label><input id="le-zone-minz" type="number" step="0.5" class="mono"></div>
                  <div class="field"><label class="field-label" for="le-zone-maxz">maxZ</label><input id="le-zone-maxz" type="number" step="0.5" class="mono"></div>
                </div>
                <div class="lvl-props-grid" id="le-zone-altitude" hidden>
                  <div class="field"><label class="field-label" for="le-zone-miny">minY</label><input id="le-zone-miny" type="number" step="0.5" min="0" class="mono"></div>
                  <div class="field"><label class="field-label" for="le-zone-maxy">maxY</label><input id="le-zone-maxy" type="number" step="0.5" min="0" class="mono"></div>
                </div>
                <div class="lvl-props-grid" id="le-zone-heading" hidden>
                  <div class="field"><label class="field-label" for="le-zone-yaw">目標 yaw</label><input id="le-zone-yaw" type="number" step="15" class="mono"></div>
                  <div class="field"><label class="field-label" for="le-zone-tol">容差</label><input id="le-zone-tol" type="number" step="5" min="5" class="mono"></div>
                </div>
              </div>
            </div>
            <button type="button" class="btn btn-ghost btn-sm" id="le-del-sel">刪除選取</button>
          </div>

          <div class="lvl-kit">
            <div class="lvl-kit-head">
              <h3 class="lvl-kit-title">我的素材</h3>
              <button type="button" class="btn btn-ghost btn-sm" id="le-save-kit">${ICONS.plus}儲存為素材</button>
            </div>
            <p class="note lvl-kit-hint">完成佈局後可存成片段；勾選「分享」後同校老師也能使用。</p>
            <div id="le-my-kits" class="lvl-kit-grid"></div>
            <div id="le-org-kits-wrap" hidden>
              <h4 class="lvl-kit-subtitle">同校分享</h4>
              <div id="le-org-kits" class="lvl-kit-grid"></div>
            </div>
          </div>
          <div class="lvl-kit">
            <h3 class="lvl-kit-title">官方素材庫</h3>
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
          <div class="lvl-elev-wrap">
            <div class="lvl-canvas-head">
              <span class="note">側視高度（X 軸 · Y 向上）</span>
              <span class="mono" id="le-elev-hint"></span>
            </div>
            <canvas id="le-elev" width="480" height="120" aria-label="側視高度圖"></canvas>
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
  const elevCanvas = q<HTMLCanvasElement>('#le-elev');
  const elevCtx = elevCanvas.getContext('2d')!;
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

  const emptyBanner = q<HTMLElement>('#le-empty-banner');

  const syncPyControls = (y: number): void => {
    q<HTMLInputElement>('#le-py').value = String(y);
    q<HTMLInputElement>('#le-py-range').value = String(y);
    q<HTMLElement>('#le-py-readout').textContent = ` ${y.toFixed(1)} m`;
  };

  const updateEmptyBanner = (): void => {
    emptyBanner.hidden = !isLevelLayoutEmpty(level);
  };

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
      ctx.fillStyle = heightHueColor(obs.y, obs.solid ? 0.75 : 0.5);
      ctx.fillRect(ox - r, oz - r, r * 2, r * 2);
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '8px monospace';
      ctx.fillText(`${obs.y}m`, ox - 10, oz - r - 3);
      if (sel) {
        ctx.strokeStyle = '#60a5fa';
        ctx.lineWidth = 2;
        ctx.strokeRect(ox - r - 2, oz - r - 2, r * 2 + 4, r * 2 + 4);
      }
    });

    (level.balloons ?? []).forEach((b, i) => {
      const [bx, bz] = worldToCanvas(b.x, b.z);
      ctx.fillStyle = heightHueColor(b.y, 0.8);
      ctx.beginPath();
      ctx.arc(bx, bz, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '8px monospace';
      ctx.fillText(`${b.y}m`, bx - 10, bz - 12);
      if (isSelected('balloon', i)) {
        ctx.strokeStyle = '#60a5fa';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });

    (level.passZones ?? []).forEach((zone, i) => {
      const isPos = zone.type === 'position' || zone.type === undefined;
      if (isPos && (zone.minX != null || zone.maxX != null)) {
        const minX = zone.minX ?? zone.x - 1;
        const maxX = zone.maxX ?? zone.x + 1;
        const minZ = zone.minZ ?? zone.z - 1;
        const maxZ = zone.maxZ ?? zone.z + 1;
        const [x1, z1] = worldToCanvas(minX, minZ);
        const [x2, z2] = worldToCanvas(maxX, maxZ);
        ctx.fillStyle = isSelected('zone', i) ? 'rgba(96,165,250,0.15)' : 'rgba(167,139,250,0.12)';
        ctx.fillRect(x1, z1, x2 - x1, z2 - z1);
        ctx.strokeStyle = isSelected('zone', i) ? '#60a5fa' : 'rgba(167,139,250,0.65)';
        ctx.lineWidth = isSelected('zone', i) ? 2.5 : 1.5;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(x1, z1, x2 - x1, z2 - z1);
        ctx.setLineDash([]);
      }
      const [zx, zz] = worldToCanvas(zone.x, zone.z);
      ctx.strokeStyle = isSelected('zone', i) ? '#60a5fa' : 'rgba(167,139,250,0.85)';
      ctx.lineWidth = isSelected('zone', i) ? 2.5 : 2;
      if (!isPos || zone.minX == null) {
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(zx - 12, zz - 12, 24, 24);
        ctx.setLineDash([]);
      }
      ctx.fillStyle = '#c4b5fd';
      ctx.font = '9px sans-serif';
      ctx.fillText(zone.label?.slice(0, 4) ?? String(i + 1), zx - 3, zz + 3);
    });

    (level.rings ?? []).forEach((ring, i) => {
      const [rx, rz] = worldToCanvas(ring.x, ring.z);
      const sel = isSelected('ring', i);
      ctx.strokeStyle = sel ? '#60a5fa' : ring.faceYaw != null ? '#f87171' : heightHueColor(ring.y, 0.95);
      ctx.lineWidth = sel ? 3 : 2;
      ctx.beginPath();
      ctx.arc(rx, rz, 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '10px sans-serif';
      ctx.fillText(ring.label ?? String(i + 1), rx - 4, rz + 3);
      ctx.font = '8px monospace';
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText(`${ring.y}m`, rx - 10, rz - 16);
    });
    drawElev();
    updateEmptyBanner();
  };

  const drawElev = (): void => {
    const w = elevCanvas.width;
    const h = elevCanvas.height;
    elevCtx.fillStyle = '#141c28';
    elevCtx.fillRect(0, 0, w, h);
    const toEx = (x: number): number => ((x + HALF) / WORLD) * w;
    const toEy = (y: number): number => h - 8 - (y / EDITOR_MAX_Y) * (h - 20);
    elevCtx.strokeStyle = 'rgba(251,191,36,0.55)';
    elevCtx.lineWidth = 1;
    elevCtx.beginPath();
    elevCtx.moveTo(0, toEy(0));
    elevCtx.lineTo(w, toEy(0));
    elevCtx.stroke();
    for (let y = 0; y <= EDITOR_MAX_Y; y += 2) {
      elevCtx.strokeStyle = 'rgba(255,255,255,0.06)';
      elevCtx.beginPath();
      elevCtx.moveTo(0, toEy(y));
      elevCtx.lineTo(w, toEy(y));
      elevCtx.stroke();
      elevCtx.fillStyle = 'rgba(148,163,184,0.45)';
      elevCtx.font = '8px monospace';
      elevCtx.fillText(`${y}m`, 2, toEy(y) - 2);
    }
    const mark = (x: number, y: number, label: string, on: boolean): void => {
      const ex = toEx(x);
      const ey = toEy(y);
      elevCtx.fillStyle = heightHueColor(y);
      elevCtx.beginPath();
      elevCtx.arc(ex, ey, on ? 7 : 4, 0, Math.PI * 2);
      elevCtx.fill();
      if (on) {
        elevCtx.strokeStyle = '#60a5fa';
        elevCtx.lineWidth = 2;
        elevCtx.stroke();
        elevCtx.fillStyle = '#e2e8f0';
        elevCtx.font = '9px sans-serif';
        elevCtx.fillText(`${label} · Y=${y}`, Math.min(ex + 8, w - 80), ey - 6);
      }
    };
    (level.rings ?? []).forEach((r, i) =>
      mark(r.x, r.y, r.label ?? `圈${i + 1}`, selection?.kind === 'ring' && selection.index === i),
    );
    (level.obstacles ?? []).forEach((o, i) =>
      mark(o.x, o.y, `障${i + 1}`, selection?.kind === 'obstacle' && selection.index === i),
    );
    (level.balloons ?? []).forEach((b, i) =>
      mark(b.x, b.y, `球${i + 1}`, selection?.kind === 'balloon' && selection.index === i),
    );
    q<HTMLElement>('#le-elev-hint').textContent =
      selection && selection.kind !== 'zone' ? '藍低 → 紅高' : '選取圈/障礙/氣球以確認高度';
  };

  const syncFormFromLevel = (): void => {
    q<HTMLInputElement>('#le-name').value = level.name;
    q<HTMLInputElement>('#le-hud').value = level.hud ?? '';
    q<HTMLTextAreaElement>('#le-intro').value = level.intro ?? '';
    q<HTMLInputElement>('#le-return').checked = !!level.returnHome;
    q<HTMLInputElement>('#le-freeplay').checked = !!level.freeplay;
    q<HTMLInputElement>('#le-draw').checked = !!level.draw;
  };

  const syncLevelFromForm = (): void => {
    level.name = q<HTMLInputElement>('#le-name').value.trim() || level.name;
    level.hud = q<HTMLInputElement>('#le-hud').value.trim();
    level.intro = q<HTMLTextAreaElement>('#le-intro').value;
    level.returnHome = q<HTMLInputElement>('#le-return').checked;
    level.freeplay = q<HTMLInputElement>('#le-freeplay').checked;
    level.draw = q<HTMLInputElement>('#le-draw').checked;
    if (!level.draw) {
      delete level.drawHeight;
      delete level.guide;
      delete level.view;
      delete level.orbit;
      delete level.penColors;
    }
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
    const faceWrap = q<HTMLElement>('#le-face-wrap');
    const zoneWrap = q<HTMLElement>('#le-zone-wrap');

    syncingProps = true;
    faceWrap.hidden = true;
    zoneWrap.hidden = true;
    if (kind === 'ring') {
      const r = level.rings![index];
      if (!r) return setSelection(null);
      q<HTMLInputElement>('#le-px').value = String(r.x);
      q<HTMLInputElement>('#le-pz').value = String(r.z);
      syncPyControls(r.y);
      pyWrap.hidden = false;
      sizeWrap.hidden = true;
      labelWrap.hidden = false;
      solidWrap.hidden = true;
      faceWrap.hidden = false;
      q<HTMLInputElement>('#le-label').value = r.label ?? '';
      q<HTMLInputElement>('#le-face-yaw').value = r.faceYaw != null ? String(r.faceYaw) : '';
      q<HTMLInputElement>('#le-face-tol').value = String(r.faceTol ?? 35);
    } else if (kind === 'obstacle') {
      const o = level.obstacles![index];
      if (!o) return setSelection(null);
      q<HTMLInputElement>('#le-px').value = String(o.x);
      q<HTMLInputElement>('#le-pz').value = String(o.z);
      syncPyControls(o.y);
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
      syncPyControls(b.y);
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
      zoneWrap.hidden = false;
      const ztype = z.type ?? 'position';
      q<HTMLSelectElement>('#le-zone-type').value = ztype;
      q<HTMLElement>('#le-zone-position').hidden = ztype !== 'position';
      q<HTMLElement>('#le-zone-altitude').hidden = ztype !== 'altitude';
      q<HTMLElement>('#le-zone-heading').hidden = ztype !== 'heading';
      if (ztype === 'position') {
        const pz = z as PositionZone;
        q<HTMLInputElement>('#le-zone-minx').value = String(pz.minX ?? z.x - 1);
        q<HTMLInputElement>('#le-zone-maxx').value = String(pz.maxX ?? z.x + 1);
        q<HTMLInputElement>('#le-zone-minz').value = String(pz.minZ ?? z.z - 1);
        q<HTMLInputElement>('#le-zone-maxz').value = String(pz.maxZ ?? z.z + 1);
      } else if (ztype === 'altitude') {
        const az = z as AltitudeZone;
        q<HTMLInputElement>('#le-zone-miny').value = String(az.minY ?? 1);
        q<HTMLInputElement>('#le-zone-maxy').value = String(az.maxY ?? 3);
      } else if (ztype === 'heading') {
        const hz = z as HeadingZone;
        q<HTMLInputElement>('#le-zone-yaw').value = String(hz.targetYaw ?? 0);
        q<HTMLInputElement>('#le-zone-tol').value = String(hz.tolerance ?? 30);
      }
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
      const faceRaw = q<HTMLInputElement>('#le-face-yaw').value.trim();
      const faceYaw = faceRaw === '' ? undefined : Number(faceRaw);
      const faceTol = Number(q<HTMLInputElement>('#le-face-tol').value) || 35;
      rings[selection.index] = {
        ...r,
        x,
        z,
        y,
        label: q<HTMLInputElement>('#le-label').value.trim() || r.label,
        faceYaw,
        faceTol: faceYaw != null ? faceTol : undefined,
      };
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
      const ztype = q<HTMLSelectElement>('#le-zone-type').value as PassZoneDef['type'];
      const label = q<HTMLInputElement>('#le-label').value.trim() || zn.label;
      let next: PassZoneDef;
      if (ztype === 'altitude') {
        next = {
          type: 'altitude',
          x,
          z,
          label,
          minY: Number(q<HTMLInputElement>('#le-zone-miny').value) || 1,
          maxY: Number(q<HTMLInputElement>('#le-zone-maxy').value) || 3,
        };
      } else if (ztype === 'heading') {
        next = {
          type: 'heading',
          x,
          z,
          label,
          targetYaw: Number(q<HTMLInputElement>('#le-zone-yaw').value) || 0,
          tolerance: Number(q<HTMLInputElement>('#le-zone-tol').value) || 30,
        };
      } else {
        next = {
          type: 'position',
          x,
          z,
          label,
          minX: Number(q<HTMLInputElement>('#le-zone-minx').value),
          maxX: Number(q<HTMLInputElement>('#le-zone-maxx').value),
          minZ: Number(q<HTMLInputElement>('#le-zone-minz').value),
          maxZ: Number(q<HTMLInputElement>('#le-zone-maxz').value),
        };
      }
      zones[selection.index] = next;
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

  const nudgeHeight = (dy: number): void => {
    if (!selection || selection.kind === 'zone') return;
    const step = 0.5;
    const clampY = (y: number): number => Math.max(0, Math.min(EDITOR_MAX_Y, Math.round((y + dy) / step) * step));
    if (selection.kind === 'ring') {
      const rings = [...(level.rings ?? [])];
      const r = rings[selection.index];
      if (!r) return;
      rings[selection.index] = { ...r, y: clampY(r.y) };
      level.rings = rings;
    } else if (selection.kind === 'obstacle') {
      const obs = [...(level.obstacles ?? [])];
      const o = obs[selection.index];
      if (!o) return;
      obs[selection.index] = { ...o, y: clampY(o.y) };
      level.obstacles = obs;
    } else if (selection.kind === 'balloon') {
      const balloons = [...(level.balloons ?? [])];
      const b = balloons[selection.index];
      if (!b) return;
      balloons[selection.index] = { ...b, y: clampY(b.y) };
      level.balloons = balloons;
    }
    syncPropsPanel();
    draw();
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
    } else if (placeMode === 'zone') {
      const n = (level.passZones?.length ?? 0) + 1;
      level.passZones = [
        ...(level.passZones ?? []),
        {
          type: 'position',
          x: wx,
          z: wz,
          label: `步驟 ${n}`,
          minX: wx - 1,
          maxX: wx + 1,
          minZ: wz - 1,
          maxZ: wz + 1,
        },
      ];
      setSelection({ kind: 'zone', index: level.passZones.length - 1 });
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

  ['#le-px', '#le-pz', '#le-py', '#le-py-range', '#le-size', '#le-label', '#le-solid', '#le-face-yaw', '#le-face-tol',
    '#le-zone-minx', '#le-zone-maxx', '#le-zone-minz', '#le-zone-maxz',
    '#le-zone-miny', '#le-zone-maxy', '#le-zone-yaw', '#le-zone-tol'].forEach((sel) => {
    q<HTMLElement>(sel).addEventListener('input', () => applyPropsToSelection());
    q<HTMLElement>(sel).addEventListener('change', () => applyPropsToSelection());
  });

  q<HTMLButtonElement>('#le-del-sel').addEventListener('click', deleteSelection);

  q<HTMLInputElement>('#le-py-range').addEventListener('input', () => {
    q<HTMLInputElement>('#le-py').value = q<HTMLInputElement>('#le-py-range').value;
    applyPropsToSelection();
  });
  q<HTMLElement>('#le-height-presets').querySelectorAll<HTMLButtonElement>('button[data-y]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const y = Number(btn.dataset['y']);
      if (!Number.isFinite(y)) return;
      syncPyControls(y);
      applyPropsToSelection();
    });
  });

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
    else if (e.key === 'PageUp') {
      e.preventDefault();
      nudgeHeight(step);
    } else if (e.key === 'PageDown') {
      e.preventDefault();
      nudgeHeight(-step);
    }
  });
  backdrop.tabIndex = -1;

  q<HTMLInputElement>('#le-name').addEventListener('input', scheduleSave);
  q<HTMLInputElement>('#le-hud').addEventListener('input', scheduleSave);
  q<HTMLTextAreaElement>('#le-intro').addEventListener('input', scheduleSave);
  q<HTMLInputElement>('#le-return').addEventListener('change', scheduleSave);
  q<HTMLInputElement>('#le-freeplay').addEventListener('change', scheduleSave);
  q<HTMLInputElement>('#le-draw').addEventListener('change', scheduleSave);

  q<HTMLSelectElement>('#le-zone-type').addEventListener('change', () => {
    const ztype = q<HTMLSelectElement>('#le-zone-type').value;
    q<HTMLElement>('#le-zone-position').hidden = ztype !== 'position';
    q<HTMLElement>('#le-zone-altitude').hidden = ztype !== 'altitude';
    q<HTMLElement>('#le-zone-heading').hidden = ztype !== 'heading';
    applyPropsToSelection();
  });

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

  const myKitsHost = q<HTMLElement>('#le-my-kits');
  const orgKitsHost = q<HTMLElement>('#le-org-kits');
  const orgKitsWrap = q<HTMLElement>('#le-org-kits-wrap');
  let myKits: TeacherLevelKitBrief[] = [];
  let orgKits: TeacherLevelKitBrief[] = [];

  const insertKitById = (kitId: number): void => {
    void fetchTeacherLevelKit(kitId)
      .then((detail) => {
        const snippet = teacherKitToSnippet({
          id: detail.id,
          name: detail.name,
          desc: detail.desc,
          category: detail.category,
          patch: detail.patch as Partial<LevelDef>,
        });
        applySnippet(snippet);
      })
      .catch((e) => toast(errText(e, '載入'), 'error'));
  };

  const renderMyKits = (): void => {
    if (!myKits.length) {
      myKitsHost.innerHTML = '<p class="note">尚無自訂素材，完成佈局後點「儲存為素材」。</p>';
    } else {
      myKitsHost.innerHTML = myKits
        .map(
          (k) =>
            `<div class="lvl-kit-card lvl-kit-card-mine" data-my-kit="${k.id}">
              <button type="button" class="lvl-kit-card-main" data-insert-kit="${k.id}" title="${esc(k.desc || k.name)}">
                <span class="lvl-kit-card-name">${esc(k.name)}</span>
                <span class="lvl-kit-card-desc">${esc(k.desc || (LEVEL_KIT_CATEGORIES.find((c) => c.id === k.category)?.label ?? ''))}</span>
              </button>
              <label class="lvl-kit-share" title="分享給同校老師">
                <input type="checkbox" data-share-kit="${k.id}" ${k.sharedWithOrg ? 'checked' : ''}>
                <span>分享</span>
              </label>
              <button type="button" class="lvl-kit-del" data-del-kit="${k.id}" title="刪除素材">${ICONS.x}</button>
            </div>`,
        )
        .join('');
      myKitsHost.querySelectorAll<HTMLButtonElement>('[data-insert-kit]').forEach((btn) => {
        btn.addEventListener('click', () => insertKitById(Number(btn.dataset['insertKit'])));
      });
      myKitsHost.querySelectorAll<HTMLInputElement>('[data-share-kit]').forEach((inp) => {
        inp.addEventListener('change', () => {
          const id = Number(inp.dataset['shareKit']);
          void patchTeacherLevelKit(id, { sharedWithOrg: inp.checked })
            .then((updated) => {
              myKits = myKits.map((k) => (k.id === id ? { ...k, sharedWithOrg: updated.sharedWithOrg } : k));
              toast(inp.checked ? '已分享給同校' : '已取消分享', 'success');
            })
            .catch((e) => {
              inp.checked = !inp.checked;
              toast(errText(e, '更新分享'), 'error');
            });
        });
      });
      myKitsHost.querySelectorAll<HTMLButtonElement>('[data-del-kit]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = Number(btn.dataset['delKit']);
          if (!confirm('確定刪除此素材？')) return;
          void deleteTeacherLevelKit(id)
            .then(() => {
              myKits = myKits.filter((k) => k.id !== id);
              renderMyKits();
              toast('已刪除素材', 'success');
            })
            .catch((e) => toast(errText(e, '刪除'), 'error'));
        });
      });
    }

    if (!orgKits.length) {
      orgKitsWrap.hidden = true;
      orgKitsHost.innerHTML = '';
    } else {
      orgKitsWrap.hidden = false;
      orgKitsHost.innerHTML = orgKits
        .map(
          (k) =>
            `<button type="button" class="lvl-kit-card" data-org-kit="${k.id}" title="${esc(k.desc || k.name)}">
              <span class="lvl-kit-card-name">${esc(k.name)}</span>
              <span class="lvl-kit-card-desc">${esc(k.ownerName ? `${k.ownerName} · ` : '')}${esc(LEVEL_KIT_CATEGORIES.find((c) => c.id === k.category)?.label ?? '')}</span>
            </button>`,
        )
        .join('');
      orgKitsHost.querySelectorAll<HTMLButtonElement>('[data-org-kit]').forEach((btn) => {
        btn.addEventListener('click', () => insertKitById(Number(btn.dataset['orgKit'])));
      });
    }
  };

  const loadMyKits = (): void => {
    void fetchTeacherLevelKits()
      .then((res) => {
        myKits = res.mine;
        orgKits = res.org;
        renderMyKits();
      })
      .catch(() => {
        myKitsHost.innerHTML = '<p class="note">無法載入我的素材</p>';
      });
  };

  const runGoalWizard = (): void => {
    if (!isLevelLayoutEmpty(level) && !confirm('套用精靈會清空現有圈點與障礙，確定繼續？')) return;
    openLevelGoalWizard({
      onSelect: (presetId) => {
        const preset = getLevelGoalPreset(presetId);
        const applied = applyLevelGoalPreset(level, presetId, 'replace');
        if (!applied || !preset) {
          toast('模板不存在', 'error');
          return;
        }
        level = applied;
        q<HTMLInputElement>('#le-name').value = level.name;
        setSelection(null);
        syncFormFromLevel();
        draw();
        scheduleSave();
        toast(`已套用「${preset.name}」`, 'success');
      },
    });
  };

  q<HTMLButtonElement>('#le-wizard-btn').addEventListener('click', runGoalWizard);

  const openSaveKitDialog = (): void => {
    syncLevelFromForm();
    const includeTasks = (level.passZones?.length ?? 0) > 0 || !!level.freeplay;
    const includeDraw = !!level.draw;
    const patch = extractLevelKitPatch(level, {
      includeTasks,
      includeDraw,
      includeMeta: false,
    });
    const errs = validateLevelKitPatch(patch);
    if (errs.length) {
      toast(errs[0] ?? '關卡尚無可儲存的佈局', 'error');
      return;
    }
    const category = inferLevelKitCategory(patch);
    const dlg = document.createElement('div');
    dlg.className = 'modal-backdrop';
    dlg.innerHTML = `
      <div class="modal" role="dialog">
        <div class="modal-head"><h2 class="modal-title">儲存為素材</h2></div>
        <div class="field"><label class="field-label">名稱</label><input id="sk-name" type="text" maxlength="120" value="${esc(level.name)}"></div>
        <div class="field"><label class="field-label">說明</label><input id="sk-desc" type="text" maxlength="400" placeholder="選填"></div>
        <div class="field"><label class="field-label">分類</label>
          <select id="sk-cat">${LEVEL_KIT_CATEGORIES.map((c) => `<option value="${c.id}" ${c.id === category ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select>
        </div>
        <label class="check-row"><input type="checkbox" id="sk-tasks" ${includeTasks ? 'checked' : ''}>含任務步驟（passZones）</label>
        <label class="check-row"><input type="checkbox" id="sk-draw" ${includeDraw ? 'checked' : ''}>含畫畫設定（draw / guide）</label>
        <label class="check-row"><input type="checkbox" id="sk-share">分享給同校老師</label>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="sk-cancel">取消</button>
          <button type="button" class="btn btn-primary" id="sk-save">儲存</button>
        </div>
      </div>`;
    document.body.appendChild(dlg);
    const closeDlg = (): void => dlg.remove();
    dlg.querySelector('#sk-cancel')?.addEventListener('click', closeDlg);
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) closeDlg();
    });
    dlg.querySelector('#sk-save')?.addEventListener('click', () => {
      const tasks = (dlg.querySelector<HTMLInputElement>('#sk-tasks'))!.checked;
      const draw = (dlg.querySelector<HTMLInputElement>('#sk-draw'))!.checked;
      const finalPatch = extractLevelKitPatch(level, {
        includeTasks: tasks,
        includeDraw: draw,
        includeMeta: false,
      });
      const valErrs = validateLevelKitPatch(finalPatch);
      if (valErrs.length) {
        toast(valErrs[0] ?? '素材內容無效', 'error');
        return;
      }
      const name = (dlg.querySelector<HTMLInputElement>('#sk-name'))!.value.trim();
      if (!name) {
        toast('請輸入素材名稱', 'error');
        return;
      }
      void createTeacherLevelKit({
        name,
        desc: (dlg.querySelector<HTMLInputElement>('#sk-desc'))!.value.trim(),
        category: (dlg.querySelector<HTMLSelectElement>('#sk-cat'))!.value as LevelKitCategory,
        patch: finalPatch as Record<string, unknown>,
        sharedWithOrg: (dlg.querySelector<HTMLInputElement>('#sk-share'))!.checked,
      })
        .then((created) => {
          myKits = [
            {
              id: created.id,
              name: created.name,
              desc: created.desc,
              category: created.category,
              updatedAt: created.updatedAt,
              scope: 'mine',
              sharedWithOrg: created.sharedWithOrg,
            },
            ...myKits,
          ];
          renderMyKits();
          closeDlg();
          toast(`已儲存「${created.name}」`, 'success');
        })
        .catch((e) => toast(errText(e, '儲存'), 'error'));
    });
  };

  q<HTMLButtonElement>('#le-save-kit').addEventListener('click', openSaveKitDialog);

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
      loadMyKits();
      backdrop.focus();
      if (editorOpts?.showWizard && isLevelLayoutEmpty(level)) {
        runGoalWizard();
      }
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
