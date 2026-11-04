// 撞擊速度提示的文字與顏色（純函式，Node 測得到）。
// 門檻是給學生的大概參考，不是規格：裝了護框的小型教學機，1.5 m/s 以下多半沒事，
// 3 m/s 以上常斷槳、撞歪機臂。
import type { ImpactSurface } from '../core/impact';

export type ImpactTone = 'ok' | 'info' | 'warn' | 'bad';

export interface ImpactLabel {
  text: string;
  tone: ImpactTone;
}

export class ImpactText {
  /** 這個速度以上算「有點重」 */
  static readonly HARD_MPS = 1.5;
  /** 這個速度以上，真的無人機可能摔壞 */
  static readonly BREAK_MPS = 3;

  static of(speed: number, surface: ImpactSurface): ImpactLabel {
    const v = `${speed.toFixed(1)} m/s`;
    const what = surface === 'floor' ? '落地' : '撞擊';
    if (speed >= ImpactText.BREAK_MPS) return { text: `${what} ${v}・真機可能摔壞`, tone: 'bad' };
    if (speed >= ImpactText.HARD_MPS) return { text: `${what} ${v}・有點重`, tone: 'warn' };
    return surface === 'floor' ? { text: `${what} ${v}・平穩`, tone: 'ok' } : { text: `${what} ${v}`, tone: 'info' };
  }
}
