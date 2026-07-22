// 型別化 event bus — 核心層對外發事件的唯一通道。
// core 不碰 DOM、不碰 Babylon；render/ 與 ui/ 訂閱這裡的事件做視覺與介面更新。
import type { ArenaServerMsg, SoccerServerMsg, LevelDef } from '@creafly/shared';

export type ToastKind = '' | 'success' | 'error' | 'warning';
export type SoundName = 'ring' | 'bump' | 'stop' | 'complete' | 'pop' | 'beep' | 'go';

export interface CoreEventMap {
  /** 顯示一則 toast（節流/樣式由 UI 決定） */
  'toast': { text: string; kind: ToastKind };
  /** 狀態列文字（HUD 的「狀態」欄位） */
  'state-hud': { text: string };
  /** 播放程式生成音效 */
  'sound': { name: SoundName };
  /** 三章關卡資料就緒（UI 建關卡選單用） */
  'levels-ready': { levels: LevelDef[] };
  /** 關卡載入完成（render 重建關卡物件、UI 重設 HUD） */
  'level-loaded': { level: LevelDef };
  /** 顯示關卡說明 overlay */
  'level-intro': { level: LevelDef };
  /** 學生按「開始」（或 fallback 逾時自動開始）→ 關閉 intro */
  'level-armed': { level: LevelDef };
  /** 3-2-1 倒數：n=3,2,1；n=0 表示 GO */
  'countdown': { n: number };
  /** 穿過一個圈 */
  'ring-passed': { index: number; collected: number; total: number };
  /** 重置：所有圈恢復可見 */
  'rings-reset': Record<string, never>;
  /** faceYaw 圈的對準狀態改變（render 變綠用） */
  'ring-face': { index: number; aligned: boolean };
  /** 完成一個 pass zone 步驟 */
  'zone-passed': { index: number; done: number; total: number };
  /** 戳破一顆氣球 */
  'balloon-popped': { index: number; collected: number; total: number };
  /** returnHome 關卡的引導階段 */
  'return-home': { phase: 'pending' | 'return' | 'land' | 'done' };
  /** 過關（手動或程式模式皆會發；net 層據此上報老師） */
  'level-complete': { levelId: string; timeMs: number };
  /** 手動 ↔ 程式模式切換 */
  'mode-changed': { mode: 'manual' | 'program' };
  /** 程式開始 / 結束執行 */
  'program-running': { running: boolean };
  /** 清除飛行軌跡線 */
  'trail-clear': Record<string, never>;
  // ---- 畫畫教室（core/pen.ts → render/ink.ts + ui）----
  /** 開新一段墨水 stroke（下筆 / 換色 / 段滿接續） */
  'ink-stroke-start': { id: number; color: string };
  /** 進行中 stroke 新增一個取樣點 */
  'ink-point': { id: number; x: number; y: number; z: number };
  /** 清除所有墨水（載入 / 離開關卡） */
  'ink-clear': Record<string, never>;
  /** 筆色改變（UI 筆色選擇列同步高亮） */
  'pen-color-changed': { color: string };
  // ---- 多人（net/ws.ts ↔ multiplayer/arena.ts）----
  /** WS 連上（含重連成功；arena 據此補送 arena_join） */
  'ws-connected': Record<string, never>;
  /** 伺服器 arena_* 訊息（ws 只分派、不處理） */
  'arena-message': { msg: ArenaServerMsg };
  /** 進入大亂鬥（render 建場地、UI 切 HUD） */
  'arena-entered': Record<string, never>;
  /** 場地切換（伺服器權威；render/playground 據此載入 / 卸下 glb 場景與網格碰撞） */
  'arena-field-changed': { field: 'grid' | 'playground' };
  /** 離開大亂鬥（render 清分身/氣球、UI 還原） */
  'arena-exited': Record<string, never>;
  /** 清除目前關卡（進大亂鬥時停用一般關卡判定與物件） */
  'level-cleared': Record<string, never>;
  // ---- ⚽ 足球（soccer/practice.ts、multiplayer/soccer.ts ↔ render/soccerField.ts）----
  /**
   * 遊戲模式接管：進入任一接管型模式（大亂鬥 / 足球練習 / 足球對戰）前發出，
   * 其他模式收到後自行退出 —— 模組間互斥不互相 import（避免循環依賴）。
   * 'level' = 老師廣播切關 / 比賽 / 重置（智能切關）：所有接管型模式都退出。
   */
  'mode-takeover': { mode: 'arena' | 'soccer-practice' | 'soccer-match' | 'level' };
  /** 伺服器 soccer_* 訊息（ws 只分派、不處理） */
  'soccer-message': { msg: SoccerServerMsg };
  /** 進入足球模式（render 建場地 / 球門碰撞 / 球形保護框；UI 切 HUD） */
  'soccer-entered': { variant: 'practice' | 'match' };
  /** 伺服器下發的場地定義生效（值在 soccer/field.ts；render 據此重建場地與門環） */
  'soccer-field-changed': Record<string, never>;
  /** 離開足球模式（render 清場地與分身、還原機體大小） */
  'soccer-exited': Record<string, never>;
  /** 窄邊定點視角切換：sign = 站哪個 z 端往場內看（+1 / -1）；null = 還原跟隨視角 */
  'soccer-view-changed': { sign: number | null };
  /** 練習 P-5 假人擺放（render 畫紫色方塊；碰撞由 setSolidObstacles 註冊） */
  'soccer-dummies-changed': { boxes: { x: number; y: number; z: number; half: number }[] };
  // ---- 搖桿校正精靈（input/calibration.ts → ui/calibrationOverlay.ts）----
  /** 顯示 / 隱藏校正 overlay */
  'calib-show': { show: boolean };
  /** 進入新步驟（done = 8 步全部完成，等待儲存/取消） */
  'calib-step': {
    stepIdx: number;
    total: number;
    label: string;
    hint: string;
    hasTimer: boolean;
    durationMs: number;
    done: boolean;
  };
  /** 步驟倒數進度（獨立 setInterval 驅動，防 rAF 卡住） */
  'calib-timer': { pct: number; remainSec: number };
  /** 校正中即時軸值 / 按鍵狀態（overlay 底部 live 區） */
  'calib-live': { axes: number[]; buttons: boolean[] };
  /** 校正結束（saved = 是否儲存套用） */
  'calib-ended': { saved: boolean };
}

type Handler<T> = (payload: T) => void;

export class EventBus<M> {
  private handlers = new Map<keyof M, Set<Handler<never>>>();

  on<K extends keyof M>(type: K, fn: Handler<M[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(fn as Handler<never>);
    return () => set.delete(fn as Handler<never>);
  }

  emit<K extends keyof M>(type: K, payload: M[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of set) {
      try {
        (fn as Handler<M[K]>)(payload);
      } catch (e) {
        // 訂閱者出錯不可拖垮核心迴圈
        console.error(`[events] handler for "${String(type)}" threw:`, e);
      }
    }
  }
}

/** 全域單例：核心 → 渲染/UI 的事件匯流排 */
export const bus = new EventBus<CoreEventMap>();

export function toast(text: string, kind: ToastKind = ''): void {
  bus.emit('toast', { text, kind });
}

export function stateHud(text: string): void {
  bus.emit('state-hud', { text });
}

export function sound(name: SoundName): void {
  bus.emit('sound', { name });
}
