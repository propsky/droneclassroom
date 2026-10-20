// 考證視角與足球全場視角的鏡位。
//
// 考證視角對齊兩件事：
// 1. FAI F9A B.2.3：操作員區在防護籠短邊外側，兩隊位置與大小相同。
//    正文沒有給操作員區離籠多遠，圖上也沒有可擷取的公尺數。
// 2. 交通部民用航空局 AC 107-005：應考人站在 P 點，航機在站位正前方
//    （多旋翼科目寫「機頭朝外」），附錄 7 要求 P 點前方有防護網。
//    規範沒有寫眼高，也沒有寫 P 點到標線的固定公尺。
//
// 眼高 1.65 m、最少退距 1.5 m、取景用 4:3，都是這裡的選擇，用來把整塊飛行區放進 60° 視角。
// 足球全場視角改站到近端門的側邊：舊鏡位在端線中線、門框正後方，視線會穿過近端門管。
import type { LevelDef } from '@creafly/shared';
import { balloonDiameter, ringBobAmp, ringDiameter, ringThickness } from '@creafly/shared';
import { forwardVec, HOME_POSITION } from '../core/droneState';
import { ARENA_BOUND, ARENA_OBSTACLE_DEFS, ARENA_OBSTACLE_HALF } from '../multiplayer/arena';
import {
  clampSoccerCameraY,
  clampSoccerFpv,
  shellInner,
  SOCCER_CAM_MIN_Y,
  SOCCER_FOLLOW_DISTANCE,
  SOCCER_FOLLOW_HEIGHT,
  SOCCER_TEAM_END_INSET,
} from '../soccer/enclosureView';
import { soccerScoreboardPoses, type ScoreboardField } from '../soccer/scoreboardPose';
import type { ActiveSoccerField } from '../soccer/field';
import {
  CameraSight,
  type SightPoint,
  type SightSolid,
} from './cameraSight';

export type CameraViewMode = 'follow' | 'team' | 'exam' | 'fpv';

export type PilotEnd = 1 | -1;

export interface CameraPose {
  eye: SightPoint;
  target: SightPoint;
}

export interface FlightBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

interface PosePick {
  pose: CameraPose;
  blocked: string[];
}

export class PilotView {
  private static readonly poseCache = new Map<string, CameraPose>();

  /** 站立眼高（公尺）。規則沒寫，取 1.60–1.70 的中間。 */
  static readonly EYE_HEIGHT_M = 1.65;
  /** 與 CameraRig 相同的垂直視角。 */
  static readonly VERTICAL_FOV_RAD = (60 * Math.PI) / 180;
  /**
   * 取景長寬比。4:3 比桌面 16:9 窄，橫放的教室平板也裝得下整場。
   * 這是選擇，不是法規數字。
   */
  static readonly FRAME_ASPECT = 4 / 3;
  /** 取樣點離畫面邊緣的比例，避免貼著裁切線。 */
  static readonly FRAME_MARGIN = 0.06;
  /**
   * 人站在飛行區／籠外的最少距離（公尺）。
   * FAI 只規定在籠外；民航局只規定在 P 點、前方有防護網。公尺數是選擇。
   */
  static readonly MIN_STAND_OFF_M = 1.5;

  static label(mode: CameraViewMode, soccer: boolean): string {
    if (mode === 'fpv') return '👁 第一視角(FPV)';
    if (mode === 'exam') return '📋 考證視角';
    if (mode === 'team') return '🏟 全場視角';
    return soccer ? '🎥 跟隨視角' : '🎥 第三人稱';
  }

  static thirdPerson(pos: SightPoint, yaw: number): CameraPose {
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    return {
      eye: { x: pos.x + 12 * sin, y: pos.y + 4, z: pos.z + 12 * cos },
      target: { x: pos.x, y: pos.y, z: pos.z },
    };
  }

  static soccerFollow(pos: SightPoint, yaw: number): CameraPose {
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    return {
      eye: {
        x: pos.x + SOCCER_FOLLOW_DISTANCE * sin,
        y: Math.max(SOCCER_CAM_MIN_Y, pos.y + SOCCER_FOLLOW_HEIGHT),
        z: pos.z + SOCCER_FOLLOW_DISTANCE * cos,
      },
      target: { x: pos.x, y: pos.y + 0.02, z: pos.z },
    };
  }

  static fpv(pos: SightPoint, yaw: number, soccerField: ActiveSoccerField | null): CameraPose {
    const f = forwardVec(yaw);
    let eye = { x: pos.x + f.x * 0.35, y: pos.y + 0.45, z: pos.z + f.z * 0.35 };
    if (soccerField) {
      const c = clampSoccerFpv(eye.x, eye.y, eye.z, soccerField);
      eye = { x: c.x, y: c.y, z: c.z };
    }
    return {
      eye,
      target: { x: eye.x + f.x * 10, y: eye.y - 1.2, z: eye.z + f.z * 10 },
    };
  }

  /**
   * 舊的全場鏡位：端線中線、門的正後方。
   * 練習場近端是藍門，這組鏡位會被藍門管擋住。保留用來鎖住回歸測試。
   */
  static legacySoccerTeam(field: ActiveSoccerField, sign: PilotEnd): CameraPose {
    const dist = field.halfZ - SOCCER_TEAM_END_INSET;
    const camY = clampSoccerCameraY(Math.min(field.top - 0.95, 4.05), field.top);
    return {
      eye: { x: 0, y: camY, z: sign * dist },
      target: { x: 0, y: 1.7, z: -sign * field.halfZ * 0.45 },
    };
  }

  /** 全場視角：仍站在己方端牆內側，但偏到門框外側，視線不再穿過近端門。 */
  static soccerTeam(field: ActiveSoccerField, sign: PilotEnd): CameraPose {
    return PilotView.cached(`team:${PilotView.fieldKey(field)}:${sign}`, () =>
      PilotView.pickSoccerTeam(field, sign).pose,
    );
  }

  /** 考證視角：眼高固定，站在飛行區這一側的外側，整塊區域進畫面且不被幾何擋住。 */
  static examOutside(
    box: FlightBox,
    side: 'posZ' | 'negZ',
    solidsFor: (eye: SightPoint) => readonly SightSolid[],
    maxLateral?: number,
    points?: readonly SightPoint[],
  ): CameraPose {
    return PilotView.pickExam(box, side, solidsFor, maxLateral, points).pose;
  }

  static courseExam(level: LevelDef | null): CameraPose {
    const box = PilotView.courseBox(level);
    const key = [
      'course',
      level?.id ?? 'none',
      box.minX, box.maxX, box.minY, box.maxY, box.minZ, box.maxZ,
      level?.obstacles?.length ?? 0,
      level?.rings?.length ?? 0,
      level?.balloons?.length ?? 0,
    ].join(':');
    return PilotView.cached(key, () => {
      const solids = PilotView.courseSolids(level);
      return PilotView.examOutside(box, 'posZ', () => solids);
    });
  }

  static soccerExam(field: ActiveSoccerField, sign: PilotEnd): CameraPose {
    return PilotView.cached(`sexam:${PilotView.fieldKey(field)}:${sign}`, () => {
      const side = sign > 0 ? 'posZ' : 'negZ';
      return PilotView.examOutside(
        PilotView.soccerBox(field),
        side,
        (eye) => PilotView.soccerSolids(field, eye),
        Math.max(0.4, field.halfX - 0.28),
        PilotView.soccerWatchPoints(field, sign),
      );
    });
  }

  /** 場地取樣，再加上對方門心。自己的門在前景，斜看時門管會擋門心，不拿來當必須穿透的點。 */
  static soccerWatchPoints(field: ActiveSoccerField, sign: PilotEnd): SightPoint[] {
    const points = PilotView.keyPoints(PilotView.soccerBox(field));
    points.push({ x: 0, y: field.goalY, z: -sign * field.goalZ });
    return points;
  }

  static arenaExam(): CameraPose {
    return PilotView.cached('arena', () => {
      const solids = PilotView.arenaSolids();
      return PilotView.examOutside(PilotView.arenaBox(), 'posZ', () => solids);
    });
  }

  static courseBox(level: LevelDef | null): FlightBox {
    const box = PilotView.emptyBox();
    PilotView.include(box, 0, HOME_POSITION.y, 0);
    if (level) {
      for (const ring of level.rings ?? []) PilotView.include(box, ring.x, ring.y, ring.z);
      for (const obs of level.obstacles ?? []) {
        const h = obs.size / 2;
        PilotView.include(box, obs.x, obs.y, obs.z, h);
      }
      for (const balloon of level.balloons ?? []) {
        PilotView.include(box, balloon.x, balloon.y, balloon.z, balloonDiameter(balloon) / 2);
      }
      for (const zone of level.passZones ?? []) PilotView.include(box, zone.x, 1.5, zone.z);
      for (const [x, z] of level.guide ?? []) PilotView.include(box, x, level.drawHeight ?? 3, z);
      if (level.draw) PilotView.include(box, 0, level.drawHeight ?? 3, 0);
    }
    return PilotView.padBox(box, 2, 6, 5);
  }

  static soccerBox(field: ActiveSoccerField): FlightBox {
    return {
      minX: -field.halfX,
      maxX: field.halfX,
      minY: 0,
      maxY: field.top,
      minZ: -field.halfZ,
      maxZ: field.halfZ,
    };
  }

  static arenaBox(): FlightBox {
    return {
      minX: -ARENA_BOUND.x,
      maxX: ARENA_BOUND.x,
      minY: 0,
      maxY: ARENA_BOUND.yTop,
      minZ: -ARENA_BOUND.z,
      maxZ: ARENA_BOUND.z,
    };
  }

  /**
   * 飛行區要看得到的點：八個角、中心、以及呼叫端另加的門心。
   * 不在中線上密鋪，避免任務圈自己的管壁把正後方的格子判成擋住。
   */
  static keyPoints(box: FlightBox): SightPoint[] {
    const inset = 0.55;
    const ys = PilotView.span(Math.max(box.minY + 0.55, 0.7), Math.max(box.minY + 1, box.maxY - 0.55));
    const xs = [box.minX + inset, box.maxX - inset];
    const zs = [box.minZ + inset, box.maxZ - inset];
    const points: SightPoint[] = [PilotView.boxCenter(box)];
    for (const x of xs) {
      for (const y of ys) {
        for (const z of zs) points.push({ x, y, z });
      }
    }
    return points;
  }

  /**
   * 第三人稱焦點被氣球或障礙擋住時，沿 x 挪開，仍看著飛機。
   * 檢查時把球和方塊加粗，機身才不會只剩中心線擦過、畫面上看起來仍被擋住。
   */
  static dodgeFocus(pose: CameraPose, solids: readonly SightSolid[]): CameraPose {
    // 先找射線完全沒撞到的側移，而且跟球體表面至少留 1.6 m，近處的氣球才不會鋪滿機身。
    for (const shift of [0, 3, -3, 5, -5, 7, -7, 9, -9]) {
      const eye = { x: pose.eye.x + shift, y: pose.eye.y, z: pose.eye.z };
      if (!CameraSight.clear(eye, pose.target, solids)) continue;
      if (PilotView.sphereTooClose(eye, pose.target, solids, 1.6)) continue;
      return { eye, target: pose.target };
    }
    return PilotView.shiftUntilClear(pose, solids) ?? pose;
  }

  /** 線段到球心的距離小於半徑 + 餘裕，畫面上看起來仍會擋到機身。 */
  private static sphereTooClose(
    eye: SightPoint,
    target: SightPoint,
    solids: readonly SightSolid[],
    margin: number,
  ): boolean {
    const ab = CameraSight.sub(target, eye);
    const ab2 = CameraSight.dot(ab, ab);
    if (ab2 < 1e-8) return false;
    for (const solid of solids) {
      if (solid.kind !== 'sphere') continue;
      const ap = CameraSight.sub(solid.center, eye);
      const t = Math.min(1, Math.max(0, CameraSight.dot(ap, ab) / ab2));
      const closest = CameraSight.add(eye, CameraSight.scale(ab, t));
      const dist = CameraSight.len(CameraSight.sub(solid.center, closest));
      if (dist < solid.radius + margin) return true;
    }
    return false;
  }

  private static shiftUntilClear(
    pose: CameraPose,
    solids: readonly SightSolid[],
  ): CameraPose | null {
    if (CameraSight.clear(pose.eye, pose.target, solids)) return pose;
    for (const shift of [2.4, -2.4, 4, -4, 6, -6, 8, -8]) {
      const eye = { x: pose.eye.x + shift, y: pose.eye.y, z: pose.eye.z };
      if (CameraSight.clear(eye, pose.target, solids)) return { eye, target: pose.target };
    }
    return null;
  }

  static courseSolids(level: LevelDef | null): SightSolid[] {
    if (!level) return [];
    const solids: SightSolid[] = [];
    (level.obstacles ?? []).forEach((obs, i) => {
      const h = obs.size / 2;
      solids.push({
        kind: 'aabb',
        name: `障礙${i}`,
        min: { x: obs.x - h, y: obs.y - h, z: obs.z - h },
        max: { x: obs.x + h, y: obs.y + h, z: obs.z + h },
      });
    });
    (level.rings ?? []).forEach((ring, i) => {
      const major = ringDiameter(ring) / 2;
      const tube = ringThickness(ring) / 2;
      const bob = ringBobAmp(ring);
      for (const dy of bob > 0 ? [-bob, 0, bob] : [0]) {
        solids.push({
          kind: 'torus',
          name: `圈${i}`,
          center: { x: ring.x, y: ring.y + dy, z: ring.z },
          axis: 'z',
          major,
          tube,
        });
      }
    });
    (level.balloons ?? []).forEach((balloon, i) => {
      const radius = balloonDiameter(balloon) / 2;
      solids.push({
        kind: 'sphere',
        name: `氣球${i}`,
        center: { x: balloon.x, y: balloon.y, z: balloon.z },
        radius,
      });
    });
    return solids;
  }

  /**
   * 足球會擋住視線的東西：兩端門管、計分板、吊帶。
   * 鏡頭在某一面外側時，那面外殼不畫（與 enclosureFaceVisible 相同），不算擋住。
   */
  static soccerSolids(field: ActiveSoccerField, eye: SightPoint): SightSolid[] {
    const solids: SightSolid[] = [];
    const scoreField: ScoreboardField = {
      halfX: field.halfX,
      halfZ: field.halfZ,
      top: field.top,
      goalZ: field.goalZ,
      goalY: field.goalY,
      goalR: field.goalR,
      goalTube: field.goalTube,
    };
    for (const gz of [field.goalZ, -field.goalZ]) {
      const which = gz > 0 ? '近' : '遠';
      solids.push({
        kind: 'torus',
        name: `門框z=${gz > 0 ? '+' : ''}${gz}`,
        center: { x: 0, y: field.goalY, z: gz },
        axis: 'z',
        major: field.goalR + field.goalTube,
        tube: field.goalTube,
      });
      const ringTop = field.goalY + field.goalR + field.goalTube * 2;
      const drop = Math.max(0.2, field.top - 0.05 - ringTop);
      for (const x of [-0.28, 0.28]) {
        solids.push({
          kind: 'cylinder',
          name: `${which}端吊帶`,
          center: { x, y: ringTop + drop / 2, z: gz },
          axis: 'y',
          radius: 0.02,
          halfHeight: drop / 2,
        });
      }
      solids.push({
        kind: 'aabb',
        name: `${which}端吊桿`,
        min: { x: -0.35, y: field.top - 0.08, z: gz - 0.04 },
        max: { x: 0.35, y: field.top - 0.04, z: gz + 0.04 },
      });
    }
    for (const pose of soccerScoreboardPoses(scoreField)) {
      solids.push({
        kind: 'aabb',
        name: pose.z > 0 ? '近端計分板' : '遠端計分板',
        min: {
          x: pose.x - pose.width / 2,
          y: pose.y - pose.height / 2,
          z: pose.z - pose.depth / 2,
        },
        max: {
          x: pose.x + pose.width / 2,
          y: pose.y + pose.height / 2,
          z: pose.z + pose.depth / 2,
        },
      });
    }
    PilotView.pushShell(solids, field, eye);
    return solids;
  }

  static arenaSolids(): SightSolid[] {
    return ARENA_OBSTACLE_DEFS.map(([x, y, z], i) => ({
      kind: 'aabb' as const,
      name: `掩體${i}`,
      min: { x: x - ARENA_OBSTACLE_HALF, y: y - ARENA_OBSTACLE_HALF, z: z - ARENA_OBSTACLE_HALF },
      max: { x: x + ARENA_OBSTACLE_HALF, y: y + ARENA_OBSTACLE_HALF, z: z + ARENA_OBSTACLE_HALF },
    }));
  }

  /**
   * 這組鏡位看向目標時，取樣點有哪些被擋住。
   * 點落在固體內、或貼在鏡頭旁（深度不到 1.2 m，人就站在那一端）就略過。
   */
  static blockedSamples(
    pose: CameraPose,
    points: readonly SightPoint[],
    solids: readonly SightSolid[],
  ): string[] {
    const hits: string[] = [];
    for (const point of points) {
      if (solids.some((solid) => CameraSight.contains(solid, point))) continue;
      if (PilotView.depth(pose, point) < 1.2) continue;
      if (!PilotView.inFrame(pose, point)) {
        hits.push('出框');
        continue;
      }
      const name = CameraSight.blocker(pose.eye, point, solids);
      if (name) hits.push(name);
    }
    return hits;
  }

  static depth(pose: CameraPose, point: SightPoint): number {
    const forward = CameraSight.sub(pose.target, pose.eye);
    const fl = CameraSight.len(forward);
    if (fl < 1e-6) return 0;
    return CameraSight.dot(CameraSight.sub(point, pose.eye), CameraSight.scale(forward, 1 / fl));
  }

  static inFrame(pose: CameraPose, point: SightPoint): boolean {
    const forward = CameraSight.sub(pose.target, pose.eye);
    const fl = CameraSight.len(forward);
    if (fl < 1e-6) return false;
    const f = CameraSight.scale(forward, 1 / fl);
    const up = { x: 0, y: 1, z: 0 };
    let right = {
      x: f.y * up.z - f.z * up.y,
      y: f.z * up.x - f.x * up.z,
      z: f.x * up.y - f.y * up.x,
    };
    const rl = CameraSight.len(right);
    if (rl < 1e-6) return false;
    right = CameraSight.scale(right, 1 / rl);
    const camUp = {
      x: right.y * f.z - right.z * f.y,
      y: right.z * f.x - right.x * f.z,
      z: right.x * f.y - right.y * f.x,
    };
    const rel = CameraSight.sub(point, pose.eye);
    const depth = CameraSight.dot(rel, f);
    if (depth < 0.15) return false;
    const tanHalf = Math.tan(PilotView.VERTICAL_FOV_RAD / 2) * (1 - PilotView.FRAME_MARGIN);
    const vy = Math.abs(CameraSight.dot(rel, camUp)) / depth;
    const vx = Math.abs(CameraSight.dot(rel, right)) / depth;
    return vy <= tanHalf && vx <= tanHalf * PilotView.FRAME_ASPECT;
  }

  private static pickSoccerTeam(field: ActiveSoccerField, sign: PilotEnd): PosePick {
    const box = PilotView.soccerBox(field);
    const points = PilotView.keyPoints(box);
    points.push({ x: 0, y: field.goalY, z: field.goalZ }, { x: 0, y: field.goalY, z: -field.goalZ });
    const z = sign * (field.halfZ - SOCCER_TEAM_END_INSET);
    const yMax = clampSoccerCameraY(field.top - 0.2, field.top);
    const yMin = Math.max(SOCCER_CAM_MIN_Y + 0.4, Math.min(2.2, yMax));
    const xMax = Math.max(0.4, field.halfX - 0.45);
    let best: PosePick | null = null;
    for (const xAbs of PilotView.steps(0, xMax, 0.35)) {
      for (const x of xAbs === 0 ? [0] : [xAbs, -xAbs]) {
        for (const y of PilotView.steps(yMin, yMax, 0.35)) {
          const pose: CameraPose = {
            eye: { x, y, z },
            target: { x: 0, y: Math.min(field.top * 0.34, 1.8), z: -sign * field.halfZ * 0.2 },
          };
          const solids = PilotView.soccerSolids(field, pose.eye);
          const blocked = PilotView.blockedSamples(pose, points, solids);
          const pick = { pose, blocked };
          if (blocked.length === 0) return pick;
          if (!best || blocked.length < best.blocked.length) best = pick;
        }
      }
    }
    return best ?? { pose: PilotView.legacySoccerTeam(field, sign), blocked: ['找不到鏡位'] };
  }

  private static pickExam(
    box: FlightBox,
    side: 'posZ' | 'negZ',
    solidsFor: (eye: SightPoint) => readonly SightSolid[],
    maxLateral?: number,
    points: readonly SightPoint[] = PilotView.keyPoints(box),
  ): PosePick {
    const along = side === 'posZ' ? box.maxZ : box.minZ;
    const dir = side === 'posZ' ? 1 : -1;
    const span = Math.max(box.maxX - box.minX, 4);
    const xLimit = maxLateral ?? Math.min(18, span * 0.45);
    const depth = Math.max(box.maxZ - box.minZ, box.maxX - box.minX, 8);
    const far = Math.max(PilotView.MIN_STAND_OFF_M + 4, depth * 2.2);
    let best: PosePick | null = null;
    for (const back of PilotView.steps(PilotView.MIN_STAND_OFF_M, far, Math.max(0.8, far / 14))) {
      for (const xAbs of PilotView.steps(0, xLimit, Math.max(0.8, xLimit / 8))) {
        for (const x of xAbs === 0 ? [0] : [xAbs, -xAbs]) {
          const eyeZ = along + dir * back;
          const pose: CameraPose = {
            eye: { x, y: PilotView.EYE_HEIGHT_M, z: eyeZ },
            target: PilotView.boxCenter(box),
          };
          const blocked = PilotView.blockedSamples(pose, points, solidsFor(pose.eye));
          const pick = { pose, blocked };
          if (blocked.length === 0) return pick;
          if (!best || blocked.length < best.blocked.length) best = pick;
        }
      }
    }
    return (
      best ?? {
        pose: {
          eye: { x: 0, y: PilotView.EYE_HEIGHT_M, z: along + dir * PilotView.MIN_STAND_OFF_M },
          target: PilotView.boxCenter(box),
        },
        blocked: ['找不到鏡位'],
      }
    );
  }

  /** 外殼只在鏡頭的場內側才算擋。與 render/soccerField 的 enclosureFaceVisible 同一規則。 */
  private static pushShell(solids: SightSolid[], field: ActiveSoccerField, eye: SightPoint): void {
    const faces: Array<{ axis: 'x' | 'z'; sign: 1 | -1; at: number; name: string }> = [
      { axis: 'z', sign: 1, at: shellInner(field.halfZ), name: '端牆+Z' },
      { axis: 'z', sign: -1, at: -shellInner(field.halfZ), name: '端牆-Z' },
      { axis: 'x', sign: 1, at: shellInner(field.halfX), name: '邊牆+X' },
      { axis: 'x', sign: -1, at: -shellInner(field.halfX), name: '邊牆-X' },
    ];
    for (const face of faces) {
      const cam = face.axis === 'z' ? eye.z : eye.x;
      const visible = face.sign > 0 ? cam < face.at - 0.15 : cam > face.at + 0.15;
      if (!visible) continue;
      const t = 0.04;
      if (face.axis === 'z') {
        solids.push({
          kind: 'aabb',
          name: face.name,
          min: { x: -field.halfX - 0.2, y: 0, z: Math.min(face.at, face.at + face.sign * t) },
          max: { x: field.halfX + 0.2, y: field.top, z: Math.max(face.at, face.at + face.sign * t) },
        });
      } else {
        solids.push({
          kind: 'aabb',
          name: face.name,
          min: { x: Math.min(face.at, face.at + face.sign * t), y: 0, z: -field.halfZ - 0.2 },
          max: { x: Math.max(face.at, face.at + face.sign * t), y: field.top, z: field.halfZ + 0.2 },
        });
      }
    }
  }

  private static emptyBox(): FlightBox {
    return { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  }

  private static include(box: FlightBox, x: number, y: number, z: number, pad = 0): void {
    box.minX = Math.min(box.minX, x - pad);
    box.maxX = Math.max(box.maxX, x + pad);
    box.minY = Math.min(box.minY, y - pad);
    box.maxY = Math.max(box.maxY, y + pad);
    box.minZ = Math.min(box.minZ, z - pad);
    box.maxZ = Math.max(box.maxZ, z + pad);
  }

  private static padBox(box: FlightBox, margin: number, minHalf: number, minTop: number): FlightBox {
    const cx = (box.minX + box.maxX) / 2 || 0;
    const cz = (box.minZ + box.maxZ) / 2 || 0;
    let minX = box.minX - margin;
    let maxX = box.maxX - margin + margin * 2;
    let minZ = box.minZ - margin;
    let maxZ = box.maxZ - margin + margin * 2;
    if (maxX - minX < minHalf * 2) {
      minX = cx - minHalf;
      maxX = cx + minHalf;
    }
    if (maxZ - minZ < minHalf * 2) {
      minZ = cz - minHalf;
      maxZ = cz + minHalf;
    }
    return {
      minX,
      maxX,
      minY: 0,
      maxY: Math.max(minTop, box.maxY + margin),
      minZ,
      maxZ,
    };
  }

  private static boxCenter(box: FlightBox): SightPoint {
    return {
      x: (box.minX + box.maxX) / 2,
      y: (box.minY + box.maxY) / 2,
      z: (box.minZ + box.maxZ) / 2,
    };
  }

  private static span(a: number, b: number): number[] {
    if (!(b > a)) return [(a + b) / 2];
    const mid = (a + b) / 2;
    return [a, mid, b];
  }

  private static cached(key: string, make: () => CameraPose): CameraPose {
    const hit = PilotView.poseCache.get(key);
    if (hit) return hit;
    const pose = make();
    PilotView.poseCache.set(key, pose);
    return pose;
  }

  private static fieldKey(field: ActiveSoccerField): string {
    return [field.halfX, field.halfZ, field.top, field.goalZ, field.goalY, field.goalR, field.goalTube].join(',');
  }

  private static steps(from: number, to: number, step: number): number[] {
    const out: number[] = [];
    const n = Math.max(1, Math.ceil((to - from) / step));
    for (let i = 0; i <= n; i++) out.push(from + ((to - from) * i) / n);
    return out;
  }
}
