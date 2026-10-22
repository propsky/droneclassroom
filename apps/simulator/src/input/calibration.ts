// 搖桿校正精靈。
// 規則參考 ShramkoGSFPV 的相對基線、手動點選與「時間不採納對應」，
// 實作為本專案重寫，未複製其實作，也不移植 Arm 狀態機。
// 狀態機不碰 DOM；ui/calibrationOverlay.ts 訂閱 calib-view。
import { bus, toast, type CoreEventMap } from '../core/events';
import { urlPresetOverrides } from './padMath';

export type CalibView = CoreEventMap['calib-view'];

export type StickFn = 'throttle' | 'yaw' | 'pitch' | 'roll';
export type ButtonFn = 'takeoff' | 'land' | 'reset';
export type AxisArm = { kind: 'axis' | 'button'; index: number };

export interface GamepadConfig {
  deadzone: number;
  invertThrottle: boolean;
  invertPitch: boolean;
  /** 校正觀察到的左右方向；缺省當 false，不改舊手感 */
  invertYaw?: boolean;
  invertRoll?: boolean;
  /** 語意軸 → 實體 axes index。預設是美國手猜測，可被實際動作覆蓋。 */
  axes: { throttle: number; pitch: number; yaw: number; roll: number };
  buttonMap: { takeoff: number; land: number; reset: number };
  /** 每軸置中值（校正精靈量測） */
  center: number[];
  /** 每軸範圍（校正精靈量測；套用時 (raw - center) / range） */
  range: number[];
  /**
   * 選用的解鎖來源。飛行迴圈不讀這個欄位，
   * 鍵盤與虛擬搖桿仍走開始 + 起飛。null = 這次明確跳過。
   */
  arm?: AxisArm | null;
}

export interface PadSnapshot {
  connected: boolean;
  axes: readonly number[];
  buttons: readonly boolean[];
}

const STICKS: StickFn[] = ['throttle', 'yaw', 'pitch', 'roll'];
const BUTTONS: ButtonFn[] = ['takeoff', 'land', 'reset'];

const STICK_NAME: Record<StickFn, string> = {
  throttle: '油門',
  yaw: '偏航',
  pitch: '俯仰',
  roll: '橫滾',
};

const BUTTON_NAME: Record<ButtonFn, string> = {
  takeoff: '起飛',
  land: '降落',
  reset: '重置',
};

interface StepDef {
  id: string;
  kind: 'letGo' | 'stir' | 'axis' | 'button' | 'arm';
  fn?: StickFn | ButtonFn;
  label: string;
  hint: string;
}

interface Notice {
  kind: 'axis' | 'button';
  index: number;
  raw: number;
  /** 這一拍相對基線的差，畫面即時更新 */
  delta: number;
  /** 這次注意到的最大差，用來決定反轉；鬆桿不會把它洗掉 */
  peak: number;
  pressed: boolean;
}

export const CALIB_LS_KEY = 'creafly_gamepad_calib';
const VERSION_LS_KEY = 'creafly_app_version';
/** 1.6.0：相對基線精靈。舊的 1.5.x 設定檔欄位仍可沿用，不再整包刪除。 */
export const CALIB_VERSION = '1.6.0';

export class GamepadConfigStore {
  static fresh(): GamepadConfig {
    return {
      deadzone: 0.1,
      invertThrottle: false,
      invertPitch: false,
      invertYaw: false,
      invertRoll: false,
      axes: { throttle: 1, pitch: 3, yaw: 0, roll: 2 },
      buttonMap: { takeoff: 0, land: 1, reset: 2 },
      center: [0, 0, 0, 0],
      range: [1, 1, 1, 1],
    };
  }

  static migrate(
    savedJson: string | null,
    storedVersion: string | null,
  ): { config: GamepadConfig; rewrite: boolean; persistConfig: boolean } {
    const versionDiffers = storedVersion !== CALIB_VERSION;
    if (!savedJson) {
      return { config: GamepadConfigStore.fresh(), rewrite: versionDiffers, persistConfig: false };
    }
    let raw: unknown;
    try {
      raw = JSON.parse(savedJson);
    } catch {
      return { config: GamepadConfigStore.fresh(), rewrite: true, persistConfig: true };
    }
    const parsed = GamepadConfigStore.fromUnknown(raw);
    if (!parsed) {
      return { config: GamepadConfigStore.fresh(), rewrite: true, persistConfig: true };
    }
    return { config: parsed, rewrite: versionDiffers, persistConfig: versionDiffers };
  }

  static fromUnknown(raw: unknown): GamepadConfig | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const base = GamepadConfigStore.fresh();
    const axes = GamepadConfigStore.readAxes(o.axes);
    const buttons = GamepadConfigStore.readButtons(o.buttonMap);
    if (!axes || !buttons) return null;
    const center = GamepadConfigStore.readNumList(o.center);
    const range = GamepadConfigStore.readNumList(o.range);
    const dead = GamepadConfigStore.readNum(o.deadzone);
    return {
      deadzone: dead !== null && dead > 0 && dead < 1 ? dead : base.deadzone,
      invertThrottle: o.invertThrottle === true,
      invertPitch: o.invertPitch === true,
      invertYaw: o.invertYaw === true,
      invertRoll: o.invertRoll === true,
      axes,
      buttonMap: buttons,
      center: center ?? base.center.slice(),
      range: range ?? base.range.slice(),
      arm: GamepadConfigStore.readArm(o.arm),
    };
  }

  private static readNum(v: unknown): number | null {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }

  private static readIndex(v: unknown): number | null {
    const n = GamepadConfigStore.readNum(v);
    if (n === null || n < 0 || !Number.isInteger(n)) return null;
    return n;
  }

  private static readAxes(v: unknown): GamepadConfig['axes'] | null {
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    const throttle = GamepadConfigStore.readIndex(o.throttle);
    const pitch = GamepadConfigStore.readIndex(o.pitch);
    const yaw = GamepadConfigStore.readIndex(o.yaw);
    const roll = GamepadConfigStore.readIndex(o.roll);
    if (throttle === null || pitch === null || yaw === null || roll === null) return null;
    return { throttle, pitch, yaw, roll };
  }

  private static readButtons(v: unknown): GamepadConfig['buttonMap'] | null {
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    const takeoff = GamepadConfigStore.readIndex(o.takeoff);
    const land = GamepadConfigStore.readIndex(o.land);
    const reset = GamepadConfigStore.readIndex(o.reset);
    if (takeoff === null || land === null || reset === null) return null;
    return { takeoff, land, reset };
  }

  private static readNumList(v: unknown): number[] | null {
    if (!Array.isArray(v) || v.length === 0) return null;
    const out: number[] = [];
    for (const item of v) {
      const n = GamepadConfigStore.readNum(item);
      if (n === null) return null;
      out.push(n);
    }
    return out;
  }

  private static readArm(v: unknown): AxisArm | null | undefined {
    if (v === null) return null;
    if (!v || typeof v !== 'object') return undefined;
    const o = v as Record<string, unknown>;
    const index = GamepadConfigStore.readIndex(o.index);
    if (index === null) return undefined;
    if (o.kind === 'axis' || o.kind === 'button') return { kind: o.kind, index };
    return undefined;
  }
}

export const gamepadConfig: GamepadConfig = GamepadConfigStore.fresh();

/** URL 快速 preset（教室常見手把；對齊 legacy ?map= / ?inv=） */
export function applyUrlPresets(): void {
  Object.assign(gamepadConfig, urlPresetOverrides(location.search));
}

function writeConfig(next: GamepadConfig): void {
  gamepadConfig.deadzone = next.deadzone;
  gamepadConfig.invertThrottle = next.invertThrottle;
  gamepadConfig.invertPitch = next.invertPitch;
  gamepadConfig.invertYaw = next.invertYaw ?? false;
  gamepadConfig.invertRoll = next.invertRoll ?? false;
  gamepadConfig.axes = { ...next.axes };
  gamepadConfig.buttonMap = { ...next.buttonMap };
  gamepadConfig.center = next.center.slice();
  gamepadConfig.range = next.range.slice();
  if (next.arm === undefined) delete gamepadConfig.arm;
  else gamepadConfig.arm = next.arm ? { ...next.arm } : null;
}

/** 重置為預設並清除 localStorage 校正資料 */
export function resetGamepadConfig(): void {
  writeConfig(GamepadConfigStore.fresh());
  delete gamepadConfig.arm;
  applyUrlPresets();
  try {
    localStorage.removeItem(CALIB_LS_KEY);
  } catch {
    /* ignore */
  }
  saveGamepadConfig();
}

/** 載入上次校正。版本不同時保留仍讀得懂的軸與按鍵，不再整包刪掉。 */
export function loadGamepadConfig(): void {
  try {
    const storedVer = localStorage.getItem(VERSION_LS_KEY);
    const saved = localStorage.getItem(CALIB_LS_KEY);
    const migrated = GamepadConfigStore.migrate(saved, storedVer);
    writeConfig(migrated.config);
    if (migrated.rewrite) localStorage.setItem(VERSION_LS_KEY, CALIB_VERSION);
    if (migrated.persistConfig) saveGamepadConfig();
    if (migrated.rewrite && saved) {
      console.log(`[校正] 已沿用舊設定並升級到 ${CALIB_VERSION}`);
    }
  } catch (e) {
    console.warn('[校正] 載入校正設定失敗', e);
  }
  applyUrlPresets();
}

export function saveGamepadConfig(): void {
  try {
    localStorage.setItem(CALIB_LS_KEY, JSON.stringify(gamepadConfig));
    localStorage.setItem(VERSION_LS_KEY, CALIB_VERSION);
  } catch {
    /* ignore（無痕模式等） */
  }
}

/**
 * 純邏輯校正狀態機。時間由呼叫端注入。
 * Mode 2 只出現在說明文字，不參與軸的選擇。
 */
export class CalibrationWizard {
  static readonly TRAVEL_FRACTION = 0.3;
  static readonly ABS_FLOOR = 0.12;
  static readonly ENOUGH_SPAN = 0.5;
  static readonly HINT_MS = 2000;
  static readonly LET_GO_MS = 1600;
  static readonly RANGE_OFFER_MS = 8000;
  static readonly STICK_MODE = 2 as const;
  static readonly MAX_AXES = 16;
  static readonly HAT_NOTE =
    '十字鍵若有送進瀏覽器，會出現在按鈕列；這裡沒有另做類比帽子軸。';
  static readonly MODE_NOTE =
    'Mode 2 只決定圖上哪一手（左手油門／偏航，右手俯仰／橫滾），不決定裝置軸或 CH 編號。';

  static readonly STEPS: readonly StepDef[] = [
    {
      id: 'letGo',
      kind: 'letGo',
      label: '放開所有搖桿',
      hint: '手離開搖桿與按鍵。時間到會記下靜止位置，不會把任何一根當成油門。',
    },
    {
      id: 'stir',
      kind: 'stir',
      label: '把搖桿推到極限',
      hint: '每根搖桿推到底再轉一圈。行程夠了會進下一步；時間到只出現「就用目前看到的」，不會自己決定哪一根是油門。',
    },
    {
      id: 'throttle',
      kind: 'axis',
      fn: 'throttle',
      label: '油門往上推',
      hint: '把油門往上推。看到變化後按「就用這個」才算數。這一步同時聽軸和按鈕。',
    },
    {
      id: 'yaw',
      kind: 'axis',
      fn: 'yaw',
      label: '偏航向左轉',
      hint: '向左轉。軸和按鈕都會顯示；按「就用這個」才寫入。',
    },
    {
      id: 'pitch',
      kind: 'axis',
      fn: 'pitch',
      label: '俯仰向前推',
      hint: '向前推。軸和按鈕都會顯示；按「就用這個」才寫入。',
    },
    {
      id: 'roll',
      kind: 'axis',
      fn: 'roll',
      label: '橫滾向右推',
      hint: '向右推。軸和按鈕都會顯示；按「就用這個」才寫入。',
    },
    {
      id: 'takeoff',
      kind: 'button',
      fn: 'takeoff',
      label: '按「起飛」按鈕',
      hint: '按你要當起飛的那顆。若有軸在動也會顯示，但這一步要記下的是按鈕。',
    },
    {
      id: 'land',
      kind: 'button',
      fn: 'land',
      label: '按「降落」按鈕',
      hint: '按你要當降落的那顆。軸若有動也會一起顯示。',
    },
    {
      id: 'reset',
      kind: 'button',
      fn: 'reset',
      label: '按「重置」按鈕',
      hint: '按你要當重置的那顆。軸若有動也會一起顯示。',
    },
    {
      id: 'arm',
      kind: 'arm',
      label: '解鎖開關（可跳過）',
      hint: '有開關就撥一下或按一顆；沒有就按「跳過」。跳過之後仍用現在的開始鍵與起飛，鍵盤和虛擬搖桿不受影響。',
    },
  ];

  /** 門檻是這根軸自己看過的行程的固定比例，再加上小地板。不用 0.95，也不寫死某一通道。 */
  static changeThreshold(span: number): number {
    const safe = Number.isFinite(span) && span > 0 ? span : 0;
    return Math.max(CalibrationWizard.ABS_FLOOR, CalibrationWizard.TRAVEL_FRACTION * safe);
  }

  /** 裝置軸從 1 起算；無線電 CH 是另一個標籤，同樣是 index + 1，兩者都寫出來。 */
  static axisLabels(index: number): { device: string; radio: string } {
    const n = index + 1;
    return { device: `裝置軸 ${n}`, radio: `CH${n}` };
  }

  static missingAxesNote(count: number): string | null {
    if (count >= 8) return null;
    return `這條連線只看到 ${count} 軸，開關可能在後面的通道。沒有把缺少的軸補成 0。`;
  }

  static travelTag(span: number, steps: number): string {
    if (!(span >= 0.2)) return '安靜';
    if (steps >= 4 && span >= 0.45) return '搖桿';
    if (span >= 0.5 && steps <= 3) return '開關';
    return '有動';
  }

  static formatAxisSeen(index: number, value: number, delta: number): string {
    const { device, radio } = CalibrationWizard.axisLabels(index);
    return `看到 ${device}（若這是無線電模型，這是 ${radio}）　值 ${value.toFixed(2)}　差 ${CalibrationWizard.formatSigned(delta, 2)}`;
  }

  static formatButtonSeen(index: number, pressed: boolean, delta: number): string {
    const value = pressed ? '按下' : '放開';
    return `看到 按鈕 ${index}　值 ${value}　差 ${CalibrationWizard.formatSigned(delta, 0)}`;
  }

  static formatSigned(delta: number, digits: number): string {
    const sign = delta > 0 || Object.is(delta, 0) ? '+' : '';
    return sign + (digits > 0 ? delta.toFixed(digits) : String(Math.trunc(delta)));
  }

  static buildIdleHint(axisCount: number, buttonCount: number, occupied: string[]): string {
    const axes =
      axisCount <= 0 ? '目前沒有軸' : `裝置軸 1–${axisCount}（共 ${axisCount} 軸）`;
    const buttons =
      buttonCount <= 0 ? '目前沒有按鈕' : `按鈕 0–${buttonCount - 1}（共 ${buttonCount} 顆）`;
    const occ = occupied.length ? `已指定、這一步先不採用：${occupied.join('、')}。` : '';
    return (
      `已經 2 秒沒有相對這一步開始時的變化。現在同時在聽 ${axes} 與 ${buttons}。${occ}` +
      '手動點選：點下方的裝置軸或按鈕，再按「就用這個」；點了軸仍會繼續聽按鈕，可按「全部再聽」恢復。' +
      '跳過：按「跳過」，這一步不寫入對應。'
    );
  }

  /** 推桿方向要變成教室裡的上／前／右／左轉。delta 太小就不改反轉。 */
  static invertFor(fn: StickFn, delta: number): boolean {
    if (fn === 'roll') return delta < 0;
    return delta > 0;
  }

  private running = false;
  private stepIdx = 0;
  private now = 0;
  private stepStart = 0;
  private idleFrom = 0;
  private listening = false;
  private lastAxes: number[] = [];
  private lastButtons: boolean[] = [];
  private baseAxes: number[] = [];
  private baseButtons: boolean[] = [];
  private restSum: number[] = [];
  private restCount: number[] = [];
  private rest: number[] = [];
  private tMin: number[] = [];
  private tMax: number[] = [];
  private tSteps: number[] = [];
  private prevAxes: number[] = [];
  private assignedAxes: Partial<Record<StickFn, number>> = {};
  private assignedButtons: Partial<Record<ButtonFn, number>> = {};
  private invert: Partial<Record<StickFn, boolean>> = {};
  private armChoice: AxisArm | null = null;
  private armTouched = false;
  private seen: Notice | null = null;
  private also: Notice | null = null;
  private focus: { kind: 'axis' | 'button'; index: number } | null = null;
  private offerPartial = false;
  private occupiedHint: string | null = null;
  private motionHint: string | null = null;
  private extraHint: string | null = null;
  private mismatchHint: string | null = null;
  private idleHint: string | null = null;

  get isActive(): boolean {
    return this.running;
  }

  get stepIndex(): number {
    return this.stepIdx;
  }

  start(now: number): void {
    this.reset();
    this.running = true;
    this.now = now;
    this.stepStart = now;
    this.idleFrom = now;
  }

  stop(): void {
    this.running = false;
  }

  sample(frame: PadSnapshot, now: number): void {
    if (!this.running) return;
    this.now = now;
    const axes = this.copyAxes(frame.axes);
    const buttons = frame.buttons.map((b) => !!b);
    this.lastAxes = axes;
    this.lastButtons = buttons;

    if (this.isDone()) {
      this.refreshIdle();
      return;
    }

    const step = this.step();
    if (!step) return;

    if (step.kind === 'letGo') {
      this.accumulateRest(axes);
      if (now - this.stepStart >= CalibrationWizard.LET_GO_MS) {
        this.freezeRest();
        this.advance(now);
      }
      this.refreshIdle();
      return;
    }

    if (step.kind === 'stir' && !this.listening) {
      this.captureBaseline(axes, buttons);
      this.seedTravel(axes);
      this.listening = true;
      if (now - this.stepStart >= CalibrationWizard.RANGE_OFFER_MS) this.offerPartial = true;
      this.refreshIdle();
      return;
    }

    if (this.needsRelease(step) && !this.listening) {
      if (now - this.stepStart >= CalibrationWizard.LET_GO_MS || this.nearRest(axes)) {
        this.captureBaseline(axes, buttons);
        this.listening = true;
        this.idleFrom = now;
      }
      this.refreshIdle();
      return;
    }

    // 基線是空的（還沒採到樣本就按了「手放開了」）時，第一筆真實軸值只當基線，不當推動。
    if (this.listening && this.baseAxes.length === 0 && axes.length > 0) {
      this.captureBaseline(axes, buttons);
      this.refreshIdle();
      return;
    }

    this.detect(axes, buttons);
    this.refreshSeen(axes, buttons);

    if (step.kind === 'stir') {
      if (this.enough(axes.length)) this.advance(now);
      else if (now - this.stepStart >= CalibrationWizard.RANGE_OFFER_MS) this.offerPartial = true;
    }
    this.refreshIdle();
  }

  confirm(now: number): boolean {
    if (!this.running || this.isDone()) return false;
    this.now = now;
    const step = this.step();
    if (!step) return false;
    if (step.kind === 'letGo') {
      this.confirmHandsOff(now);
      return true;
    }
    if (step.kind === 'stir') {
      this.advance(now);
      return true;
    }
    const target = this.seen;
    if (!target) return false;
    if (step.kind === 'axis' && step.fn) {
      if (target.kind !== 'axis') {
        this.mismatchHint = '這一步要指定的是搖桿軸，剛剛看到的是按鈕。按鈕沒有被關掉，請改點一根軸，或按跳過。';
        return false;
      }
      this.assignAxis(step.fn as StickFn, target.index, target.peak);
      this.advance(now);
      return true;
    }
    if (step.kind === 'button' && step.fn) {
      if (target.kind !== 'button') {
        this.mismatchHint = '這一步要指定的是按鈕，剛剛看到的是軸。軸沒有被排除，請改按一顆按鈕，或按跳過。';
        return false;
      }
      this.assignButton(step.fn as ButtonFn, target.index);
      this.advance(now);
      return true;
    }
    if (step.kind === 'arm') {
      this.armChoice = { kind: target.kind, index: target.index };
      this.armTouched = true;
      this.advance(now);
      return true;
    }
    return false;
  }

  skip(now: number): void {
    if (!this.running || this.isDone()) return;
    this.now = now;
    const step = this.step();
    if (step?.kind === 'letGo') this.freezeRest();
    if (step?.kind === 'arm') {
      this.armChoice = null;
      this.armTouched = true;
    }
    this.advance(now);
  }

  /** 行程步驟逾時後，用目前看到的範圍前進。不指定油門／偏航。 */
  acceptPartial(now: number): boolean {
    if (!this.running || this.step()?.kind !== 'stir') return false;
    this.now = now;
    this.advance(now);
    return true;
  }

  confirmHandsOff(now: number): void {
    if (!this.running || this.isDone()) return;
    this.now = now;
    const step = this.step();
    if (!step) return;
    if (step.kind === 'letGo') {
      this.freezeRest();
      this.advance(now);
      return;
    }
    if (this.needsRelease(step) && !this.listening) {
      this.captureBaseline(this.lastAxes, this.lastButtons);
      this.listening = true;
      this.idleFrom = now;
      this.idleHint = null;
    }
  }

  pickAxis(index: number, now: number): void {
    if (!this.running || this.isDone()) return;
    this.now = now;
    if (index < 0 || index >= this.lastAxes.length) return;
    const raw = this.lastAxes[index];
    if (raw === undefined || !Number.isFinite(raw)) return;
    this.focus = { kind: 'axis', index };
    const stored = this.baseAxes[index];
    const base = this.listening && stored !== undefined ? stored : raw;
    const delta = raw - base;
    this.seen = { kind: 'axis', index, raw, delta, peak: delta, pressed: false };
    this.also = null;
    this.idleHint = null;
    this.mismatchHint = null;
  }

  pickButton(index: number, now: number): void {
    if (!this.running || this.isDone()) return;
    this.now = now;
    if (index < 0 || index >= this.lastButtons.length) return;
    const pressed = this.lastButtons[index];
    if (pressed === undefined) return;
    this.focus = { kind: 'button', index };
    const base = this.listening ? (this.baseButtons[index] ?? false) : pressed;
    const delta = pressed === base ? 0 : pressed ? 1 : -1;
    this.seen = { kind: 'button', index, raw: pressed ? 1 : 0, delta, peak: delta, pressed };
    this.also = null;
    this.idleHint = null;
    this.mismatchHint = null;
  }

  listenAll(now: number): void {
    if (!this.running) return;
    this.now = now;
    this.focus = null;
  }

  toConfig(base: GamepadConfig): GamepadConfig {
    const config: GamepadConfig = {
      deadzone: base.deadzone,
      invertThrottle: base.invertThrottle,
      invertPitch: base.invertPitch,
      invertYaw: base.invertYaw ?? false,
      invertRoll: base.invertRoll ?? false,
      axes: { ...base.axes },
      buttonMap: { ...base.buttonMap },
      center: base.center.slice(),
      range: base.range.slice(),
      arm: base.arm ? { ...base.arm } : base.arm,
    };
    for (const fn of STICKS) {
      const index = this.assignedAxes[fn];
      if (index === undefined) continue;
      config.axes[fn] = index;
      // 只把「有對應到的 index」補進儲存陣列，讓飛行讀得到 center。
      // 這不是把連線沒回報的軸補成一根活的 0。
      while (config.center.length <= index) config.center.push(0);
      while (config.range.length <= index) config.range.push(1);
      const rest = this.rest[index];
      const center = rest !== undefined && Number.isFinite(rest) ? rest : (this.baseAxes[index] ?? 0);
      config.center[index] = center;
      let dev = 0.5;
      const lo = this.tMin[index];
      const hi = this.tMax[index];
      if (lo !== undefined && Number.isFinite(lo)) dev = Math.max(dev, Math.abs(lo - center));
      if (hi !== undefined && Number.isFinite(hi)) dev = Math.max(dev, Math.abs(hi - center));
      config.range[index] = dev;
    }
    if (this.invert.throttle !== undefined) config.invertThrottle = this.invert.throttle;
    if (this.invert.pitch !== undefined) config.invertPitch = this.invert.pitch;
    if (this.invert.yaw !== undefined) config.invertYaw = this.invert.yaw;
    if (this.invert.roll !== undefined) config.invertRoll = this.invert.roll;
    for (const fn of BUTTONS) {
      const index = this.assignedButtons[fn];
      if (index !== undefined) config.buttonMap[fn] = index;
    }
    if (this.armTouched) config.arm = this.armChoice ? { ...this.armChoice } : null;
    return config;
  }

  summary(base: GamepadConfig): string[] {
    const cfg = this.toConfig(base);
    const lines: string[] = [];
    for (const fn of STICKS) {
      const index = cfg.axes[fn];
      const labels = CalibrationWizard.axisLabels(index);
      const skipped = this.assignedAxes[fn] === undefined ? '（這一步跳過，沿用原本的對應）' : '';
      const inv =
        fn === 'throttle'
          ? cfg.invertThrottle
          : fn === 'pitch'
            ? cfg.invertPitch
            : fn === 'yaw'
              ? cfg.invertYaw
              : cfg.invertRoll;
      lines.push(
        `${STICK_NAME[fn]}：${labels.device}（若這是無線電模型，這是 ${labels.radio}），` +
          `center ${(cfg.center[index] ?? 0).toFixed(3)}，range ${(cfg.range[index] ?? 1).toFixed(3)}，` +
          `反轉 ${inv ? '開' : '關'}${skipped}`,
      );
    }
    for (const fn of BUTTONS) {
      const skipped = this.assignedButtons[fn] === undefined ? '（沿用原本的）' : '';
      lines.push(`${BUTTON_NAME[fn]}：按鈕 ${cfg.buttonMap[fn]}${skipped}`);
    }
    if (!this.armTouched || this.armChoice === null) {
      lines.push('解鎖：未設定。維持開始鍵與起飛，鍵盤和虛擬搖桿不受影響。');
    } else {
      const arm = this.armChoice;
      const what =
        arm.kind === 'axis'
          ? `${CalibrationWizard.axisLabels(arm.index).device}（${CalibrationWizard.axisLabels(arm.index).radio}）`
          : `按鈕 ${arm.index}`;
      lines.push(`解鎖：已記下 ${what}。飛行不會改成必須解鎖，鍵盤與虛擬搖桿仍用開始鍵與起飛。`);
    }
    lines.push(`這次連線看到 ${this.lastAxes.length} 軸。`);
    return lines;
  }

  view(base?: GamepadConfig): CalibView {
    const step = this.step();
    const done = this.isDone();
    const id = done ? 'done' : (step?.id ?? 'done');
    const axes = this.lastAxes.map((raw, index) => {
      const ref = this.deltaRef(index, raw);
      const delta = Number.isFinite(raw) && Number.isFinite(ref) ? raw - ref : 0;
      const labels = CalibrationWizard.axisLabels(index);
      const span = this.spanOf(index);
      return {
        index,
        deviceLabel: labels.device,
        radioLabel: labels.radio,
        raw,
        delta,
        span,
        tag: CalibrationWizard.travelTag(span, this.tSteps[index] ?? 0),
      };
    });
    const buttons = this.lastButtons.map((pressed, index) => ({
      index,
      pressed,
      changed: this.listening ? pressed !== (this.baseButtons[index] ?? false) : false,
    }));
    const elapsed = this.now - this.stepStart;
    return {
      stepId: id,
      stepIdx: Math.min(this.stepIdx, CalibrationWizard.STEPS.length),
      total: CalibrationWizard.STEPS.length,
      label: done ? '校正完成' : (step?.label ?? ''),
      hint: done
        ? '按「儲存並套用」寫進這台裝置。鍵盤和虛擬搖桿不需要這份校正也能起飛。'
        : (step?.hint ?? ''),
      done,
      diagram: this.diagram(),
      modeNote: CalibrationWizard.MODE_NOTE,
      letGo:
        id === 'letGo'
          ? {
              pct: Math.min(100, (elapsed / CalibrationWizard.LET_GO_MS) * 100),
              remainSec: Math.max(0, Math.ceil((CalibrationWizard.LET_GO_MS - elapsed) / 1000)),
            }
          : null,
      seenText: this.seen ? this.noticeText(this.seen) : null,
      alsoSeenText: this.also ? this.noticeText(this.also) : null,
      confirmLabel: id === 'stir' ? '就用目前看到的' : '就用這個',
      showConfirm: !!this.seen && !done,
      showSkip: !done,
      skipProminent: id === 'arm',
      showUsePartial: id === 'stir' && this.offerPartial,
      showHandsOff: id === 'letGo' || (!!step && this.needsRelease(step) && !this.listening && !done),
      showPicks: !done,
      idleHint: this.idleHint,
      occupiedHint: this.occupiedHint,
      motionHint: this.motionHint,
      extraHint: this.extraHint,
      mismatchHint: this.mismatchHint,
      missingAxesNote: CalibrationWizard.missingAxesNote(this.lastAxes.length),
      hatNote: CalibrationWizard.HAT_NOTE,
      focus: this.focus ? { ...this.focus } : null,
      axes,
      buttons,
      summaryLines: done && base ? this.summary(base) : [],
    };
  }

  private reset(): void {
    this.running = false;
    this.stepIdx = 0;
    this.now = 0;
    this.stepStart = 0;
    this.idleFrom = 0;
    this.listening = false;
    this.lastAxes = [];
    this.lastButtons = [];
    this.baseAxes = [];
    this.baseButtons = [];
    this.restSum = [];
    this.restCount = [];
    this.rest = [];
    this.clearTravel();
    this.prevAxes = [];
    this.assignedAxes = {};
    this.assignedButtons = {};
    this.invert = {};
    this.armChoice = null;
    this.armTouched = false;
    this.seen = null;
    this.also = null;
    this.focus = null;
    this.offerPartial = false;
    this.occupiedHint = null;
    this.motionHint = null;
    this.extraHint = null;
    this.mismatchHint = null;
    this.idleHint = null;
  }

  private clearTravel(): void {
    this.tMin = [];
    this.tMax = [];
    this.tSteps = [];
    this.prevAxes = [];
  }

  private step(): StepDef | null {
    return CalibrationWizard.STEPS[this.stepIdx] ?? null;
  }

  private isDone(): boolean {
    return this.stepIdx >= CalibrationWizard.STEPS.length;
  }

  private needsRelease(step: StepDef): boolean {
    return step.kind === 'axis' || step.kind === 'button' || step.kind === 'arm';
  }

  private diagram(): 'left' | 'right' | 'none' {
    const id = this.step()?.id;
    if (id === 'throttle' || id === 'yaw') return 'left';
    if (id === 'pitch' || id === 'roll') return 'right';
    return 'none';
  }

  private copyAxes(src: readonly number[]): number[] {
    const n = Math.min(src.length, CalibrationWizard.MAX_AXES);
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const v = src[i];
      out.push(typeof v === 'number' ? v : Number.NaN);
    }
    return out;
  }

  private advance(now: number): void {
    this.stepIdx += 1;
    this.stepStart = now;
    this.idleFrom = now;
    this.now = now;
    this.listening = false;
    this.baseAxes = [];
    this.baseButtons = [];
    this.seen = null;
    this.also = null;
    this.focus = null;
    this.offerPartial = false;
    this.occupiedHint = null;
    this.motionHint = null;
    this.extraHint = null;
    this.mismatchHint = null;
    this.idleHint = null;
    if (this.step()?.kind === 'stir') this.clearTravel();
  }

  private captureBaseline(axes: readonly number[], buttons: readonly boolean[]): void {
    this.baseAxes = axes.slice();
    this.baseButtons = buttons.slice();
  }

  private accumulateRest(axes: readonly number[]): void {
    for (let i = 0; i < axes.length; i++) {
      const v = axes[i];
      if (v === undefined || !Number.isFinite(v)) continue;
      this.restSum[i] = (this.restSum[i] ?? 0) + v;
      this.restCount[i] = (this.restCount[i] ?? 0) + 1;
    }
  }

  private freezeRest(): void {
    this.rest = [];
    for (let i = 0; i < this.restSum.length; i++) {
      const count = this.restCount[i] ?? 0;
      if (count > 0) this.rest[i] = (this.restSum[i] ?? 0) / count;
    }
  }

  private nearRest(axes: readonly number[]): boolean {
    for (let i = 0; i < axes.length; i++) {
      const v = axes[i];
      if (v === undefined || !Number.isFinite(v)) continue;
      const rest = this.rest[i];
      const center = rest !== undefined && Number.isFinite(rest) ? rest : 0;
      if (Math.abs(v - center) > CalibrationWizard.ABS_FLOOR) return false;
    }
    return true;
  }

  private seedTravel(axes: readonly number[]): void {
    for (let i = 0; i < axes.length; i++) {
      const v = axes[i];
      if (v === undefined || !Number.isFinite(v)) continue;
      this.tMin[i] = v;
      this.tMax[i] = v;
      this.tSteps[i] = 0;
      this.prevAxes[i] = v;
    }
  }

  private spanOf(index: number): number {
    const lo = this.tMin[index];
    const hi = this.tMax[index];
    if (lo === undefined || hi === undefined || !Number.isFinite(lo) || !Number.isFinite(hi)) return 0;
    return hi - lo;
  }

  private grow(index: number, raw: number): void {
    if (!Number.isFinite(raw)) return;
    const lo = this.tMin[index];
    const hi = this.tMax[index];
    if (lo === undefined || hi === undefined || !Number.isFinite(lo) || !Number.isFinite(hi)) {
      this.tMin[index] = raw;
      this.tMax[index] = raw;
      return;
    }
    if (raw < lo) this.tMin[index] = raw;
    if (raw > hi) this.tMax[index] = raw;
  }

  private enough(axisCount: number): boolean {
    if (axisCount <= 0) return false;
    const need = Math.min(4, axisCount);
    let got = 0;
    for (let i = 0; i < axisCount; i++) {
      if (this.spanOf(i) >= CalibrationWizard.ENOUGH_SPAN) got += 1;
    }
    return got >= need;
  }

  private ownerOf(index: number): StickFn | null {
    for (const fn of STICKS) {
      if (this.assignedAxes[fn] === index) return fn;
    }
    return null;
  }

  private axisAllowed(index: number): boolean {
    if (!this.focus || this.focus.kind === 'button') return true;
    return this.focus.index === index;
  }

  /** 點了軸之後按鈕仍全部聽；點了按鈕才把按鈕收斂到那一顆。 */
  private buttonAllowed(index: number): boolean {
    if (!this.focus || this.focus.kind === 'axis') return true;
    return this.focus.index === index;
  }

  private detect(axes: readonly number[], buttons: readonly boolean[]): void {
    const step = this.step();
    if (!step) return;
    const axisHits: Notice[] = [];
    const ratios: number[] = [];
    let occupied: string | null = null;

    for (let i = 0; i < axes.length; i++) {
      const raw = axes[i];
      if (raw === undefined || !Number.isFinite(raw)) continue;
      const base = this.baseAxes[i];
      if (base === undefined) {
        this.baseAxes[i] = raw;
        this.prevAxes[i] = raw;
        this.grow(i, raw);
        continue;
      }
      const delta = raw - base;
      const prev = this.prevAxes[i];
      if (prev !== undefined && Math.abs(raw - prev) >= 0.04) {
        this.tSteps[i] = (this.tSteps[i] ?? 0) + 1;
      }
      this.prevAxes[i] = raw;
      const span = this.spanOf(i);
      const threshold = CalibrationWizard.changeThreshold(span);
      this.grow(i, raw);
      if (Math.abs(delta) < threshold) continue;
      const owner = this.ownerOf(i);
      const picked = this.focus?.kind === 'axis' && this.focus.index === i;
      if (owner && !picked) {
        const labels = CalibrationWizard.axisLabels(i);
        occupied = `${labels.device}（${labels.radio}）剛才有動，但它已經是${STICK_NAME[owner]}，這一步先不採用。可以改推別的，或手動點它來改設定。`;
        continue;
      }
      if (!this.axisAllowed(i)) continue;
      axisHits.push({ kind: 'axis', index: i, raw, delta, peak: delta, pressed: false });
      ratios.push(Math.abs(delta) / threshold);
    }

    const buttonHits: Notice[] = [];
    for (let i = 0; i < buttons.length; i++) {
      const pressed = !!buttons[i];
      const base = this.baseButtons[i] ?? false;
      if (pressed === base || !this.buttonAllowed(i)) continue;
      buttonHits.push({
        kind: 'button',
        index: i,
        raw: pressed ? 1 : 0,
        delta: pressed ? 1 : -1,
        peak: pressed ? 1 : -1,
        pressed,
      });
    }

    this.occupiedHint = occupied;
    let primary: Notice | null = null;
    let secondary: Notice | null = null;
    const bestAxis = this.bestAxis(axisHits, ratios);
    const bestButton = buttonHits[0] ?? null;
    const preferButton = step.kind === 'button';
    if (preferButton) {
      if (bestButton) primary = bestButton;
      else if (bestAxis) primary = bestAxis;
      if (bestButton && bestAxis) secondary = bestAxis;
    } else {
      if (bestAxis) primary = bestAxis;
      else if (bestButton) primary = bestButton;
      if (bestAxis && bestButton) secondary = bestButton;
    }

    if (primary) {
      this.seen = primary;
      this.also = secondary;
      this.mismatchHint = null;
      if (primary.kind === 'axis' && (this.tSteps[primary.index] ?? 0) >= 3) {
        const labels = CalibrationWizard.axisLabels(primary.index);
        this.motionHint = `${labels.device} 是慢慢移動的，仍然可以按「就用這個」。慢速移動只是提醒，不會把這根軸排除。`;
      }
      if (axisHits.length >= 2) {
        const other = axisHits.find((hit) => hit.index !== primary.index) ?? axisHits[1];
        if (other) {
          const labels = CalibrationWizard.axisLabels(other.index);
          this.extraHint = `也有另一根在動（${labels.device}）。不會排除任何一根，可以手動點選。`;
        }
      }
    }
  }

  private bestAxis(hits: Notice[], ratios: number[]): Notice | null {
    let best = -1;
    let score = -1;
    for (let i = 0; i < hits.length; i++) {
      const ratio = ratios[i];
      if (ratio !== undefined && ratio > score) {
        score = ratio;
        best = i;
      }
    }
    return best >= 0 ? (hits[best] ?? null) : null;
  }

  private refreshSeen(axes: readonly number[], buttons: readonly boolean[]): void {
    if (!this.seen) return;
    if (this.seen.kind === 'axis' && this.seen.index < axes.length) {
      const raw = axes[this.seen.index];
      if (raw === undefined || !Number.isFinite(raw)) return;
      const base = this.baseAxes[this.seen.index] ?? raw;
      const delta = raw - base;
      const peak = Math.abs(delta) >= Math.abs(this.seen.peak) ? delta : this.seen.peak;
      this.seen = { ...this.seen, raw, delta, peak };
    } else if (this.seen.kind === 'button' && this.seen.index < buttons.length) {
      const pressed = buttons[this.seen.index];
      if (pressed === undefined) return;
      const base = this.baseButtons[this.seen.index] ?? false;
      this.seen = {
        ...this.seen,
        raw: pressed ? 1 : 0,
        delta: pressed === base ? 0 : pressed ? 1 : -1,
        pressed,
      };
    }
  }

  private refreshIdle(): void {
    const step = this.step();
    if (this.isDone() || !step || step.kind === 'letGo' || this.seen) {
      this.idleHint = null;
      return;
    }
    if (this.now - this.idleFrom < CalibrationWizard.HINT_MS) {
      this.idleHint = null;
      return;
    }
    const occupied = STICKS.flatMap((fn) => {
      const index = this.assignedAxes[fn];
      return index === undefined ? [] : [`${STICK_NAME[fn]}（${CalibrationWizard.axisLabels(index).device}）`];
    });
    this.idleHint = CalibrationWizard.buildIdleHint(this.lastAxes.length, this.lastButtons.length, occupied);
  }

  private deltaRef(index: number, raw: number): number {
    const base = this.baseAxes[index];
    if (this.listening && base !== undefined) return base;
    const rest = this.rest[index];
    if (rest !== undefined && Number.isFinite(rest)) return rest;
    return raw;
  }

  private noticeText(notice: Notice): string {
    if (notice.kind === 'axis') return CalibrationWizard.formatAxisSeen(notice.index, notice.raw, notice.delta);
    return CalibrationWizard.formatButtonSeen(notice.index, notice.pressed, notice.delta);
  }

  private assignAxis(fn: StickFn, index: number, delta: number): void {
    for (const other of STICKS) {
      if (other !== fn && this.assignedAxes[other] === index) delete this.assignedAxes[other];
    }
    this.assignedAxes[fn] = index;
    if (Math.abs(delta) >= CalibrationWizard.ABS_FLOOR) {
      this.invert[fn] = CalibrationWizard.invertFor(fn, delta);
    }
  }

  private assignButton(fn: ButtonFn, index: number): void {
    for (const other of BUTTONS) {
      if (other !== fn && this.assignedButtons[other] === index) delete this.assignedButtons[other];
    }
    this.assignedButtons[fn] = index;
  }
}

// =============================================================================
// 與畫面、localStorage 的接線（狀態機本身不碰 DOM）
// =============================================================================

let wizard: CalibrationWizard | null = null;
let readPad: () => PadSnapshot = () => ({ connected: false, axes: [], buttons: [] });
let calibTimer: ReturnType<typeof setInterval> | null = null;

export const calibration = {
  active: false,
  stepIdx: 0,
};

function syncFlag(): void {
  calibration.active = !!wizard?.isActive;
  calibration.stepIdx = wizard?.stepIndex ?? 0;
}

function publish(): void {
  if (!wizard) return;
  syncFlag();
  bus.emit('calib-view', wizard.view(gamepadConfig));
}

function pump(): void {
  if (!wizard?.isActive) return;
  wizard.sample(readPad(), Date.now());
  publish();
}

export function initCalibration(padReader: () => PadSnapshot): void {
  readPad = padReader;
  loadGamepadConfig();
}

export function startCalibration(): void {
  const pad = readPad();
  if (!pad.connected) {
    toast('請先插上搖桿', 'error');
    return;
  }
  wizard = new CalibrationWizard();
  wizard.start(Date.now());
  syncFlag();
  bus.emit('calib-show', { show: true });
  pump();
  if (calibTimer) clearInterval(calibTimer);
  calibTimer = setInterval(pump, 100);
}

export function endCalibration(save: boolean): void {
  const was = !!wizard?.isActive;
  if (save && wizard) {
    writeConfig(wizard.toConfig(gamepadConfig));
    saveGamepadConfig();
    toast('✓ 校正完成 — 軸與按鍵已套用', 'success');
    console.log('[校正結果]', {
      axes: gamepadConfig.axes,
      center: gamepadConfig.center,
      range: gamepadConfig.range,
      buttons: gamepadConfig.buttonMap,
      arm: gamepadConfig.arm ?? null,
    });
  } else if (was) {
    toast('校正取消');
  }
  wizard?.stop();
  if (calibTimer) {
    clearInterval(calibTimer);
    calibTimer = null;
  }
  syncFlag();
  bus.emit('calib-ended', { saved: save });
  bus.emit('calib-show', { show: false });
}

function mutate(fn: (w: CalibrationWizard, now: number) => void): void {
  if (!wizard?.isActive) return;
  fn(wizard, Date.now());
  publish();
}

export function skipCalibStep(): void {
  mutate((w, now) => w.skip(now));
}

export function confirmCalibration(): void {
  mutate((w, now) => {
    w.confirm(now);
  });
}

export function acceptCalibPartial(): void {
  mutate((w, now) => w.acceptPartial(now));
}

export function confirmCalibHandsOff(): void {
  mutate((w, now) => w.confirmHandsOff(now));
}

export function pickCalibAxis(index: number): void {
  mutate((w, now) => w.pickAxis(index, now));
}

export function pickCalibButton(index: number): void {
  mutate((w, now) => w.pickButton(index, now));
}

export function listenAllCalib(): void {
  mutate((w, now) => w.listenAll(now));
}

/** 每個物理 tick 由 input/index.ts 呼叫 */
export function tickCalibration(): void {
  pump();
}
