// 計分板掛點。純函式，不碰 Babylon。
// 舊版掛在場地中央、穿環高度（soccerBoardShell），板面會變成擋在中線的直立牆。
// 現在兩端各一塊，貼端牆、底緣高於圓環外緣，穿環路線與場內跟隨鏡頭都不經過板身。

export interface ScoreboardField {
  halfX: number;
  halfZ: number;
  top: number;
  /** 球門面 |z| */
  goalZ: number;
  goalY: number;
  goalR: number;
  goalTube: number;
}

export interface ScoreboardPose {
  x: number;
  y: number;
  z: number;
  /** +1：板面法線朝 +z（場內）。-1：朝 -z。 */
  faceSign: 1 | -1;
  width: number;
  height: number;
  /** 板厚。只是邊框，不是插在場中的實心牆。 */
  depth: number;
}

/** 兩端牆上方各一塊，面朝場內。 */
export function soccerScoreboardPoses(field: ScoreboardField): [ScoreboardPose, ScoreboardPose] {
  const ringTop = field.goalY + field.goalR + field.goalTube * 2;
  const belowCeil = 0.1;
  const aboveRing = 0.16;
  const maxTop = field.top - belowCeil;
  const avail = maxTop - (ringTop + aboveRing);
  const height = Math.min(0.78, Math.max(0.22, avail));
  let y = ringTop + aboveRing + height / 2;
  if (y + height / 2 > maxTop) y = maxTop - height / 2;
  const width = height * 2;
  const depth = 0.04;
  // 圓環在門面，板子再往端牆靠，不要蓋住洞，也不要伸出球場。
  const behindRing = field.goalZ + field.goalTube + 0.3;
  let zMag = field.halfZ - 0.36;
  if (zMag < behindRing) zMag = behindRing;
  if (zMag > field.halfZ - 0.2) zMag = field.halfZ - 0.2;

  const make = (endSign: 1 | -1): ScoreboardPose => ({
    x: 0,
    y,
    z: endSign * zMag,
    faceSign: endSign === 1 ? -1 : 1,
    width,
    height,
    depth,
  });
  return [make(-1), make(1)];
}

/** 板身的盒子有沒有插進圓環開口（洞的高度 × 管的軸向厚度）。 */
export function scoreboardBlocksRingMouth(pose: ScoreboardPose, field: ScoreboardField): boolean {
  const y0 = pose.y - pose.height / 2;
  const y1 = pose.y + pose.height / 2;
  const mouthY0 = field.goalY - field.goalR;
  const mouthY1 = field.goalY + field.goalR;
  if (y1 < mouthY0 || y0 > mouthY1) return false;
  const x0 = pose.x - pose.width / 2;
  const x1 = pose.x + pose.width / 2;
  if (x1 < -field.goalR || x0 > field.goalR) return false;
  const z0 = pose.z - pose.depth / 2;
  const z1 = pose.z + pose.depth / 2;
  for (const gz of [field.goalZ, -field.goalZ]) {
    const rz0 = gz - field.goalTube;
    const rz1 = gz + field.goalTube;
    if (z1 >= rz0 && z0 <= rz1) return true;
  }
  return false;
}
