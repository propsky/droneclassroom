// 自訂關卡編輯器 — 預設 2.5D 斜視、格線吸附、物件選取與座標面板、範本庫。
// 滾輪只縮放地圖畫布（#le-canvas），不攔截側欄或頁面其他區域。
import type { LevelDef, TeacherLevelKitBrief, TeacherLevelBrief } from '@creafly/shared';
import {
  balloonDiameter,
  EDITOR_HALF,
  EDITOR_MAX_Y,
  EDITOR_WORLD,
  FLOOR_SIZE_MIN,
  floorRect,
  floorSizeM,
  FlightArea,
  type FlightBounds,
  heightHueColor,
  isoCanvasToWorld,
  isoDepthKey,
  isoGroundToCanvas,
  isoLayout,
  isoWorldToCanvas,
  mapPointerToContent,
  refitMapZoom,
  zoomMapAtPointer,
  LEVEL_KIT_CATEGORIES,
  applyLevelKitSnippet,
  applyLevelGoalPreset,
  extractLevelKitPatch,
  getLevelGoalPreset,
  getLevelKitSnippet,
  inferLevelKitCategory,
  isLevelLayoutEmpty,
  levelKitApplyMode,
  levelKitByCategory,
  ringDiameter,
  ringYawDeg,
  RingGuide,
  sideWorldToCanvas,
  snapClampXZ,
  teacherKitToSnippet,
  topCanvasToWorld,
  topWorldToCanvas,
  validateLevelKitPatch,
  type EditorViewMode,
  type MapViewTransform,
  type LevelKitCategory,
  type LevelKitSnippet,
} from '@creafly/shared';
import { API_BASE } from '../backend';
import {
  ApiError,
  createTeacherLevelKit,
  deleteLevelFloor,
  deleteTeacherLevelKit,
  fetchTeacherLevel,
  fetchTeacherLevelKit,
  fetchTeacherLevelKits,
  patchTeacherLevel,
  patchTeacherLevelKit,
  uploadLevelFloor,
} from '../api';
import { publishAndAddToCatalog, ensureCatalogForBroadcast } from '../catalogFlow';
import {
  backupIsNewerThanServer,
  clearDraftBackup,
  loadDraftBackup,
  saveDraftBackup,
} from '../levelDraftBackup';
import { downloadLevelJson, pickAndParseLevelJson } from '../levelIo';
import { ICONS } from '../icons';
import { openPreviewModal } from '../preview';
import { toast } from '../toast';
import { openLevelGoalWizard } from './levelGoalWizard';
import { FloorScale } from './floorScale';
import { ItemOrder } from './levelOrder';
import { ZoneEdit } from './zoneEdit';
import {
  createPropsController,
  propsPanelHtml,
  type EditorSelection,
} from './levelEditorProps';
import {
  DEFAULT_BALLOON_COLORS,
  DEFAULT_OBSTACLE_SOFT_COLOR,
  DEFAULT_OBSTACLE_SOLID_COLOR,
  DEFAULT_RING_COLOR,
  obstacleDefaultColor,
  parseLevelColor,
} from '@creafly/shared';

const HALF = EDITOR_HALF;
const WORLD = EDITOR_WORLD;
const CANVAS_PX = 480;

export interface LevelEditorPanel {
  destroy(): void;
}

type ObjKind = EditorSelection['kind'];
type Selection = EditorSelection;
type PlaceMode = 'select' | 'ring' | 'obstacle-solid' | 'obstacle-soft' | 'balloon' | 'zone';

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
    floorImage: isFloorImagePath(raw.floorImage) ? raw.floorImage : undefined,
  };
}

function isFloorImagePath(v: unknown): v is string {
  return typeof v === 'string' && /^\/api\/levels\/[^/]+\/floor(\?v=\d+)?$/.test(v);
}

/** 發布 / 廣播與班級目錄（由 dashboard 注入） */
export interface LevelEditorContext {
  getTeamId(): number | null;
  broadcastLoadLevel(levelId: string): boolean;
  onCatalogUpdated(): void;
}

export interface LevelEditorOptions {
  /** 開啟後自動顯示教學目標精靈 */
  showWizard?: boolean;
  ctx?: LevelEditorContext;
}

export function openLevelEditor(
  levelPk: number,
  onSaved?: () => void,
  editorOpts?: LevelEditorOptions,
): LevelEditorPanel {
  const backdrop = document.createElement('div');
  backdrop.className = 'lvl-studio';
  backdrop.innerHTML = `
    <div class="lvl-studio-shell" role="dialog" aria-modal="true" aria-label="關卡編輯">
      <header class="lvl-studio-bar">
        <div class="lvl-studio-bar-text">
          <h2 class="lvl-studio-title" id="le-title">關卡編輯</h2>
          <p class="lvl-studio-sub" id="le-sub">載入中…</p>
        </div>
        <span class="lvl-save-hint" id="le-save-hint"></span>
        <div class="lvl-studio-actions">
          <button type="button" class="btn btn-ghost btn-sm" id="le-import">${ICONS.plus}匯入 JSON</button>
          <button type="button" class="btn btn-ghost btn-sm" id="le-export">匯出 JSON</button>
          <button type="button" class="btn btn-ghost btn-sm" id="le-preview">${ICONS.play}試飛</button>
          <button type="button" class="btn btn-ghost btn-sm" id="le-publish" hidden>${ICONS.check}發布並加入本班</button>
          <button type="button" class="btn btn-ghost btn-sm" id="le-broadcast" hidden>廣播全班</button>
          <button type="button" class="btn btn-primary btn-sm" id="le-save-now">${ICONS.check}立即儲存</button>
          <button type="button" class="btn btn-ghost btn-sm" id="le-close">${ICONS.x}關閉</button>
        </div>
      </header>
      <div id="le-backup-banner" class="lvl-backup-banner" hidden>
        <span id="le-backup-msg">本機有較新的草稿備份</span>
        <button type="button" class="btn btn-primary btn-sm" id="le-restore-backup">恢復本機草稿</button>
        <button type="button" class="btn btn-ghost btn-sm" id="le-discard-backup">忽略</button>
      </div>
      <div class="lvl-studio-body" id="le-studio-body">
        <aside class="lvl-studio-tools">
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
          <label class="check-row"><input type="checkbox" id="le-ring-order">依序穿圈（照圈上編號，穿錯順序不算）</label>
          <label class="check-row"><input type="checkbox" id="le-freeplay">自由活動（無順序過關）</label>
          <label class="check-row"><input type="checkbox" id="le-draw">畫畫教室模式</label>

          <section class="lvl-floor">
            <h3 class="lvl-kit-title">場地底圖</h3>
            <p class="note lvl-kit-hint">上傳 JPG、PNG 或 WebP，最大 2 MB。照片保持原比例鋪在關卡中央，長邊預設 30 公尺。</p>
            <img id="le-floor-thumb" class="lvl-floor-preview" alt="場地底圖預覽" hidden>
            <label class="lvl-floor-size" id="le-floor-size-row" hidden>照片長邊實際
              <input id="le-floor-size" type="number" min="${FLOOR_SIZE_MIN}" max="${WORLD}" step="0.5" placeholder="${WORLD}" inputmode="decimal">
              公尺</label>
            <p class="note lvl-kit-hint" id="le-floor-dims" hidden></p>
            <div class="lvl-floor-actions">
              <button type="button" class="btn btn-ghost btn-sm" id="le-floor-pick">上傳場地底圖</button>
              <button type="button" class="btn btn-ghost btn-sm" id="le-floor-calib" hidden title="在照片上點兩個已知實際距離的點（例如圓的直徑），自動算出正確比例">用兩點量比例</button>
              <button type="button" class="btn btn-ghost btn-sm" id="le-floor-clear" hidden>移除場地底圖</button>
            </div>
            <input id="le-floor-file" type="file" accept="image/jpeg,image/png,image/webp" hidden>
          </section>

          <section class="lvl-floor">
            <h3 class="lvl-kit-title">飛行範圍</h3>
            <label class="check-row"><input type="checkbox" id="le-bounds">限制在範圍內（飛不出去）</label>
            <div class="lvl-bounds-grid" id="le-bounds-fields" hidden>
              <label>左 X <input id="le-b-minx" type="number" step="0.5" class="mono"></label>
              <label>右 X <input id="le-b-maxx" type="number" step="0.5" class="mono"></label>
              <label>前 Z <input id="le-b-minz" type="number" step="0.5" class="mono"></label>
              <label>後 Z <input id="le-b-maxz" type="number" step="0.5" class="mono"></label>
            </div>
            <div class="lvl-floor-actions">
              <button type="button" class="btn btn-ghost btn-sm" id="le-bounds-fit" hidden>對齊場地底圖</button>
            </div>
            <p class="note lvl-kit-hint">地圖上的紅框就是邊界，學生飛到框邊會停住；起飛墊一定在框內。</p>
            <p class="note lvl-bounds-warn" id="le-bounds-warn" hidden></p>
          </section>

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

          <div class="lvl-kit">
            <div class="lvl-kit-head">
              <h3 class="lvl-kit-title">我的範本</h3>
              <button type="button" class="btn btn-ghost btn-sm" id="le-save-kit">${ICONS.plus}儲存為範本</button>
            </div>
            <p class="note lvl-kit-hint">完成佈局後可存成範本；勾選「分享」後同校老師也能使用。</p>
            <div id="le-my-kits" class="lvl-kit-grid"></div>
            <div id="le-org-kits-wrap" hidden>
              <h4 class="lvl-kit-subtitle">同校分享</h4>
              <div id="le-org-kits" class="lvl-kit-grid"></div>
            </div>
          </div>
          <div class="lvl-kit">
            <h3 class="lvl-kit-title">官方範本庫</h3>
            <p class="note lvl-kit-hint">點選插入範本；任務或畫畫類會覆寫目前的步驟。</p>
            <div id="le-kit-panels"></div>
          </div>
        </div>
        </aside>
        <main class="lvl-studio-stage">
          <div class="lvl-canvas-head">
            <div class="le-view-tabs" id="le-view-tabs" role="tablist" aria-label="編輯視角">
              <button type="button" class="btn btn-ghost btn-xs le-view" data-view="top" role="tab">俯視</button>
              <button type="button" class="btn btn-ghost btn-xs le-view active" data-view="iso" role="tab">2.5D</button>
              <button type="button" class="btn btn-ghost btn-xs le-view" data-view="side" role="tab">側視</button>
            </div>
            <span class="mono" id="le-cursor">X 0 · Z 0</span>
            <span class="mono" id="le-zoom" title="地圖縮放">100%</span>
            <span class="note le-canvas-hint">↑ 前方為 -Z · 拖曳移動 · 滾輪縮放 · 方向鍵微調 · Del 刪除</span>
            <p class="note lvl-legend">
              <span class="le-legend-ring">○ 圈</span>
              <span class="le-legend-solid">■ 實心</span>
              <span class="le-legend-soft">■ 標記</span>
              <span class="le-legend-balloon">● 氣球</span>
              <span class="le-legend-zone">▢ 任務</span>
            </p>
          </div>
          <div class="le-canvas-frame">
            <div class="le-canvas-box" id="le-canvas-box">
              <canvas id="le-canvas" width="${CANVAS_PX}" height="${CANVAS_PX}" aria-label="關卡編輯器"></canvas>
            </div>
          </div>
        </main>
        <aside class="lvl-studio-inspector" id="le-inspector">
          <h3 class="lvl-inspector-title">細節</h3>
          <div id="le-inspector-idle">
            <p class="le-inspector-prompt">尚未選取物件</p>
            <p class="note">在地圖上點選穿圈、障礙、氣球或任務點，即可在這裡調整。</p>
            <dl class="le-inspector-readout">
              <div><dt>游標 X</dt><dd class="mono" id="le-readout-x">0</dd></div>
              <div><dt>游標 Z</dt><dd class="mono" id="le-readout-z">0</dd></div>
              <div class="le-place-y-row">
                <dt>放置高度</dt>
                <dd class="mono" id="le-readout-place-y">2.5 m</dd>
                <input id="le-place-y" class="le-height-range" type="range" min="0.5" max="8" step="0.5" value="2.5" aria-label="放置高度">
              </div>
            </dl>
            <p class="note" id="le-view-hint">2.5D：拖曳沿地面移動 X/Z · 滾輪放大縮小 · 藍柱=高度</p>
          </div>
          ${propsPanelHtml()}
        </aside>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  const q = <T extends HTMLElement>(sel: string): T => backdrop.querySelector<T>(sel)!;
  const canvas = q<HTMLCanvasElement>('#le-canvas');
  const ctx = canvas.getContext('2d')!;
  const saveHint = q<HTMLElement>('#le-save-hint');
  const cursorEl = q<HTMLElement>('#le-cursor');

  const editorCtx = editorOpts?.ctx;
  let levelPkLocal = levelPk;
  let levelIdStr = '';
  let levelStatus: TeacherLevelBrief['status'] = 'draft';
  let serverUpdatedAt = 0;
  let level: LevelDef = defaultLevel('', '');
  let selection: Selection | null = null;
  let dragSel: Selection | null = null;
  let placeMode: PlaceMode = 'select';
  let viewMode: EditorViewMode = 'iso';
  let placeHeightY = 2.5;
  let mapView: MapViewTransform = { zoom: 1, panX: 0, panY: 0 };
  let snapStep = 1;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;
  let syncingProps = false;
  let floorImg: HTMLImageElement | null = null;
  /** 兩點量比例進行中：a＝已點的第一點（地面座標，不吸附格線）。null＝沒在量。 */
  let calib: { a: { x: number; z: number } | null } | null = null;
  let resizeObserver: ResizeObserver | null = null;
  const prevBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  const getSnapStep = (): number => {
    const v = backdrop.querySelector<HTMLInputElement>('input[name="le-snap"]:checked')?.value;
    return v === '0.5' ? 0.5 : v === '0' ? 0 : 1;
  };

  const sideCanvasY = (y: number, h: number): number =>
    h - 10 - (y / EDITOR_MAX_Y) * (h - 24);

  const sideYFromCanvas = (py: number, h: number): number => {
    const raw = ((h - 10 - py) / (h - 24)) * EDITOR_MAX_Y;
    return Math.max(0, Math.min(EDITOR_MAX_Y, Math.round(raw * 2) / 2));
  };

  /** 俯視／2.5D 用正方形場地，置中鋪在滿版畫布上，圓不會被拉成橢圓。 */
  const fieldFrame = (w: number, h: number): { ox: number; oy: number; size: number } => {
    const size = Math.max(1, Math.min(w, h));
    return { ox: (w - size) / 2, oy: (h - size) / 2, size };
  };

  const project = (x: number, z: number, y = 0): [number, number] => {
    const w = canvas.width;
    const h = canvas.height;
    if (viewMode === 'side') return sideWorldToCanvas(x, y, w, h);
    const { ox, oy, size } = fieldFrame(w, h);
    const [px, py] =
      viewMode === 'iso'
        ? isoWorldToCanvas(x, z, y, size, size)
        : topWorldToCanvas(x, z, size, size);
    return [px + ox, py + oy];
  };

  const unproject = (px: number, py: number, planeY = placeHeightY): { x: number; z: number } => {
    const w = canvas.width;
    const h = canvas.height;
    const { ox, oy, size } = fieldFrame(w, h);
    if (viewMode === 'iso') return isoCanvasToWorld(px - ox, py - oy, size, size, planeY, snapStep);
    return topCanvasToWorld(px - ox, py - oy, size, size, snapStep);
  };

  const objectPlaneY = (sel: Selection): number => {
    if (sel.kind === 'ring') return level.rings?.[sel.index]?.y ?? placeHeightY;
    if (sel.kind === 'obstacle') return level.obstacles?.[sel.index]?.y ?? placeHeightY;
    if (sel.kind === 'balloon') return level.balloons?.[sel.index]?.y ?? placeHeightY;
    return 0;
  };

  const ringPxRadius = (diam: number): number => {
    const { size } = fieldFrame(canvas.width, canvas.height);
    return (diam / WORLD) * size * 0.5 + 2;
  };

  const syncPlaceHeightReadout = (): void => {
    q<HTMLElement>('#le-readout-place-y').textContent = `${placeHeightY.toFixed(1)} m`;
    q<HTMLInputElement>('#le-place-y').value = String(placeHeightY);
  };

  const syncZoomReadout = (): void => {
    q<HTMLElement>('#le-zoom').textContent = `${Math.round(mapView.zoom * 100)}%`;
  };

  const syncInspectorIdle = (x: number, z: number): void => {
    q<HTMLElement>('#le-readout-x').textContent = String(x);
    q<HTMLElement>('#le-readout-z').textContent = String(z);
    cursorEl.textContent = viewMode === 'side' ? `側視 · X ${x}` : `X ${x} · Z ${z}`;
  };

  const isSelected = (kind: ObjKind, index: number): boolean =>
    selection?.kind === kind && selection.index === index;

  const emptyBanner = q<HTMLElement>('#le-empty-banner');

  const syncPyControls = (y: number): void => {
    q<HTMLInputElement>('#le-py').value = String(y);
    q<HTMLInputElement>('#le-py-range').value = String(y);
    q<HTMLElement>('#le-py-readout').textContent = ` ${y.toFixed(1)} m`;
  };

  const syncViewHint = (): void => {
    const el = q<HTMLElement>('#le-view-hint');
    if (viewMode === 'iso') {
      el.textContent = '2.5D：拖曳沿地面移動 X/Z · 滾輪放大縮小 · 藍柱=高度';
    } else if (viewMode === 'side') {
      el.textContent = '側視：拖曳調 Y · 滾輪放大縮小 · 放置請切換俯視或 2.5D';
    } else {
      el.textContent = '俯視：滾輪放大縮小 · 放置高度用右側滑桿 · 側視可拖曳調 Y';
    }
  };

  const drawIsoStem = (x: number, z: number, y: number): void => {
    if (y <= 0.05) return;
    const { ox, oy, size } = fieldFrame(canvas.width, canvas.height);
    const [gx0, gy0] = isoGroundToCanvas(x, z, size, size);
    const gx = gx0 + ox;
    const gy = gy0 + oy;
    const [tx, ty] = project(x, z, y);
    ctx.strokeStyle = heightHueColor(y, 0.75);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(gx, gy, 7, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
  };

  /** 圈的編號牌：深底白字，鋪在任何底圖上都看得清楚；依序穿圈時金框。號碼＝學生端圈上的號碼。 */
  const drawRingBadge = (px: number, py: number, index: number): void => {
    const text = RingGuide.label(index);
    ctx.font = 'bold 12px sans-serif';
    const r = Math.max(10, ctx.measureText(text).width / 2 + 5);
    ctx.fillStyle = 'rgba(15,23,42,0.9)';
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = level.ringOrder === 'sequential' ? '#fbbf24' : 'rgba(226,232,240,0.75)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, px, py + 0.5);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  };

  /** 依序穿圈：在地面畫出飛行路線（起飛墊 → 1 → 2 … → 返航），每段中間有箭頭指方向。 */
  const drawRingRoute = (): void => {
    const rings = level.rings ?? [];
    if (level.ringOrder !== 'sequential' || rings.length === 0) return;
    const home = { x: 0, z: 0 };
    const stops = [home, ...rings, ...(level.returnHome ? [home] : [])].map((p) => project(p.x, p.z, 0));
    ctx.strokeStyle = 'rgba(251,191,36,0.95)';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    stops.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#fbbf24';
    for (let i = 1; i < stops.length; i++) {
      const [ax, ay] = stops[i - 1]!;
      const [bx, by] = stops[i]!;
      if (Math.hypot(bx - ax, by - ay) < 24) continue;
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      const a = Math.atan2(by - ay, bx - ax);
      ctx.beginPath();
      ctx.moveTo(mx + Math.cos(a) * 7, my + Math.sin(a) * 7);
      ctx.lineTo(mx + Math.cos(a + 2.5) * 7, my + Math.sin(a + 2.5) * 7);
      ctx.lineTo(mx + Math.cos(a - 2.5) * 7, my + Math.sin(a - 2.5) * 7);
      ctx.closePath();
      ctx.fill();
    }
  };

  /** 照片在地面上的範圍（還沒載入完回 null）。 */
  const photoRect = (): { width: number; depth: number } | null =>
    floorImg && floorImg.naturalWidth > 0
      ? floorRect(floorImg.naturalWidth, floorImg.naturalHeight, floorSizeM(level.floorSize))
      : null;

  const half = (v: number): number => Math.round(v * 2) / 2;

  /** 剛勾「限制範圍」時的預設框：有底圖就對齊照片，否則包住場上所有物件再留 2m。 */
  const defaultBounds = (): FlightBounds => {
    const photo = photoRect();
    if (photo) {
      return { minX: half(-photo.width / 2), maxX: half(photo.width / 2), minZ: half(-photo.depth / 2), maxZ: half(photo.depth / 2) };
    }
    const pts = [
      ...(level.rings ?? []),
      ...(level.balloons ?? []),
      ...(level.passZones ?? []),
      ...(level.obstacles ?? []),
    ];
    const xs = pts.map((p) => p.x);
    const zs = pts.map((p) => p.z);
    return {
      minX: half(Math.min(-5, ...xs) - 2),
      maxX: half(Math.max(5, ...xs) + 2),
      minZ: half(Math.min(-5, ...zs) - 2),
      maxZ: half(Math.max(5, ...zs) + 2),
    };
  };

  /** 飛行範圍面板：勾選、四邊數值、框外物件警告。 */
  const syncBoundsChrome = (): void => {
    const b = FlightArea.of(level);
    q<HTMLInputElement>('#le-bounds').checked = !!b;
    q<HTMLElement>('#le-bounds-fields').hidden = !b;
    q<HTMLButtonElement>('#le-bounds-fit').hidden = !b || !photoRect();
    if (b) {
      const active = document.activeElement;
      const put = (id: string, v: number): void => {
        const el = q<HTMLInputElement>(id);
        if (el !== active) el.value = String(v);
      };
      put('#le-b-minx', b.minX);
      put('#le-b-maxx', b.maxX);
      put('#le-b-minz', b.minZ);
      put('#le-b-maxz', b.maxZ);
    }
    const outside = b
      ? [...(level.rings ?? []), ...(level.balloons ?? []), ...(level.passZones ?? [])].filter(
          (p) => !FlightArea.contains(b, p.x, p.z),
        ).length
      : 0;
    const warn = q<HTMLElement>('#le-bounds-warn');
    warn.hidden = outside === 0;
    warn.textContent = `有 ${outside} 個圈／氣球／任務點在範圍外，學生飛不到，請移進紅框或放大範圍。`;
  };

  /** 飛行範圍紅框（地面，俯視與 2.5D 共用）。 */
  const drawFlightBounds = (): void => {
    const b = FlightArea.of(level);
    if (!b) return;
    const pts = [
      project(b.minX, b.minZ, 0),
      project(b.maxX, b.minZ, 0),
      project(b.maxX, b.maxZ, 0),
      project(b.minX, b.maxZ, 0),
    ];
    ctx.strokeStyle = 'rgba(239,68,68,0.95)';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 6]);
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    const [lx, ly] = pts[0]!;
    ctx.fillStyle = '#f87171';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('飛行範圍', lx + 6, ly + 14);
  };

  /** 量比例：已點的第一點畫十字。 */
  const drawCalibMark = (): void => {
    const a = calib?.a;
    if (!a) return;
    const [px, py] = project(a.x, a.z, 0);
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(px - 9, py);
    ctx.lineTo(px + 9, py);
    ctx.moveTo(px, py - 9);
    ctx.lineTo(px, py + 9);
    ctx.stroke();
  };

  /** 俯視比例尺（左下角，跟著縮放）：一眼看出 1m、5m 在圖上多長。 */
  const drawScaleBar = (h: number): void => {
    if (viewMode !== 'top') return;
    const pxPerM = ((project(1, 0)[0] - project(0, 0)[0]) || 1) * mapView.zoom;
    const meters = [1, 2, 5, 10].find((m) => m * pxPerM >= 60) ?? 10;
    const len = meters * pxPerM;
    const x0 = 14;
    const y0 = h - 16;
    ctx.fillStyle = 'rgba(15,23,42,0.85)';
    ctx.fillRect(x0 - 6, y0 - 20, len + 48, 30);
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, y0 - 5);
    ctx.lineTo(x0, y0);
    ctx.lineTo(x0 + len, y0);
    ctx.lineTo(x0 + len, y0 - 5);
    ctx.stroke();
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(`${meters} m`, x0 + len + 6, y0 + 1);
  };

  const drawIsoFloor = (): void => {
    const { ox, oy, size } = fieldFrame(canvas.width, canvas.height);
    const gridStep = snapStep >= 1 ? 5 : 2.5;
    const { cx, cy } = isoLayout(size, size);
    const ground = (x: number, z: number): [number, number] => {
      const [px, py] = isoGroundToCanvas(x, z, size, size);
      return [px + ox, py + oy];
    };

    // 場地菱形外框
    const corners: [number, number][] = [
      [-HALF, -HALF],
      [HALF, -HALF],
      [HALF, HALF],
      [-HALF, HALF],
    ];
    const traceDiamond = (): void => {
      ctx.beginPath();
      corners.forEach(([x, z], i) => {
        const [px, py] = ground(x, z);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
    };
    traceDiamond();
    ctx.fillStyle = 'rgba(30,45,65,0.55)';
    ctx.fill();
    if (floorImg && floorImg.naturalWidth > 0) {
      // 照片沿 2.5D 的 X/Z 斜軸貼上，保持原比例（長方形場地不壓成正方形）。
      ctx.save();
      traceDiamond();
      ctx.clip();
      const imgW = floorImg.naturalWidth;
      const imgH = floorImg.naturalHeight;
      const { width, depth } = floorRect(imgW, imgH, floorSizeM(level.floorSize));
      const [x0, y0] = ground(-width / 2, -depth / 2);
      const [xu, yu] = ground(width / 2, -depth / 2);
      const [xv, yv] = ground(-width / 2, depth / 2);
      const local = new DOMMatrix([(xu - x0) / imgW, (yu - y0) / imgW, (xv - x0) / imgH, (yv - y0) / imgH, x0, y0]);
      ctx.setTransform(ctx.getTransform().multiply(local));
      ctx.drawImage(floorImg, 0, 0);
      ctx.restore();
    }
    traceDiamond();
    ctx.strokeStyle = 'rgba(96,165,250,0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 等距格線（沿 X 與 Z 軸）
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    for (let m = -HALF; m <= HALF; m += gridStep) {
      const [x1, y1] = ground(m, -HALF);
      const [x2, y2] = ground(m, HALF);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      const [x3, y3] = ground(-HALF, m);
      const [x4, y4] = ground(HALF, m);
      ctx.beginPath();
      ctx.moveTo(x3, y3);
      ctx.lineTo(x4, y4);
      ctx.stroke();
    }

    // 軸向標示（業界常見：+X 右、-Z 前）
    const drawAxis = (x: number, z: number, label: string, color: string): void => {
      const [ax, ay] = ground(0, 0);
      const [bx, by] = ground(x, z);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText(label, bx + 4, by + 4);
    };
    drawAxis(6, 0, '+X', '#38bdf8');
    drawAxis(0, -6, '-Z 前', '#fbbf24');

    ctx.fillStyle = 'rgba(148,163,184,0.7)';
    ctx.font = '9px monospace';
    ctx.fillText('原點', cx + ox - 8, cy + oy + 14);
  };

  const updateEmptyBanner = (): void => {
    emptyBanner.hidden = !isLevelLayoutEmpty(level);
  };

  const drawSideView = (w: number, h: number): void => {
    ctx.fillStyle = '#141c28';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(251,191,36,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, sideCanvasY(0, h));
    ctx.lineTo(w, sideCanvasY(0, h));
    ctx.stroke();
    for (let y = 0; y <= EDITOR_MAX_Y; y += 2) {
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath();
      ctx.moveTo(0, sideCanvasY(y, h));
      ctx.lineTo(w, sideCanvasY(y, h));
      ctx.stroke();
      ctx.fillStyle = 'rgba(148,163,184,0.45)';
      ctx.font = '8px monospace';
      ctx.fillText(`${y}m`, 2, sideCanvasY(y, h) - 2);
    }
    const markSide = (
      x: number,
      y: number,
      label: string,
      on: boolean,
      kind: ObjKind,
      ringDiam?: number,
    ): void => {
      const [ex, ey] = sideWorldToCanvas(x, y, w, h);
      ctx.fillStyle = heightHueColor(y);
      ctx.beginPath();
      ctx.arc(ex, ey, on ? 8 : 5, 0, Math.PI * 2);
      ctx.fill();
      if (kind === 'ring' && ringDiam != null) {
        ctx.strokeStyle = on ? '#60a5fa' : heightHueColor(y, 0.9);
        ctx.lineWidth = on ? 2.5 : 1.5;
        ctx.beginPath();
        ctx.arc(ex, ey, ringPxRadius(ringDiam) * 0.35, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (on) {
        ctx.strokeStyle = '#60a5fa';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#e2e8f0';
        ctx.font = '9px sans-serif';
        ctx.fillText(`${label} · Y=${y}`, Math.min(ex + 8, w - 90), ey - 6);
      }
    };
    (level.rings ?? []).forEach((r, i) =>
      markSide(r.x, r.y, r.label ?? `圈${i + 1}`, isSelected('ring', i), 'ring', ringDiameter(r)),
    );
    (level.obstacles ?? []).forEach((o, i) =>
      markSide(o.x, o.y, `障${i + 1}`, isSelected('obstacle', i), 'obstacle'),
    );
    (level.balloons ?? []).forEach((b, i) =>
      markSide(b.x, b.y, `球${i + 1}`, isSelected('balloon', i), 'balloon'),
    );
    const [hx, hy] = sideWorldToCanvas(0, 0, w, h);
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(hx, hy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px sans-serif';
    ctx.fillText('起飛墊', hx + 8, hy + 3);
  };

  const drawPlanView = (): void => {
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = viewMode === 'iso' ? '#152030' : '#1a2332';
    ctx.fillRect(0, 0, w, h);
    const frame = fieldFrame(w, h);
    if (viewMode === 'top' && floorImg && floorImg.naturalWidth > 0) {
      const { width, depth } = floorRect(floorImg.naturalWidth, floorImg.naturalHeight, floorSizeM(level.floorSize));
      const [x1, z1] = project(-width / 2, -depth / 2);
      const [x2, z2] = project(width / 2, depth / 2);
      ctx.drawImage(floorImg, x1, z1, x2 - x1, z2 - z1);
    }

    if (viewMode === 'top') {
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      const step = snapStep >= 1 ? 5 : 2.5;
      const meterX = (px: number) => ((px - frame.ox) / frame.size) * WORLD - HALF;
      const meterZ = (py: number) => ((py - frame.oy) / frame.size) * WORLD - HALF;
      const from = (v: number) => Math.floor(v / step) * step;
      for (let m = from(meterX(0)); m <= meterX(w) + step; m += step) {
        const [gx] = project(m, 0);
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, h);
        ctx.stroke();
      }
      for (let m = from(meterZ(0)); m <= meterZ(h) + step; m += step) {
        const [, gz] = project(0, m);
        ctx.beginPath();
        ctx.moveTo(0, gz);
        ctx.lineTo(w, gz);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(148,163,184,0.55)';
      ctx.font = '9px monospace';
      for (let m = -10; m <= 10; m += 5) {
        if (m === 0) continue;
        const [gx] = project(m, 0);
        const [, gz] = project(0, m);
        ctx.fillText(String(m), gx + 2, h - 4);
        ctx.fillText(String(m), 4, gz - 2);
      }
    } else if (viewMode === 'iso') {
      drawIsoFloor();
    }

    type IsoDrawItem = { depth: number; draw: () => void };
    const isoQueue: IsoDrawItem[] = [];

    const queueIso = (x: number, z: number, y: number, drawFn: () => void): void => {
      isoQueue.push({ depth: isoDepthKey(x, z, y), draw: drawFn });
    };

    if (viewMode === 'iso') {
      (level.obstacles ?? []).forEach((obs) => drawIsoStem(obs.x, obs.z, obs.y));
      (level.balloons ?? []).forEach((b) => drawIsoStem(b.x, b.z, b.y));
      (level.rings ?? []).forEach((ring) => drawIsoStem(ring.x, ring.z, ring.y));
    }
    drawFlightBounds();
    drawRingRoute();
    // 2.5D 的圈畫在空中、會偏離底圖上的位置；編號牌釘在圈正下方的地面，順序對得上場地標線
    if (viewMode === 'iso') {
      (level.rings ?? []).forEach((ring, i) => {
        const [gx, gy] = project(ring.x, ring.z, 0);
        drawRingBadge(gx, gy, i);
      });
    }

    const [hx, hz] = project(0, 0, 0);
    const drawHomePad = (): void => {
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(hx, hz, viewMode === 'iso' ? 6 : 8, 0, Math.PI * 2);
      ctx.fill();
      if (viewMode === 'top') {
        ctx.fillStyle = '#94a3b8';
        ctx.font = '11px sans-serif';
        ctx.fillText('起飛墊 0,0', hx + 10, hz + 4);
      }
    };
    if (viewMode === 'iso') queueIso(0, 0, 0, drawHomePad);
    else drawHomePad();

    const guide = level.guide;
    if (guide?.length && viewMode === 'top') {
      ctx.strokeStyle = 'rgba(96,165,250,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      guide.forEach(([gx, gz], i) => {
        const [cx, cz] = project(gx, gz);
        if (i === 0) ctx.moveTo(cx, cz);
        else ctx.lineTo(cx, cz);
      });
      ctx.stroke();
    }

    (level.obstacles ?? []).forEach((obs, i) => {
      const drawObs = (): void => {
        const [ox, oz] = project(obs.x, obs.z, obs.y);
        const r = ((obs.size ?? 1) / WORLD) * frame.size * 0.5;
        const sel = isSelected('obstacle', i);
        const fill = parseLevelColor(obs.color, obstacleDefaultColor(!!obs.solid));
        ctx.globalAlpha = obs.solid ? 0.85 : 0.6;
        ctx.fillStyle = fill;
        if (viewMode === 'iso') {
          ctx.beginPath();
          ctx.ellipse(ox, oz, r, r * 0.55, 0, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(ox - r, oz - r, r * 2, r * 2);
        }
        ctx.fillStyle = '#cbd5e1';
        ctx.font = '8px monospace';
        ctx.fillText(`${obs.y}m`, ox - 10, oz - r - 3);
        if (sel) {
          ctx.strokeStyle = '#60a5fa';
          ctx.lineWidth = 2;
          if (viewMode === 'iso') ctx.stroke();
          else ctx.strokeRect(ox - r - 2, oz - r - 2, r * 2 + 4, r * 2 + 4);
        }
        ctx.globalAlpha = 1;
      };
      if (viewMode === 'iso') queueIso(obs.x, obs.z, obs.y, drawObs);
      else drawObs();
    });

    (level.balloons ?? []).forEach((b, i) => {
      const drawBalloon = (): void => {
        const [bx, bz] = project(b.x, b.z, b.y);
        const bFill = parseLevelColor(b.color, DEFAULT_BALLOON_COLORS[i % DEFAULT_BALLOON_COLORS.length]!);
        const bR = Math.max(8, ringPxRadius(balloonDiameter(b)) * 0.45);
        ctx.fillStyle = bFill;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(bx, bz, viewMode === 'iso' ? bR * 0.85 : bR, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#cbd5e1';
        ctx.font = '8px monospace';
        ctx.fillText(`${b.y}m`, bx - 10, bz - 12);
        if (isSelected('balloon', i)) {
          ctx.strokeStyle = '#60a5fa';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      };
      if (viewMode === 'iso') queueIso(b.x, b.z, b.y, drawBalloon);
      else drawBalloon();
    });

    if (viewMode === 'top') {
      (level.passZones ?? []).forEach((zone, i) => {
        const isPos = zone.type === 'position' || zone.type === undefined;
        if (isPos && ZoneEdit.hasBox(zone)) {
          const { minX, maxX, minZ, maxZ } = ZoneEdit.drawBox(zone);
          const [x1, z1] = project(minX, minZ);
          const [x2, z2] = project(maxX, maxZ);
          ctx.fillStyle = isSelected('zone', i) ? 'rgba(96,165,250,0.15)' : 'rgba(167,139,250,0.12)';
          ctx.fillRect(x1, z1, x2 - x1, z2 - z1);
          ctx.strokeStyle = isSelected('zone', i) ? '#60a5fa' : 'rgba(167,139,250,0.65)';
          ctx.lineWidth = isSelected('zone', i) ? 2.5 : 1.5;
          ctx.setLineDash([4, 4]);
          ctx.strokeRect(x1, z1, x2 - x1, z2 - z1);
          ctx.setLineDash([]);
        }
        const [zx, zz] = project(zone.x, zone.z);
        ctx.strokeStyle = isSelected('zone', i) ? '#60a5fa' : 'rgba(167,139,250,0.85)';
        ctx.lineWidth = isSelected('zone', i) ? 2.5 : 2;
        if (!isPos || !ZoneEdit.hasBox(zone)) {
          ctx.setLineDash([4, 4]);
          ctx.strokeRect(zx - 12, zz - 12, 24, 24);
          ctx.setLineDash([]);
        }
        ctx.fillStyle = '#c4b5fd';
        ctx.font = '9px sans-serif';
        ctx.fillText(zone.label?.slice(0, 4) ?? String(i + 1), zx - 3, zz + 3);
      });
    }

    (level.rings ?? []).forEach((ring, i) => {
      const drawRing = (): void => {
        const [rx, rz] = project(ring.x, ring.z, ring.y);
        const sel = isSelected('ring', i);
        const rPx = ringPxRadius(ringDiameter(ring));
        ctx.strokeStyle = sel ? '#60a5fa' : ring.faceYaw != null ? '#f87171' : parseLevelColor(ring.color, DEFAULT_RING_COLOR);
        ctx.lineWidth = sel ? 3 : 2;
        ctx.beginPath();
        ctx.arc(rx, rz, rPx, 0, Math.PI * 2);
        ctx.stroke();
        // 擺放角度：粗線是圈面，短線指向穿越方向（機頭朝這邊時正好穿過）
        const yawDeg = ringYawDeg(ring);
        const plane = RingGuide.planeDir(yawDeg);
        const half = ringDiameter(ring) / 2;
        const [ax, az] = project(ring.x - plane.x * half, ring.z - plane.z * half, ring.y);
        const [bx, bz] = project(ring.x + plane.x * half, ring.z + plane.z * half, ring.y);
        const yawRad = (yawDeg * Math.PI) / 180;
        const [tx, tz] = project(ring.x - Math.sin(yawRad) * 0.9, ring.z - Math.cos(yawRad) * 0.9, ring.y);
        ctx.lineWidth = sel ? 4 : 3;
        ctx.beginPath();
        ctx.moveTo(ax, az);
        ctx.lineTo(bx, bz);
        ctx.stroke();
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(rx, rz);
        ctx.lineTo(tx, tz);
        ctx.stroke();
        if (viewMode !== 'iso') drawRingBadge(rx, rz, i);
        ctx.font = '8px monospace';
        ctx.fillStyle = '#cbd5e1';
        ctx.fillText(`${ring.y}m`, rx - 10, rz - rPx - 4);
      };
      if (viewMode === 'iso') queueIso(ring.x, ring.z, ring.y, drawRing);
      else drawRing();
    });

    if (viewMode === 'iso') {
      isoQueue.sort((a, b) => a.depth - b.depth);
      isoQueue.forEach((item) => item.draw());
    }
    drawCalibMark();
  };

  const draw = (): void => {
    const w = canvas.width;
    const h = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = viewMode === 'side' ? '#141c28' : viewMode === 'iso' ? '#152030' : '#1a2332';
    ctx.fillRect(0, 0, w, h);
    ctx.setTransform(mapView.zoom, 0, 0, mapView.zoom, mapView.panX, mapView.panY);
    if (viewMode === 'side') drawSideView(w, h);
    else drawPlanView();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawScaleBar(h);
    syncZoomReadout();
    updateEmptyBanner();
    syncBoundsChrome();
  };

  const syncFormFromLevel = (): void => {
    q<HTMLInputElement>('#le-name').value = level.name;
    q<HTMLInputElement>('#le-hud').value = level.hud ?? '';
    q<HTMLTextAreaElement>('#le-intro').value = level.intro ?? '';
    q<HTMLInputElement>('#le-return').checked = !!level.returnHome;
    q<HTMLInputElement>('#le-ring-order').checked = level.ringOrder === 'sequential';
    q<HTMLInputElement>('#le-freeplay').checked = !!level.freeplay;
    q<HTMLInputElement>('#le-draw').checked = !!level.draw;
  };

  const syncLevelFromForm = (): void => {
    level.name = q<HTMLInputElement>('#le-name').value.trim() || level.name;
    level.hud = q<HTMLInputElement>('#le-hud').value.trim();
    level.intro = q<HTMLTextAreaElement>('#le-intro').value;
    level.returnHome = q<HTMLInputElement>('#le-return').checked;
    // 沒勾就不寫欄位：舊關卡沒有 ringOrder，任意順序都算
    if (q<HTMLInputElement>('#le-ring-order').checked) level.ringOrder = 'sequential';
    else delete level.ringOrder;
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
    saveDraftBackup(levelPkLocal, level, serverUpdatedAt);
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void flushSave(), 700);
  };

  const syncActionButtons = (): void => {
    const teamId = editorCtx?.getTeamId() ?? null;
    const publishBtn = q<HTMLButtonElement>('#le-publish');
    const broadcastBtn = q<HTMLButtonElement>('#le-broadcast');
    publishBtn.hidden = !teamId || levelStatus !== 'draft';
    broadcastBtn.hidden = !teamId || levelStatus !== 'published';
  };

  const applyLoadedLevel = (detail: {
    id: number;
    levelId: string;
    title: string;
    status: TeacherLevelBrief['status'];
    updatedAt: number;
    definition: Record<string, unknown>;
  }): void => {
    levelPkLocal = detail.id;
    levelIdStr = detail.levelId;
    levelStatus = detail.status;
    serverUpdatedAt = detail.updatedAt;
    level = parseLevel(detail.definition, detail.levelId, detail.title);
    q<HTMLElement>('#le-title').textContent = `編輯 ${detail.levelId}`;
    q<HTMLElement>('#le-sub').textContent =
      detail.status === 'draft' ? '草稿會自動儲存' : '已發布 — 修改後學生端即時生效';
    snapStep = getSnapStep();
    syncFormFromLevel();
    syncPlaceHeightReadout();
    syncViewHint();
    syncActionButtons();
    loadFloorPreview();
    loadMyKits();
    backdrop.focus();

    const backup = loadDraftBackup(levelPkLocal);
    const banner = q<HTMLElement>('#le-backup-banner');
    if (backup && backupIsNewerThanServer(backup, serverUpdatedAt)) {
      const when = new Date(backup.savedAt).toLocaleString('zh-TW', { hour12: false });
      q<HTMLElement>('#le-backup-msg').textContent = `本機有較新的草稿備份（${when}）`;
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }
  };

  const flushSave = async (): Promise<void> => {
    syncLevelFromForm();
    try {
      const updated = await patchTeacherLevel(levelPkLocal, {
        title: level.name,
        definition: level as unknown as Record<string, unknown>,
      });
      dirty = false;
      serverUpdatedAt = updated.updatedAt;
      clearDraftBackup(levelPkLocal);
      saveHint.textContent = '已儲存';
      onSaved?.();
    } catch (e) {
      saveDraftBackup(levelPkLocal, level, serverUpdatedAt);
      saveHint.textContent = '儲存失敗';
      toast(errText(e, '儲存'), 'error');
    }
  };

  const propsCtrl = createPropsController({
    root: backdrop,
    getLevel: () => level,
    setLevel: (next) => {
      level = next;
    },
    getSelection: () => selection,
    setSelection: (sel) => {
      selection = sel;
    },
    getSnapStep,
    syncPyControls,
    redraw: () => draw(),
    scheduleSave,
    isSyncing: () => syncingProps,
    setSyncing: (v) => {
      syncingProps = v;
    },
  });
  propsCtrl.bind();

  const fitCanvas = (): void => {
    const box = q<HTMLElement>('#le-canvas-box');
    if (box.clientWidth < 64 || box.clientHeight < 64) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pxW = Math.min(2400, Math.floor(box.clientWidth * dpr));
    const pxH = Math.min(2400, Math.floor(box.clientHeight * dpr));
    if (canvas.width !== pxW || canvas.height !== pxH) {
      mapView = refitMapZoom(mapView, canvas.width, canvas.height, pxW, pxH);
      canvas.width = pxW;
      canvas.height = pxH;
    }
    draw();
  };

  const setSelection = (sel: Selection | null): void => {
    selection = sel;
    propsCtrl.sync();
    draw();
  };

  const deleteSelection = (): void => {
    if (!selection) return;
    const { kind, index } = selection;
    if (kind === 'ring') level.rings = ItemOrder.renumberRings((level.rings ?? []).filter((_, i) => i !== index));
    else if (kind === 'obstacle') level.obstacles = (level.obstacles ?? []).filter((_, i) => i !== index);
    else if (kind === 'balloon') level.balloons = (level.balloons ?? []).filter((_, i) => i !== index);
    else level.passZones = ItemOrder.renumberZones((level.passZones ?? []).filter((_, i) => i !== index));
    setSelection(null);
    scheduleSave();
  };

  /** 圈或任務步驟往前／往後一號。判定與學生端編號都照陣列順序。 */
  const moveSelection = (delta: -1 | 1): void => {
    if (!selection) return;
    const { kind, index } = selection;
    if (kind === 'ring') {
      const moved = ItemOrder.move(level.rings ?? [], index, delta);
      if (!moved) return;
      level.rings = ItemOrder.renumberRings(moved.list);
      setSelection({ kind, index: moved.index });
    } else if (kind === 'zone') {
      const moved = ItemOrder.move(level.passZones ?? [], index, delta);
      if (!moved) return;
      level.passZones = ItemOrder.renumberZones(moved.list);
      setSelection({ kind, index: moved.index });
    } else {
      return;
    }
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
    propsCtrl.sync();
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
      zones[selection.index] = ZoneEdit.translate(z, p.x, p.z);
      level.passZones = zones;
    }
    propsCtrl.sync();
    draw();
    scheduleSave();
  };

  const hitAtSide = (px: number, py: number): Selection | null => {
    const w = canvas.width;
    const h = canvas.height;
    const tryY = (
      kind: ObjKind,
      items: { x: number; y: number; diameter?: number }[],
    ): Selection | null => {
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (!it) continue;
        const [ex, ey] = sideWorldToCanvas(it.x, it.y, w, h);
        const hitR = kind === 'ring' ? ringPxRadius(ringDiameter(it)) * 0.4 + 6 : 10;
        if (Math.hypot(px - ex, py - ey) <= hitR) return { kind, index: i };
      }
      return null;
    };
    return (
      tryY('ring', level.rings ?? []) ??
      tryY('obstacle', level.obstacles ?? []) ??
      tryY('balloon', level.balloons ?? [])
    );
  };

  const hitAt = (px: number, py: number): Selection | null => {
    if (viewMode === 'side') return hitAtSide(px, py);
    const tryList = (
      kind: ObjKind,
      items: { x: number; z: number; y?: number; size?: number; diameter?: number }[],
    ): Selection | null => {
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (!it) continue;
        const [cx, cz] = project(it.x, it.z, it.y ?? 0);
        const hitR =
          kind === 'ring'
            ? ringPxRadius(ringDiameter(it))
            : kind === 'obstacle'
              ? ((it.size ?? 1) / WORLD) * fieldFrame(canvas.width, canvas.height).size * 0.5 + 4
              : kind === 'balloon'
                ? Math.max(10, ringPxRadius(balloonDiameter(it)) * 0.45)
                : 14;
        if (Math.hypot(px - cx, py - cz) <= hitR) return { kind, index: i };
      }
      return null;
    };
    return (
      tryList('ring', level.rings ?? []) ??
      tryList('obstacle', level.obstacles ?? []) ??
      tryList('balloon', level.balloons ?? []) ??
      (viewMode === 'top' ? tryList('zone', level.passZones ?? []) : null)
    );
  };

  const placeAt = (wx: number, wz: number): void => {
    if (placeMode === 'ring') {
      level.rings = [
        ...(level.rings ?? []),
        {
          x: wx,
          y: placeHeightY,
          z: wz,
          label: String((level.rings?.length ?? 0) + 1),
          color: DEFAULT_RING_COLOR,
        },
      ];
      setSelection({ kind: 'ring', index: level.rings.length - 1 });
    } else if (placeMode === 'obstacle-solid') {
      level.obstacles = [
        ...(level.obstacles ?? []),
        {
          type: 'cube',
          solid: true,
          x: wx,
          y: 1.5,
          z: wz,
          size: 1,
          color: DEFAULT_OBSTACLE_SOLID_COLOR,
          physics: { collidable: true, friction: 0.65, restitution: 0.08 },
        },
      ];
      setSelection({ kind: 'obstacle', index: level.obstacles.length - 1 });
    } else if (placeMode === 'obstacle-soft') {
      level.obstacles = [
        ...(level.obstacles ?? []),
        {
          type: 'soft-cube',
          solid: false,
          x: wx,
          y: 1.5,
          z: wz,
          size: 1,
          color: DEFAULT_OBSTACLE_SOFT_COLOR,
          physics: { collidable: false },
        },
      ];
      setSelection({ kind: 'obstacle', index: level.obstacles.length - 1 });
    } else if (placeMode === 'balloon') {
      const bi = level.balloons?.length ?? 0;
      level.balloons = [
        ...(level.balloons ?? []),
        {
          x: wx,
          y: placeHeightY,
          z: wz,
          color: DEFAULT_BALLOON_COLORS[bi % DEFAULT_BALLOON_COLORS.length],
          label: `球${bi + 1}`,
        },
      ];
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

  const pointerOnCanvas = (e: MouseEvent): [number, number] => {
    const rect = canvas.getBoundingClientRect();
    return [
      ((e.clientX - rect.left) / rect.width) * canvas.width,
      ((e.clientY - rect.top) / rect.height) * canvas.height,
    ];
  };

  const canvasPos = (e: MouseEvent): [number, number] => {
    const [sx, sy] = pointerOnCanvas(e);
    return mapPointerToContent(sx, sy, mapView);
  };

  canvas.addEventListener('mousemove', (e) => {
    const [px, py] = canvasPos(e);
    const planeY =
      dragSel && dragSel.kind !== 'zone' ? objectPlaneY(dragSel) : placeHeightY;
    const { x, z } = unproject(px, py, planeY);
    syncInspectorIdle(x, z);
    if (!dragSel) return;
    const drag = dragSel;
    const rings = level.rings ?? [];
    const obs = level.obstacles ?? [];
    const balloons = level.balloons ?? [];
    const zones = level.passZones ?? [];
    if (viewMode === 'side' && drag.kind !== 'zone') {
      const ny = sideYFromCanvas(py, canvas.height);
      if (drag.kind === 'ring' && rings[drag.index]) {
        level.rings = rings.map((item, i) => (i === drag.index ? { ...item, y: ny } : item));
      } else if (drag.kind === 'obstacle' && obs[drag.index]) {
        level.obstacles = obs.map((item, i) => (i === drag.index ? { ...item, y: ny } : item));
      } else if (drag.kind === 'balloon' && balloons[drag.index]) {
        level.balloons = balloons.map((item, i) => (i === drag.index ? { ...item, y: ny } : item));
      }
    } else if (drag.kind === 'ring' && rings[drag.index]) {
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
      level.passZones = zones.map((item, i) => (i === drag.index ? ZoneEdit.translate(item, p.x, p.z) : item));
    }
    propsCtrl.sync();
    draw();
  });

  canvas.addEventListener('mousedown', (e) => {
    const [px, py] = canvasPos(e);
    if (calib) {
      calibClick(px, py);
      return;
    }
    const hit = hitAt(px, py);
    if (hit) {
      setSelection(hit);
      dragSel = hit;
      return;
    }
    if (viewMode === 'side') {
      if (placeMode !== 'select') toast('請切換俯視或 2.5D 放置物件', 'info');
      setSelection(null);
      return;
    }
    const { x, z } = unproject(px, py);
    if (placeMode !== 'select') {
      placeAt(x, z);
      draw();
      return;
    }
    setSelection(null);
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const [sx, sy] = pointerOnCanvas(e);
      mapView = zoomMapAtPointer(mapView, sx, sy, e.deltaY < 0);
      draw();
    },
    { passive: false },
  );

  q<HTMLInputElement>('#le-place-y').addEventListener('input', () => {
    const next = Number(q<HTMLInputElement>('#le-place-y').value);
    if (!Number.isFinite(next)) return;
    placeHeightY = Math.max(0.5, Math.min(EDITOR_MAX_Y, next));
    syncPlaceHeightReadout();
  });

  q<HTMLElement>('#le-view-tabs').querySelectorAll<HTMLButtonElement>('.le-view').forEach((btn) => {
    btn.addEventListener('click', () => {
      viewMode = (btn.dataset['view'] as EditorViewMode) || 'top';
      q<HTMLElement>('#le-view-tabs').querySelectorAll('.le-view').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      dragSel = null;
      syncViewHint();
      draw();
    });
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

  q<HTMLButtonElement>('#le-del-sel').addEventListener('click', deleteSelection);
  q<HTMLButtonElement>('#le-order-up').addEventListener('click', () => moveSelection(-1));
  q<HTMLButtonElement>('#le-order-down').addEventListener('click', () => moveSelection(1));

  backdrop.addEventListener('keydown', (e) => {
    if (!(e.target instanceof HTMLElement)) return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const step = snapStep || 0.5;
    if (e.key === 'Escape' && calib) {
      e.preventDefault();
      endCalib();
      return;
    }
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
  // 這兩個會改地圖上的順序路線（金色虛線、返航段），要馬上重畫，不等存檔
  const syncRouteOption = (): void => {
    syncLevelFromForm();
    draw();
    scheduleSave();
  };
  q<HTMLInputElement>('#le-return').addEventListener('change', syncRouteOption);
  q<HTMLInputElement>('#le-ring-order').addEventListener('change', syncRouteOption);
  q<HTMLInputElement>('#le-freeplay').addEventListener('change', scheduleSave);
  q<HTMLInputElement>('#le-draw').addEventListener('change', scheduleSave);

  const applySnippet = (snippet: LevelKitSnippet): void => {
    level = applyLevelKitSnippet(level, snippet, levelKitApplyMode(snippet));
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
      myKitsHost.innerHTML = '<p class="note">尚無自訂範本，完成佈局後點「儲存為範本」。</p>';
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
              <button type="button" class="lvl-kit-del" data-del-kit="${k.id}" title="刪除範本">${ICONS.x}</button>
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
          if (!confirm('確定刪除此範本？')) return;
          void deleteTeacherLevelKit(id)
            .then(() => {
              myKits = myKits.filter((k) => k.id !== id);
              renderMyKits();
              toast('已刪除範本', 'success');
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
        myKitsHost.innerHTML = '<p class="note">無法載入我的範本</p>';
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
        <div class="modal-head"><h2 class="modal-title">儲存為範本</h2></div>
        <div class="field"><label class="field-label">範本名稱</label><input id="sk-name" type="text" maxlength="120" value="${esc(level.name)}"></div>
        <div class="field"><label class="field-label">說明</label><input id="sk-desc" type="text" maxlength="400" placeholder="選填"></div>
        <div class="field"><label class="field-label">分類</label>
          <select id="sk-cat">${LEVEL_KIT_CATEGORIES.map((c) => `<option value="${c.id}" ${c.id === category ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select>
        </div>
        <label class="check-row"><input type="checkbox" id="sk-tasks" ${includeTasks ? 'checked' : ''}>包含任務步驟</label>
        <label class="check-row"><input type="checkbox" id="sk-draw" ${includeDraw ? 'checked' : ''}>包含畫畫設定</label>
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
        toast(valErrs[0] ?? '範本內容無效', 'error');
        return;
      }
      const name = (dlg.querySelector<HTMLInputElement>('#sk-name'))!.value.trim();
      if (!name) {
        toast('請輸入範本名稱', 'error');
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

  q<HTMLButtonElement>('#le-export').addEventListener('click', () => {
    syncLevelFromForm();
    downloadLevelJson(level, `${levelIdStr || level.id || 'level'}.json`);
    toast('已匯出 JSON', 'success');
  });

  q<HTMLButtonElement>('#le-import').addEventListener('click', () => {
    void pickAndParseLevelJson(levelIdStr || level.id, level.name).then((imported) => {
      if (!imported) return;
      if (!isLevelLayoutEmpty(level) && !confirm('匯入會覆寫目前圈點與障礙，確定繼續？')) return;
      level = imported;
      setSelection(null);
      syncFormFromLevel();
      draw();
      scheduleSave();
      toast('已匯入 JSON', 'success');
    });
  });

  q<HTMLButtonElement>('#le-publish').addEventListener('click', () => {
    const teamId = editorCtx?.getTeamId();
    if (!teamId) {
      toast('請先開啟班級房間', 'error');
      return;
    }
    void flushSave()
      .then(() => publishAndAddToCatalog(teamId, levelPkLocal))
      .then((published) => {
        levelStatus = published.status;
        levelIdStr = published.levelId;
        serverUpdatedAt = published.updatedAt;
        clearDraftBackup(levelPkLocal);
        q<HTMLElement>('#le-sub').textContent = '已發布 — 修改後學生端即時生效';
        syncActionButtons();
        editorCtx?.onCatalogUpdated();
        onSaved?.();
        toast(`已發布並加入本班：${published.levelId}`, 'success');
      })
      .catch((e) => toast(errText(e, '發布'), 'error'));
  });

  q<HTMLButtonElement>('#le-broadcast').addEventListener('click', () => {
    const teamId = editorCtx?.getTeamId();
    if (!teamId || !levelIdStr) {
      toast('請先開啟班級房間', 'error');
      return;
    }
    void flushSave()
      .then(() => ensureCatalogForBroadcast(teamId, levelIdStr))
      .then(() => {
        editorCtx?.onCatalogUpdated();
        const ok = editorCtx?.broadcastLoadLevel(levelIdStr);
        if (!ok) toast('尚未連線到伺服器', 'error');
      })
      .catch((e) => toast(errText(e, '廣播'), 'error'));
  });

  q<HTMLButtonElement>('#le-restore-backup').addEventListener('click', () => {
    const backup = loadDraftBackup(levelPkLocal);
    if (!backup) return;
    level = backup.level;
    setSelection(null);
    syncFormFromLevel();
    draw();
    scheduleSave();
    q<HTMLElement>('#le-backup-banner').hidden = true;
    toast('已恢復本機草稿', 'success');
  });

  q<HTMLButtonElement>('#le-discard-backup').addEventListener('click', () => {
    clearDraftBackup(levelPkLocal);
    q<HTMLElement>('#le-backup-banner').hidden = true;
  });

  q<HTMLButtonElement>('#le-save-now').addEventListener('click', () => {
    void flushSave().then(() => {
      if (!dirty) toast('已儲存', 'success');
    });
  });

  const floorSrc = (path: string): string =>
    path.startsWith('/') ? `${API_BASE}${path}` : path;

  const syncFloorChrome = (): void => {
    const thumb = q<HTMLImageElement>('#le-floor-thumb');
    const clearBtn = q<HTMLButtonElement>('#le-floor-clear');
    const pickBtn = q<HTMLButtonElement>('#le-floor-pick');
    const url = level.floorImage;
    q<HTMLElement>('#le-floor-size-row').hidden = !url;
    q<HTMLButtonElement>('#le-floor-calib').hidden = !url;
    q<HTMLInputElement>('#le-floor-size').value = level.floorSize != null ? String(floorSizeM(level.floorSize)) : '';
    const photo = url ? photoRect() : null;
    const dims = q<HTMLElement>('#le-floor-dims');
    dims.hidden = !photo;
    if (photo) {
      dims.textContent = `照片範圍：寬 ${photo.width.toFixed(1)} m × 深 ${photo.depth.toFixed(1)} m（試飛時無人機約 1.2 m 寬、圈直徑預設 3 m）。比例不準可用「用兩點量比例」校正。`;
    }
    if (url) {
      thumb.hidden = false;
      thumb.src = floorSrc(url);
      clearBtn.hidden = false;
      pickBtn.textContent = '更換場地底圖';
    } else {
      thumb.hidden = true;
      thumb.removeAttribute('src');
      clearBtn.hidden = true;
      pickBtn.textContent = '上傳場地底圖';
    }
  };

  const loadFloorPreview = (): void => {
    syncFloorChrome();
    const url = level.floorImage;
    if (!url) {
      floorImg = null;
      draw();
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (level.floorImage !== url) return;
      floorImg = img;
      syncFloorChrome();
      draw();
    };
    img.onerror = () => {
      if (level.floorImage !== url) return;
      floorImg = null;
      draw();
    };
    img.src = floorSrc(url);
  };

  const close = (): void => {
    if (dirty) void flushSave();
    resizeObserver?.disconnect();
    document.body.style.overflow = prevBodyOverflow;
    backdrop.remove();
  };
  q<HTMLButtonElement>('#le-close').addEventListener('click', close);
  q<HTMLButtonElement>('#le-floor-pick').addEventListener('click', () => {
    q<HTMLInputElement>('#le-floor-file').click();
  });
  q<HTMLInputElement>('#le-floor-file').addEventListener('change', () => {
    const input = q<HTMLInputElement>('#le-floor-file');
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast('場地底圖需小於 2 MB', 'error');
      return;
    }
    void flushSave()
      .then(() => uploadLevelFloor(levelPkLocal, file))
      .then((res) => {
        level.floorImage = res.floorImage;
        loadFloorPreview();
        scheduleSave();
        toast('場地底圖已上傳', 'success');
      })
      .catch((e) => toast(errText(e, '上傳場地底圖'), 'error'));
  });
  /**
   * 換照片比例。raw 沒給＝回預設 30m。場上有物件時問老師要不要跟著照片縮放：
   * 物件原本對準照片上的標線，跟著縮放才不會錯位。
   */
  const applyFloorSize = (raw: number | undefined): void => {
    const before = floorSizeM(level.floorSize);
    const after = raw === undefined ? WORLD : floorSizeM(raw);
    if (raw !== undefined && raw < FLOOR_SIZE_MIN) {
      toast(`照片長邊最小 ${FLOOR_SIZE_MIN} 公尺（再小場地會比圈和無人機還小），已設為 ${FLOOR_SIZE_MIN} 公尺`, 'info');
    } else if (raw !== undefined && raw > WORLD) {
      toast(`場地最大 ${WORLD} 公尺，已設為 ${WORLD} 公尺`, 'info');
    }
    if (
      after !== before &&
      FloorScale.hasLayout(level) &&
      confirm('要讓圈、障礙、任務點、飛行範圍跟著照片一起縮放位置嗎？\n（圈的大小與高度不變。按「取消」則物件留在原地。）')
    ) {
      level = FloorScale.layout(level, after / before);
      propsCtrl.sync();
    }
    // 30m＝預設，不寫進關卡
    if (after === WORLD) delete level.floorSize;
    else level.floorSize = after;
    syncFloorChrome();
    draw();
    scheduleSave();
  };

  q<HTMLInputElement>('#le-floor-size').addEventListener('change', () => {
    const raw = q<HTMLInputElement>('#le-floor-size').value.trim();
    const n = Number(raw);
    applyFloorSize(raw === '' || !Number.isFinite(n) ? undefined : n);
  });

  const endCalib = (): void => {
    calib = null;
    q<HTMLButtonElement>('#le-floor-calib').classList.remove('active');
    canvas.style.cursor = '';
    syncViewHint();
    draw();
  };

  /** 量比例：點兩點 → 問實際距離 → 換算照片長邊。不吸附格線，量得比較準。 */
  const calibClick = (px: number, py: number): void => {
    if (!calib) return;
    if (viewMode === 'side') {
      toast('請在俯視或 2.5D 量比例', 'info');
      return;
    }
    const { ox, oy, size } = fieldFrame(canvas.width, canvas.height);
    const p =
      viewMode === 'iso'
        ? isoCanvasToWorld(px - ox, py - oy, size, size, 0, 0)
        : topCanvasToWorld(px - ox, py - oy, size, size, 0);
    if (!calib.a) {
      calib.a = p;
      q<HTMLElement>('#le-view-hint').textContent = '量比例：再點第二個點（Esc 取消）';
      draw();
      return;
    }
    const measured = Math.hypot(p.x - calib.a.x, p.z - calib.a.z);
    endCalib();
    const answer = prompt(`這兩點在目前比例下相距 ${measured.toFixed(1)} 公尺。\n實際相距幾公尺？`);
    if (answer === null) return;
    const next = FloorScale.calibrate(floorSizeM(level.floorSize), measured, Number(answer));
    if (next === null) {
      toast('兩點太近或距離不正確，請重新量', 'info');
      return;
    }
    applyFloorSize(next);
    toast(`已校正：照片長邊 ${floorSizeM(level.floorSize)} 公尺`, 'success');
  };

  q<HTMLButtonElement>('#le-floor-calib').addEventListener('click', () => {
    if (calib) {
      endCalib();
      return;
    }
    if (!photoRect()) {
      toast('場地底圖還在載入，請稍候', 'info');
      return;
    }
    calib = { a: null };
    q<HTMLButtonElement>('#le-floor-calib').classList.add('active');
    canvas.style.cursor = 'crosshair';
    q<HTMLElement>('#le-view-hint').textContent =
      '量比例：在照片上點第一個點（選實際距離已知的兩點，例如圓的直徑、場地邊長；Esc 取消）';
  });

  // 飛行範圍
  q<HTMLInputElement>('#le-bounds').addEventListener('change', () => {
    if (q<HTMLInputElement>('#le-bounds').checked) level.flightBounds = defaultBounds();
    else delete level.flightBounds;
    draw();
    scheduleSave();
  });
  (['#le-b-minx', '#le-b-maxx', '#le-b-minz', '#le-b-maxz'] as const).forEach((id) => {
    q<HTMLInputElement>(id).addEventListener('change', () => {
      const read = (sel: string): number => Number(q<HTMLInputElement>(sel).value);
      const next = FlightArea.of({
        flightBounds: { minX: read('#le-b-minx'), maxX: read('#le-b-maxx'), minZ: read('#le-b-minz'), maxZ: read('#le-b-maxz') },
      });
      if (next) level.flightBounds = next;
      q<HTMLInputElement>(id).blur();
      draw();
      scheduleSave();
    });
  });
  q<HTMLButtonElement>('#le-bounds-fit').addEventListener('click', () => {
    const photo = photoRect();
    if (!photo) return;
    level.flightBounds = FlightArea.of({ flightBounds: defaultBounds() }) ?? undefined;
    draw();
    scheduleSave();
  });
  q<HTMLButtonElement>('#le-floor-clear').addEventListener('click', () => {
    void flushSave()
      .then(() => deleteLevelFloor(levelPkLocal))
      .then(() => {
        delete level.floorImage;
        delete level.floorSize;
        loadFloorPreview();
        scheduleSave();
      })
      .catch((e) => toast(errText(e, '移除場地底圖'), 'error'));
  });
  resizeObserver = new ResizeObserver(() => fitCanvas());
  resizeObserver.observe(q('#le-canvas-box'));
  requestAnimationFrame(() => fitCanvas());

  void fetchTeacherLevel(levelPkLocal)
    .then((detail) => {
      applyLoadedLevel(detail);
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
      resizeObserver?.disconnect();
      document.body.style.overflow = prevBodyOverflow;
      backdrop.remove();
    },
  };
}
