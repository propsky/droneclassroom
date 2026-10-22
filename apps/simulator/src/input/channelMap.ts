// 通道對應表。版面概念參考常見無線電的「一列一個功能」，
// 實作為本專案重寫，未複製 Betaflight 或 EdgeTX 的程式與圖。
// 偵測沿用校正精靈的相對基線：軸和按鈕一起聽，門檻用這根軸自己的行程。
import type { CoreEventMap } from '../core/events';
import type { AxisArm, ButtonFn, GamepadConfig, PadSnapshot, StickFn } from './calibration';
import { CalibrationWizard } from './calibration';

export type ChannelMapView = CoreEventMap['calib-map'];
export type ChannelRowId = 'throttle' | 'yaw' | 'pitch' | 'roll' | 'arm' | 'takeoff' | 'land' | 'reset';
export type ChannelDetail = 'simple' | 'pro';

const STICKS: StickFn[] = ['throttle', 'yaw', 'pitch', 'roll'];
const SWITCHES: ButtonFn[] = ['takeoff', 'land', 'reset'];
const GUIDE: ChannelRowId[] = ['throttle', 'yaw', 'pitch', 'roll', 'arm'];

const LABEL: Record<ChannelRowId, string> = {
  throttle: '油門',
  yaw: '偏航',
  pitch: '俯仰',
  roll: '橫滾',
  arm: '解鎖',
  takeoff: '起飛',
  land: '降落',
  reset: '重置',
};

interface ListenBase {
  axes: number[];
  buttons: boolean[];
}

export class ChannelPanel {
  static readonly SIMPLE_ROWS: readonly ChannelRowId[] = ['throttle', 'yaw', 'pitch', 'roll', 'arm'];
  static readonly ALL_ROWS: readonly ChannelRowId[] = [
    'throttle',
    'yaw',
    'pitch',
    'roll',
    'arm',
    'takeoff',
    'land',
    'reset',
  ];

  /** 和校正精靈同一條門檻，不另寫 0.95 或固定通道。 */
  static changeThreshold(span: number): number {
    return CalibrationWizard.changeThreshold(span);
  }

  static axisLabels(index: number): { device: string; radio: string } {
    return CalibrationWizard.axisLabels(index);
  }

  static rowGroup(id: ChannelRowId): 'stick' | 'arm' | 'switch' {
    if (id === 'arm') return 'arm';
    if (id === 'takeoff' || id === 'land' || id === 'reset') return 'switch';
    return 'stick';
  }

  /** 這一列最後能寫進 GamepadConfig 的種類。解鎖兩者皆可。 */
  static accepts(id: ChannelRowId, kind: 'axis' | 'button'): boolean {
    if (id === 'arm') return true;
    if (ChannelPanel.rowGroup(id) === 'switch') return kind === 'button';
    return kind === 'axis';
  }

  /** 條的位置：-1..1 映到 0..100。不套死區，好讓小動作也看得到。 */
  static barPercent(raw: number, center: number, range: number, reversed: boolean): number {
    if (!Number.isFinite(raw)) return 50;
    const norm = (raw - center) / (range || 1);
    const clamped = Math.max(-1, Math.min(1, norm));
    const signed = reversed ? -clamped : clamped;
    return Math.round(((signed + 1) / 2) * 100);
  }

  static sourceLabels(kind: 'axis' | 'button', index: number): { device: string; radio: string; text: string } {
    if (kind === 'button') {
      return { device: `按鈕 ${index}`, radio: '', text: `按鈕 ${index}` };
    }
    const labels = ChannelPanel.axisLabels(index);
    return { device: labels.device, radio: labels.radio, text: `${labels.device}　${labels.radio}` };
  }

  private running = false;
  private detail: ChannelDetail = 'simple';
  private listening: ChannelRowId | null = null;
  private guiding = false;
  private endpointRow: ChannelRowId | null = null;
  private base: ListenBase | null = null;
  private lastAxes: number[] = [];
  private lastButtons: boolean[] = [];
  private tMin: number[] = [];
  private tMax: number[] = [];
  private sticks: Partial<Record<StickFn, number>> = {};
  private invert: Record<StickFn, boolean> = {
    throttle: false,
    yaw: false,
    pitch: false,
    roll: false,
  };
  private switches: Partial<Record<ButtonFn, number>> = {};
  private switchReverse: Partial<Record<ButtonFn, boolean>> = {};
  private arm: AxisArm | null = null;
  private armTouched = false;
  private centers: number[] = [];
  private ranges: number[] = [];
  private deadzone = 0.1;
  private status = '點「指定」後推動搖桿或撥開關，動一下就寫入。解鎖可以清除，不必設定。';

  get isActive(): boolean {
    return this.running;
  }

  load(config: GamepadConfig): void {
    this.sticks = { ...config.axes };
    this.invert = {
      throttle: config.invertThrottle,
      yaw: config.invertYaw === true,
      pitch: config.invertPitch,
      roll: config.invertRoll === true,
    };
    this.switches = { ...config.buttonMap };
    this.switchReverse = { ...(config.buttonReverse ?? {}) };
    this.arm = config.arm ? { ...config.arm } : null;
    this.armTouched = config.arm !== undefined;
    this.centers = config.center.slice();
    this.ranges = config.range.slice();
    this.deadzone = config.deadzone;
  }

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
    this.listening = null;
    this.guiding = false;
  }

  setDetail(detail: ChannelDetail): void {
    this.detail = detail;
  }

  setDeadzone(value: number): void {
    if (!Number.isFinite(value) || value <= 0 || value >= 1) return;
    this.deadzone = value;
  }

  listen(row: ChannelRowId): void {
    if (!this.running) return;
    if (!ChannelPanel.ALL_ROWS.includes(row)) return;
    this.listening = row;
    this.endpointRow = null;
    this.captureBase();
    this.status = `正在指定${LABEL[row]}。軸和按鈕一起聽，動一下就寫入。`;
  }

  /** 一鍵套用美國手猜測。Mode 2 只決定這組預設，不參與之後的偵測。 */
  applyMode2(): void {
    this.sticks = { throttle: 1, pitch: 3, yaw: 0, roll: 2 };
    this.invert = { throttle: false, yaw: false, pitch: false, roll: false };
    this.switches = { takeoff: 0, land: 1, reset: 2 };
    this.switchReverse = {};
    this.arm = null;
    this.armTouched = true;
    this.listening = null;
    this.guiding = false;
    this.status = '已套用 Mode 2 猜測（左手油門／偏航，右手俯仰／橫滾）。編號仍是裝置軸，不是握法。';
  }

  startGuide(): void {
    if (!this.running) return;
    this.guiding = true;
    this.listen('throttle');
    this.status = '逐步指定：先推油門。軸和按鈕一起聽。';
  }

  skipCurrent(): void {
    const row = this.listening;
    if (!row) return;
    if (row === 'arm') {
      this.arm = null;
      this.armTouched = true;
    }
    if (this.guiding) this.advanceGuide(row);
    else {
      this.listening = null;
      this.base = null;
      this.status = row === 'arm' ? '解鎖已略過。鍵盤與虛擬搖桿仍用開始與起飛。' : this.idleStatus();
    }
  }

  clearArm(): void {
    this.arm = null;
    this.armTouched = true;
    if (this.listening === 'arm') this.skipCurrent();
    else this.status = '解鎖已清除。飛行不會因此要求開關。';
  }

  toggleReverse(row: ChannelRowId): void {
    if (ChannelPanel.rowGroup(row) === 'stick') {
      const fn = row as StickFn;
      this.invert[fn] = !this.invert[fn];
      return;
    }
    if (row === 'arm') {
      if (!this.arm) return;
      this.arm = { ...this.arm, invert: this.arm.invert !== true };
      this.armTouched = true;
      return;
    }
    const fn = row as ButtonFn;
    this.switchReverse[fn] = this.switchReverse[fn] !== true;
  }

  beginEndpoints(row: ChannelRowId): void {
    if (ChannelPanel.rowGroup(row) !== 'stick') return;
    const index = this.sticks[row as StickFn];
    if (index === undefined) return;
    this.ensureSlot(index);
    const raw = this.lastAxes[index];
    const center = raw !== undefined && Number.isFinite(raw) ? raw : 0;
    this.centers[index] = center;
    this.tMin[index] = center;
    this.tMax[index] = center;
    this.endpointRow = row;
    this.listening = null;
    this.status = `正在量${LABEL[row]}的兩端。推到極限後按「完成」。中心是按下時的位置。`;
  }

  finishEndpoints(): void {
    const row = this.endpointRow;
    if (!row || ChannelPanel.rowGroup(row) !== 'stick') return;
    const index = this.sticks[row as StickFn];
    if (index === undefined) return;
    const center = this.centers[index] ?? 0;
    const lo = this.tMin[index];
    const hi = this.tMax[index];
    let dev = 0.5;
    if (lo !== undefined && Number.isFinite(lo)) dev = Math.max(dev, Math.abs(lo - center));
    if (hi !== undefined && Number.isFinite(hi)) dev = Math.max(dev, Math.abs(hi - center));
    this.ranges[index] = dev;
    this.endpointRow = null;
    this.status = `${LABEL[row]}行程已記下。`;
  }

  sample(frame: PadSnapshot): void {
    if (!this.running) return;
    const axes = ChannelPanel.copyAxes(frame.axes);
    const buttons = frame.buttons.map((pressed) => !!pressed);
    this.lastAxes = axes;
    this.lastButtons = buttons;
    this.growAll(axes);
    if (this.listening && !this.base) this.captureBase();
    if (this.listening && this.base) this.detect(axes, buttons);
  }

  toConfig(base: GamepadConfig): GamepadConfig {
    const config: GamepadConfig = {
      deadzone: this.deadzone,
      invertThrottle: this.invert.throttle,
      invertPitch: this.invert.pitch,
      invertYaw: this.invert.yaw,
      invertRoll: this.invert.roll,
      axes: {
        throttle: this.sticks.throttle ?? base.axes.throttle,
        pitch: this.sticks.pitch ?? base.axes.pitch,
        yaw: this.sticks.yaw ?? base.axes.yaw,
        roll: this.sticks.roll ?? base.axes.roll,
      },
      buttonMap: {
        takeoff: this.switches.takeoff ?? base.buttonMap.takeoff,
        land: this.switches.land ?? base.buttonMap.land,
        reset: this.switches.reset ?? base.buttonMap.reset,
      },
      center: this.centers.slice(),
      range: this.ranges.slice(),
      arm: this.armTouched ? (this.arm ? { ...this.arm } : null) : base.arm ? { ...base.arm } : base.arm,
      buttonReverse: { ...this.switchReverse },
    };
    return config;
  }

  view(expo: number): ChannelMapView {
    const ids = this.detail === 'simple' ? ChannelPanel.SIMPLE_ROWS : ChannelPanel.ALL_ROWS;
    return {
      detail: this.detail,
      listening: this.listening,
      guiding: this.guiding,
      status: this.status,
      missingAxesNote: CalibrationWizard.missingAxesNote(this.lastAxes.length),
      hatNote: CalibrationWizard.HAT_NOTE,
      deadzone: this.deadzone,
      expo,
      rows: ids.map((id) => this.rowView(id)),
      rawAxes: this.lastAxes.map((raw, index) => {
        const labels = ChannelPanel.axisLabels(index);
        const base = this.base?.axes[index];
        const delta = base !== undefined && Number.isFinite(raw) ? raw - base : 0;
        return { deviceLabel: labels.device, radioLabel: labels.radio, raw, delta };
      }),
    };
  }

  private rowView(id: ChannelRowId): ChannelMapView['rows'][number] {
    const source = this.sourceOf(id);
    const labels = source
      ? ChannelPanel.sourceLabels(source.kind, source.index)
      : { device: '尚未指定', radio: '', text: '尚未指定' };
    const reversed = this.reversed(id);
    const raw = source ? this.rawOf(source) : Number.NaN;
    const center = source?.kind === 'axis' ? (this.centers[source.index] ?? 0) : 0;
    const range = source?.kind === 'axis' ? (this.ranges[source.index] ?? 1) : 1;
    const bar =
      source?.kind === 'button'
        ? raw > 0.5
          ? reversed
            ? 0
            : 100
          : reversed
            ? 100
            : 0
        : ChannelPanel.barPercent(raw, center, range || 1, reversed);
    return {
      id,
      label: LABEL[id],
      group: ChannelPanel.rowGroup(id),
      deviceLabel: labels.device,
      radioLabel: labels.radio,
      sourceText: labels.text,
      reversed,
      bar,
      rawText: Number.isFinite(raw) ? raw.toFixed(2) : '—',
      centerText: source?.kind === 'axis' ? center.toFixed(2) : '—',
      rangeText: source?.kind === 'axis' ? (range || 1).toFixed(2) : '—',
      listening: this.listening === id,
      optional: id === 'arm',
      canEndpoint: ChannelPanel.rowGroup(id) === 'stick' && source?.kind === 'axis',
      endpointOn: this.endpointRow === id,
    };
  }

  private sourceOf(id: ChannelRowId): { kind: 'axis' | 'button'; index: number } | null {
    if (ChannelPanel.rowGroup(id) === 'stick') {
      const index = this.sticks[id as StickFn];
      return index === undefined ? null : { kind: 'axis', index };
    }
    if (id === 'arm') return this.arm ? { kind: this.arm.kind, index: this.arm.index } : null;
    const index = this.switches[id as ButtonFn];
    return index === undefined ? null : { kind: 'button', index };
  }

  private reversed(id: ChannelRowId): boolean {
    if (ChannelPanel.rowGroup(id) === 'stick') return this.invert[id as StickFn];
    if (id === 'arm') return this.arm?.invert === true;
    return this.switchReverse[id as ButtonFn] === true;
  }

  private rawOf(source: { kind: 'axis' | 'button'; index: number }): number {
    if (source.kind === 'button') return this.lastButtons[source.index] ? 1 : 0;
    const raw = this.lastAxes[source.index];
    return raw !== undefined && Number.isFinite(raw) ? raw : Number.NaN;
  }

  private captureBase(): void {
    if (this.lastAxes.length === 0 && this.lastButtons.length === 0) {
      this.base = null;
      return;
    }
    this.base = { axes: this.lastAxes.slice(), buttons: this.lastButtons.slice() };
  }

  private detect(axes: readonly number[], buttons: readonly boolean[]): void {
    const row = this.listening;
    const base = this.base;
    if (!row || !base) return;
    let bestAxis: { index: number; delta: number; ratio: number } | null = null;
    for (let i = 0; i < axes.length; i++) {
      const raw = axes[i];
      if (raw === undefined || !Number.isFinite(raw)) continue;
      const origin = base.axes[i];
      if (origin === undefined) continue;
      const delta = raw - origin;
      const span = this.spanOf(i);
      const threshold = ChannelPanel.changeThreshold(span);
      if (Math.abs(delta) < threshold) continue;
      const ratio = Math.abs(delta) / threshold;
      if (!bestAxis || ratio > bestAxis.ratio) bestAxis = { index: i, delta, ratio };
    }
    let bestButton: { index: number } | null = null;
    for (let i = 0; i < buttons.length; i++) {
      const pressed = buttons[i];
      if (pressed === undefined) continue;
      const origin = base.buttons[i] ?? false;
      if (pressed !== origin && !bestButton) bestButton = { index: i };
    }
    if (!bestAxis && !bestButton) return;

    const axisOk = !!bestAxis && ChannelPanel.accepts(row, 'axis');
    const buttonOk = !!bestButton && ChannelPanel.accepts(row, 'button');
    if (axisOk && bestAxis) {
      this.assign(row, 'axis', bestAxis.index, bestAxis.delta);
      if (bestButton) this.status = `${this.status} 同時也看到按鈕 ${bestButton.index}。`;
      return;
    }
    if (buttonOk && bestButton) {
      this.assign(row, 'button', bestButton.index, bestButton.index >= 0 ? 1 : 0);
      if (bestAxis) {
        const labels = ChannelPanel.axisLabels(bestAxis.index);
        this.status = `${this.status} 同時也看到${labels.device}（${labels.radio}）。`;
      }
      return;
    }
    if (bestButton && !buttonOk) {
      this.status = `看到按鈕 ${bestButton.index}。${LABEL[row]}要的是軸，請改推搖桿。按鈕沒有被關掉。`;
    } else if (bestAxis && !axisOk) {
      const labels = ChannelPanel.axisLabels(bestAxis.index);
      this.status = `看到${labels.device}（${labels.radio}）。${LABEL[row]}要的是按鈕，請改按一顆。這根軸沒有被排除。`;
    }
  }

  private assign(row: ChannelRowId, kind: 'axis' | 'button', index: number, delta: number): void {
    if (ChannelPanel.rowGroup(row) === 'stick' && kind === 'axis') {
      const fn = row as StickFn;
      for (const other of STICKS) {
        if (other !== fn && this.sticks[other] === index) delete this.sticks[other];
      }
      this.sticks[fn] = index;
      if (Math.abs(delta) >= CalibrationWizard.ABS_FLOOR) {
        this.invert[fn] = CalibrationWizard.invertFor(fn, delta);
      }
      this.ensureSlot(index);
    } else if (row === 'arm') {
      this.arm = { kind, index, invert: false };
      this.armTouched = true;
    } else if (kind === 'button') {
      const fn = row as ButtonFn;
      for (const other of SWITCHES) {
        if (other !== fn && this.switches[other] === index) delete this.switches[other];
      }
      this.switches[fn] = index;
    }
    const labels = ChannelPanel.sourceLabels(kind, index);
    const written = `${LABEL[row]}已指定為${labels.text}。`;
    if (this.guiding) {
      this.status = written;
      this.advanceGuide(row);
      return;
    }
    this.listening = null;
    this.base = null;
    this.status = written;
  }

  private advanceGuide(row: ChannelRowId): void {
    const at = GUIDE.indexOf(row);
    const next = at >= 0 ? GUIDE[at + 1] : undefined;
    if (!next) {
      this.guiding = false;
      this.listening = null;
      this.base = null;
      this.status = `${this.status} 逐步指定結束。解鎖若沒設，飛行仍用開始與起飛。`;
      return;
    }
    this.listening = next;
    this.captureBase();
    this.status = `逐步指定：換${LABEL[next]}。軸和按鈕一起聽。`;
  }

  private ensureSlot(index: number): void {
    while (this.centers.length <= index) this.centers.push(0);
    while (this.ranges.length <= index) this.ranges.push(1);
  }

  private growAll(axes: readonly number[]): void {
    for (let i = 0; i < axes.length; i++) {
      const raw = axes[i];
      if (raw === undefined || !Number.isFinite(raw)) continue;
      const lo = this.tMin[i];
      const hi = this.tMax[i];
      if (lo === undefined || hi === undefined || !Number.isFinite(lo) || !Number.isFinite(hi)) {
        this.tMin[i] = raw;
        this.tMax[i] = raw;
      } else {
        if (raw < lo) this.tMin[i] = raw;
        if (raw > hi) this.tMax[i] = raw;
      }
    }
  }

  private spanOf(index: number): number {
    const lo = this.tMin[index];
    const hi = this.tMax[index];
    if (lo === undefined || hi === undefined || !Number.isFinite(lo) || !Number.isFinite(hi)) return 0;
    return hi - lo;
  }

  private idleStatus(): string {
    return '點「指定」後推動搖桿或撥開關，動一下就寫入。解鎖可以清除，不必設定。';
  }

  private static copyAxes(src: readonly number[]): number[] {
    const n = Math.min(src.length, CalibrationWizard.MAX_AXES);
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const value = src[i];
      out.push(typeof value === 'number' ? value : Number.NaN);
    }
    return out;
  }
}
