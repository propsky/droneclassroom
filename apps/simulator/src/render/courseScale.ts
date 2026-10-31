// 有場地底圖的關卡用真實比例：底圖照實際公尺鋪，機身也要是真實大小才看得出場地多大。
// 卡通機身（render/drone.ts，含螺旋槳約 4.6m 寬）沿用 legacy 外觀，留給官方關卡、大亂鬥、足球。
// 只改畫面：物理碰撞本來就是半徑 DRONE_RADIUS 的球，判定與重播不受影響。
import type { LevelDef } from '@creafly/shared';
import { DRONE_RADIUS } from '../core/droneState';

/** 卡通機身含螺旋槳的寬度（drone.ts：機臂 ±1.6m ＋ 槳葉 1.4m）。 */
export const DRONE_MODEL_SPAN_M = 4.6;
/** 真實比例的機身寬度＝碰撞球直徑，撞到柱子時看起來剛好碰到。 */
export const REAL_DRONE_SPAN_M = DRONE_RADIUS * 2;

/** 第三人稱鏡位（機身後方距離、高度，公尺）。 */
export interface FollowOffset {
  distance: number;
  height: number;
}

const CARTOON_FOLLOW: FollowOffset = { distance: 12, height: 4 };
/** 真實比例：機身小了，鏡頭拉近才看得清楚；往下俯約 30° 看得到前方的場地標線。 */
const REAL_FOLLOW: FollowOffset = { distance: 5, height: 3 };

export class CourseScale {
  /** 這一關是不是真實比例（有場地底圖）。 */
  static isReal(level: Pick<LevelDef, 'floorImage'> | null | undefined): boolean {
    return !!level?.floorImage;
  }

  /** 機身外觀縮放倍率。 */
  static droneScale(level: Pick<LevelDef, 'floorImage'> | null | undefined): number {
    return CourseScale.isReal(level) ? REAL_DRONE_SPAN_M / DRONE_MODEL_SPAN_M : 1;
  }

  /** 第三人稱跟隨的鏡位。 */
  static follow(level: Pick<LevelDef, 'floorImage'> | null | undefined): FollowOffset {
    return CourseScale.isReal(level) ? REAL_FOLLOW : CARTOON_FOLLOW;
  }
}
