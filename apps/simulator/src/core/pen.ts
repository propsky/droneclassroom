// 畫畫教室：畫筆狀態 + 墨水取樣（框架無關純 TS，不碰 Babylon）。
// 行為對齊 legacy main.js「畫畫教室：持久粗墨水線」區段（L940–1049）：
//   - 每段 stroke 一條線（換色 / 抬筆再下筆 / 超過單段點數上限 → 開新段）
//   - 取樣在固定時步 tick 裡（程式 tween 與手動飛行共用同一條路徑）
//   - 手動飛行（沒跑程式）時自動下筆 → 自由畫布直接飛就能畫
// stroke 資料透過 event bus 發給渲染層（render/ink.ts），core 不持有任何 mesh。
import type { Vec3 } from './droneState';
import { droneState, flags, distVec3 } from './droneState';
import { levelState } from './level';
import { bus } from './events';

// ---- 墨水常數（出處：legacy main.js L947–951）----
/** 取樣時間間隔（ms）— legacy sampleInk 的 60ms 節流 */
export const INK_SAMPLE_INTERVAL_MS = 60;
/** 最小取樣距離（m）— 移動夠遠才記點，避免原地堆點（legacy 0.05） */
export const INK_MIN_SAMPLE_DIST = 0.05;
/** 單段 stroke 點數上限，超過自動接續新段（legacy INK_STROKE_MAX = 1500） */
export const INK_STROKE_MAX_POINTS = 1500;
/** 預設筆色（legacy INK_DEFAULT_COLOR = 0x1565c0 深藍） */
export const INK_DEFAULT_COLOR = '#1565c0';
/** 隨機色盤（畫彩色星星用）— 鮮豔好分辨（legacy INK_PALETTE） */
export const INK_RANDOM_PALETTE = [
  '#ff5252', '#ff9800', '#ffd54f', '#66bb6a',
  '#29b6f6', '#42a5f5', '#ab47bc', '#ec407a',
] as const;
/** drawHeight 缺省值（legacy 各處 `level.drawHeight || 3`） */
export const DRAW_HEIGHT_DEFAULT = 3;

export interface PenState {
  down: boolean;
  /** 目前筆色（'#rrggbb'） */
  color: string;
  /** 進行中 stroke 的流水號；null = 沒有進行中的段 */
  currentStrokeId: number | null;
  /** 目前 stroke 已取樣的點數（超過上限自動開新段） */
  currentStrokePoints: number;
}

export const penState: PenState = {
  down: false,
  color: INK_DEFAULT_COLOR,
  currentStrokeId: null,
  currentStrokePoints: 0,
};

let nextStrokeId = 1;
let lastSampleAt = 0;
/** 上一個取樣點 — 換段時用來銜接、避免斷線（legacy inkLastPoint） */
let lastPoint: Vec3 | null = null;

function startStroke(seed: Vec3 | null): void {
  const id = nextStrokeId++;
  penState.currentStrokeId = id;
  penState.currentStrokePoints = 0;
  bus.emit('ink-stroke-start', { id, color: penState.color });
  // 從上一段末端（或指定位置）起頭 → 段落之間銜接不斷線
  if (seed) pushVertex(seed);
}

function pushVertex(pos: Vec3): void {
  if (penState.currentStrokeId === null) return;
  if (penState.currentStrokePoints >= INK_STROKE_MAX_POINTS) {
    // 這段滿了 → 開新段，用最後一點銜接（legacy inkPushVertex 的接續邏輯）
    startStroke(lastPoint);
  }
  penState.currentStrokePoints++;
  bus.emit('ink-point', {
    id: penState.currentStrokeId as number,
    x: pos.x,
    y: pos.y,
    z: pos.z,
  });
  lastPoint = { x: pos.x, y: pos.y, z: pos.z };
}

/** 下筆：從「現在的位置」起頭（不是抬筆當下的位置）→ 抬筆移動的那段不會被連線 */
export function inkPenDown(): void {
  if (penState.down) return;
  penState.down = true;
  startStroke({ ...droneState.position });
}

/** 抬筆：結束目前這段；下次下筆開新段 */
export function inkPenUp(): void {
  penState.down = false;
  penState.currentStrokeId = null;
  penState.currentStrokePoints = 0;
}

function applyColor(hex: string): void {
  penState.color = hex;
  // 下筆中換色：從現在位置起新的彩色段，與前一段相連不留縫（legacy inkApplyColor）
  if (penState.down) startStroke({ ...droneState.position });
  bus.emit('pen-color-changed', { color: hex });
}

/** 換筆色（'#rrggbb'；'random' / 'rainbow' 走隨機換色 — legacy inkSetColor） */
export function inkSetColor(hex: string): void {
  if (hex === 'random' || hex === 'rainbow') {
    inkRandomColor();
    return;
  }
  const normalized = hex.startsWith('#') ? hex : `#${hex}`;
  if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) return;
  applyColor(normalized.toLowerCase());
}

/** 隨機換色：從色盤挑一個跟現在不同的顏色（彩色星星用） */
export function inkRandomColor(): void {
  let c: string = penState.color;
  let guard = 0;
  while (c === penState.color && guard++ < 8) {
    c = INK_RANDOM_PALETTE[Math.floor(Math.random() * INK_RANDOM_PALETTE.length)] as string;
  }
  applyColor(c);
}

/** 清除所有墨水並重設畫筆（載入 / 離開關卡時呼叫） */
export function clearInk(): void {
  penState.down = false;
  penState.color = INK_DEFAULT_COLOR;
  penState.currentStrokeId = null;
  penState.currentStrokePoints = 0;
  lastPoint = null;
  lastSampleAt = 0;
  bus.emit('ink-clear', {});
  bus.emit('pen-color-changed', { color: INK_DEFAULT_COLOR });
}

/**
 * 每個物理 tick 呼叫：draw 關 + 飛行中 + 下筆才留墨水。
 * 與 legacy sampleInk 相同：60ms 節流 + 最小移動距離 0.05m。
 */
export function tickPen(nowMs: number): void {
  const level = levelState.current;
  if (!level?.draw || !droneState.isFlying) return;
  if (droneState.frozen || droneState.returning) return;
  // 手動飛行（沒有跑程式）時自動下筆 → 自由畫布直接飛就能畫
  if (!flags.programRunning && !penState.down) inkPenDown();
  if (!penState.down) return;
  if (nowMs - lastSampleAt < INK_SAMPLE_INTERVAL_MS) return;
  lastSampleAt = nowMs;
  if (penState.currentStrokeId === null) startStroke(null);
  if (lastPoint && distVec3(lastPoint, droneState.position) < INK_MIN_SAMPLE_DIST) return;
  pushVertex(droneState.position);
}

// 載入 / 切換關卡：清墨水 + 重設畫筆（legacy clearLevelObjects → clearInk）
bus.on('level-loaded', () => clearInk());
