// ⚽ 球館外殼與飛行鏡頭：牆／天花要擋住戶外天空，但不能擋飛行視線。
//
// 第三人稱跟隨機位在機尾約 2.6m。練習起飛貼底線，這個距離會把鏡頭放到端牆外殼的外側，
// 實心擋板就鋪滿整個畫面。對戰飛近邊界、或飛高讓鏡頭穿進天花，也是同一件事。
// 規則：鏡頭在某一面的場內側才畫那一面；貼進板厚或已經到外側就不畫，視線穿過去看到場地。
// 純函式，不碰 Babylon，方便測試鎖住「起步不要被牆擋住」。

/** 外殼擋板厚度（m）。中心在邊界往外偏 SOCCER_SHELL_OUTSET。 */
export const SOCCER_SHELL_THICKNESS = 0.02;
/** 外殼中心離場地邊界往外的距離（m） */
export const SOCCER_SHELL_OUTSET = 0.08;
/** 天花板板厚（m） */
export const SOCCER_CEIL_THICKNESS = 0.08;
/** 天花板中心在場地高度往下的距離（m） */
export const SOCCER_CEIL_DROP = 0.02;

/** 鏡頭離內側面少於這個距離就當成會埋進板裡，這面不畫（近裁面 0.1m） */
export const ENCLOSURE_FACE_MARGIN = 0.15;
/** 鏡頭至少留在天花板內側這麼遠，才不會埋進板厚（全場視角用；跟隨視角可飛到天花外側） */
export const SOCCER_CAM_CEIL_CLEARANCE = 0.4;
/** 鏡頭不要穿進草地 */
export const SOCCER_CAM_MIN_Y = 0.35;
/** 第一人稱收到場地邊界內側，避免機頭埋進牆 */
export const SOCCER_FPV_INSET = 0.3;

/** 足球第三人稱跟隨：機尾距離與抬高（護罩很小，退後才看得到槳） */
export const SOCCER_FOLLOW_DISTANCE = 2.6;
export const SOCCER_FOLLOW_HEIGHT = 0.9;
/** 全場視角從端線往場內收（m），站在端牆內側 */
export const SOCCER_TEAM_END_INSET = 0.75;

/** 外殼朝場內那一面的座標（+ 端為正值） */
export function shellInner(half: number): number {
  return half + SOCCER_SHELL_OUTSET - SOCCER_SHELL_THICKNESS / 2;
}

/** 天花板朝場內（朝下）那一面的高度 */
export function ceilInner(top: number): number {
  return top - SOCCER_CEIL_DROP - SOCCER_CEIL_THICKNESS / 2;
}

/**
 * 這一面要不要畫。
 * sign +1：面在 + 端，場內是較小的座標。sign -1 相反。
 * 鏡頭在場內側（含一點餘裕）才畫，用來擋住天空；在外側或貼進板裡就不畫。
 */
export function enclosureFaceVisible(
  cam: number,
  sign: 1 | -1,
  inner: number,
  margin: number = ENCLOSURE_FACE_MARGIN,
): boolean {
  if (sign > 0) return cam < inner - margin;
  return cam > inner + margin;
}

/** 全場視角收到天花板內側，避免鏡頭埋進藍灰天花 */
export function clampSoccerCameraY(y: number, top: number): number {
  const maxY = ceilInner(top) - SOCCER_CAM_CEIL_CLEARANCE;
  return Math.min(Math.max(y, SOCCER_CAM_MIN_Y), maxY);
}

/** 第一人稱的水平位置收到場內，避免機頭埋進端牆；高度可略高於天花，天花那時不畫 */
export function clampSoccerFpv(
  x: number,
  y: number,
  z: number,
  field: { halfX: number; halfZ: number; top: number },
): { x: number; y: number; z: number } {
  const inset = SOCCER_FPV_INSET;
  return {
    x: Math.min(Math.max(x, -field.halfX + inset), field.halfX - inset),
    z: Math.min(Math.max(z, -field.halfZ + inset), field.halfZ - inset),
    y: Math.min(Math.max(y, SOCCER_CAM_MIN_Y), field.top + 0.9),
  };
}
