// 大亂鬥時間到的結算停留。純邏輯，不碰 DOM。
// 時間到才蓋結算並凍結；老師手動停止與切關不進這段。
// 老師再來一輪（countdown / running）或切關／重置（idle）就收起並解凍。
import type { ArenaEndMsg, ArenaRoundResult } from '@creafly/shared';

export type ArenaResultsStep = 'show' | 'hide' | 'keep';

export interface FreezeTarget {
  velocity: { x: number; y: number; z: number };
  returning: boolean;
}

export interface FreezeFlags {
  multiplayerLock: boolean;
}

/** 結算要不要蓋上、輸入要不要鎖。靜態方法，呼叫端自己保管停留旗標。 */
export class ArenaResults {
  /** reason 缺省視為時間到（舊訊息沒帶 reason 時的預設）。 */
  static isTimeUp(reason: ArenaEndMsg['reason'] | undefined): boolean {
    return reason === undefined || reason === 'time_up';
  }

  /**
   * 伺服器狀態進來時，結算要顯示、維持、還是收起。
   * status 離開 ended（老師再來一輪或切關）就收起。
   * 遲到者與重連看到 ended + result 則顯示。
   */
  static transition(
    holding: boolean,
    status: string,
    result: ArenaRoundResult | null | undefined,
  ): ArenaResultsStep {
    if (status === 'ended' && result) return 'show';
    if (status !== 'ended') return 'hide';
    return holding ? 'keep' : 'hide';
  }

  /** 結算停留中：鎖手動輸入，速度歸零，取消回家／降落。 */
  static freeze(drone: FreezeTarget, flags: FreezeFlags): void {
    flags.multiplayerLock = true;
    drone.returning = false;
    drone.velocity.x = 0;
    drone.velocity.y = 0;
    drone.velocity.z = 0;
  }
}
