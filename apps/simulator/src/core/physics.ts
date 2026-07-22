// 固定時步物理（60Hz tick）— 每 tick 語意與 legacy 每幀完全相同。
// 手動：velocity += 推力 → position += velocity → velocity *= DRAG。不推桿即懸停（無重力）。
import {
  droneState,
  HOME_POSITION,
  THRUST,
  MANUAL_LIFT,
  DRAG,
  DRONE_RADIUS,
  forwardVec,
  rightVec,
  copyVec3,
  lenVec3,
  type Vec3,
} from './droneState';
import { toast, sound, stateHud } from './events';
import { SimpleBackend, type PhysicsBackend } from './physicsBackend';

/** 一個 tick 的手動控制輸入（鍵盤 / 虛擬搖桿 / 實體搖桿 疊加後的語意軸） */
export interface ControlFrame {
  /** 垂直推力倍率（+1 = 一份 MANUAL_LIFT 向上；可疊加超過 1） */
  lift: number;
  /** 前後推力倍率（+1 = 一份 THRUST 向機頭方向） */
  forward: number;
  /** 左右推力倍率（+1 = 一份 THRUST 向機身右方） */
  right: number;
  /** 本 tick 的 yaw 增量（弧度；正 = 左轉） */
  yawDelta: number;
  /** 是否觸發起飛（地面按上升） */
  wantsTakeoff: boolean;
  /** 有任何輸入（解除緊急停止用） */
  anyInput: boolean;
}

/** 實心障礙（AABB）碰撞資料 — 由 level 載入時填入 */
export interface SolidObstacle {
  x: number;
  y: number;
  z: number;
  half: number;
}

// ---- 碰撞後端（見 core/physicsBackend.ts 的設計說明）----
// SimpleBackend：純 TS AABB 推出，永遠啟用（一般關卡 / 大亂鬥掩體）。
// meshBackend：需要三角網格碰撞的場景（playground glb / 之後的足球）才掛上（Havok），
//              與 SimpleBackend 共存 —— AABB 障礙與網格同時生效。
const simpleBackend = new SimpleBackend();
let meshBackend: PhysicsBackend | null = null;
let meshRadius = DRONE_RADIUS;

/**
 * 掛上 / 卸下網格碰撞後端（render/havokBackend；未來 Rust-WASM 同介面）。
 * radius：網格碰撞用的球半徑 — 預設機身 DRONE_RADIUS；
 * 足球模式傳 SOCCER_BALL_R（球形保護框半徑，對齊 legacy resolveBVHCollision）。
 */
export function setMeshCollisionBackend(
  backend: PhysicsBackend | null,
  radius: number = DRONE_RADIUS,
): void {
  meshBackend = backend;
  meshRadius = radius;
}

export function setSolidObstacles(list: SolidObstacle[]): void {
  simpleBackend.clear();
  list.forEach((o, i) =>
    simpleBackend.addStaticBox(
      `obstacle:${i}`,
      { x: o.x, y: o.y, z: o.z },
      { x: o.half, y: o.half, z: o.half },
    ),
  );
}

/** 緊急停止（空中按 Space）：凍結、速度歸零；任何輸入解凍 */
export function emergencyStop(): void {
  if (droneState.isGrounded || droneState.returning || !droneState.isFlying) return;
  droneState.frozen = true;
  droneState.velocity.x = droneState.velocity.y = droneState.velocity.z = 0;
  toast('🛑 緊急停止 — 推桿恢復飛行', 'warning');
  sound('stop');
}

/**
 * 手動模式：套用一個 tick 的控制輸入（呼叫端已確認未被鎖定）。
 * thrustScale：推力倍率（預設 1；鬼抓人「鬼」= GHOST_SPEED，由 multiplayer/arena 提供）。
 */
export function applyManualControls(frame: ControlFrame, thrustScale = 1): void {
  // 凍結中：有輸入才解凍，否則什麼都不做
  if (droneState.frozen) {
    if (!frame.anyInput) return;
    droneState.frozen = false;
    toast('▶ 恢復飛行', 'success');
  }
  if (droneState.returning) return;

  // 起飛：地面按上升
  if (frame.wantsTakeoff && droneState.isGrounded) {
    droneState.isGrounded = false;
    droneState.isFlying = true;
  }

  const thrust = THRUST * thrustScale;
  const lift = MANUAL_LIFT * thrustScale;

  // 升降（起飛前也作用；地板 clamp 會擋住）
  if (frame.lift !== 0) droneState.velocity.y += frame.lift * lift;

  if (droneState.isFlying) {
    if (frame.forward !== 0) {
      const f = forwardVec(droneState.yaw);
      droneState.velocity.x += f.x * thrust * frame.forward;
      droneState.velocity.z += f.z * thrust * frame.forward;
    }
    if (frame.right !== 0) {
      const r = rightVec(droneState.yaw);
      droneState.velocity.x += r.x * thrust * frame.right;
      droneState.velocity.z += r.z * thrust * frame.right;
    }
    if (frame.yawDelta !== 0) droneState.yaw += frame.yawDelta;
  }
}

/** 積分 + 阻力 + 地板碰撞（手動模式每 tick 呼叫） */
export function integrate(): void {
  const p = droneState.position;
  const v = droneState.velocity;
  p.x += v.x;
  p.y += v.y;
  p.z += v.z;
  v.x *= DRAG;
  v.y *= DRAG;
  v.z *= DRAG;
  if (lenVec3(v) < 0.001) v.x = v.y = v.z = 0;

  // 地板：y < 0.4 落地
  if (p.y < HOME_POSITION.y) {
    const wasFlying = droneState.isFlying;
    p.y = HOME_POSITION.y;
    v.y = 0;
    droneState.isGrounded = true;
    droneState.isFlying = false;
    if (wasFlying) sound('bump'); // 撞地音效
  }
}

/** 程式模式：位置由 motion plan 控制，只做地板保護 */
export function floorProtect(): void {
  if (droneState.position.y < HOME_POSITION.y) {
    droneState.position.y = HOME_POSITION.y;
  }
}

/**
 * 靜態體碰撞（每 tick、兩種模式都跑）：drone 視為半徑 DRONE_RADIUS 的球。
 * 1. SimpleBackend：AABB 沿最小穿透軸推出、該軸速度歸零（對齊 legacy L3295–3317）＋撞擊音效。
 * 2. meshBackend（有掛才跑）：三角網格推出＋速度衰減；對齊 legacy resolveBVHCollision，
 *    該路徑刻意不播音效（沿結構滑行時每 tick 都接觸，會吵）。
 */
export function resolveObstacleCollisions(): void {
  const p = droneState.position;
  const v = droneState.velocity;
  const { bumped } = simpleBackend.resolveCollisions(p, v, DRONE_RADIUS);
  if (bumped && droneState.isFlying) sound('bump');
  if (meshBackend) meshBackend.resolveCollisions(p, v, meshRadius);
}

// =============================================================================
// 自動駕駛（回家 / 自動降落）— 3 秒 easeInOut tween，期間鎖手動輸入
// =============================================================================
interface AutoPlan {
  from: Vec3;
  to: Vec3;
  fromYaw: number;
  toYaw: number;
  elapsed: number;
  duration: number;
  landOnDone: boolean;
  doneToast: string;
}

let autoPlan: AutoPlan | null = null;

export const easeInOut = (t: number): number =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

/** 一鍵飛回起飛墊（機頭轉回 0） */
export function goHome(): void {
  if (droneState.returning) return;
  const d = Math.hypot(
    droneState.position.x - HOME_POSITION.x,
    droneState.position.y - HOME_POSITION.y,
    droneState.position.z - HOME_POSITION.z,
  );
  if (droneState.isGrounded && d < 0.5) {
    toast('🏠 已經在起飛墊上了');
    return;
  }
  droneState.returning = true;
  droneState.frozen = false;
  droneState.velocity.x = droneState.velocity.y = droneState.velocity.z = 0;
  // 朝向 0：取最短方向
  let yawDiff = droneState.yaw % (Math.PI * 2);
  while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
  while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
  autoPlan = {
    from: { ...droneState.position },
    to: { ...HOME_POSITION },
    fromYaw: droneState.yaw,
    toYaw: droneState.yaw - yawDiff,
    elapsed: 0,
    duration: 3000,
    landOnDone: true,
    doneToast: '🏠 到家了',
  };
  toast('🏠 回家中…', 'success');
}

/** 搖桿降落鍵：原地垂直降落（1.5 秒） */
export function autoLand(): void {
  if (droneState.returning || !droneState.isFlying) return;
  droneState.returning = true;
  droneState.velocity.x = droneState.velocity.y = droneState.velocity.z = 0;
  autoPlan = {
    from: { ...droneState.position },
    to: { x: droneState.position.x, y: HOME_POSITION.y, z: droneState.position.z },
    fromYaw: droneState.yaw,
    toYaw: droneState.yaw,
    elapsed: 0,
    duration: 1500,
    landOnDone: true,
    doneToast: '🛬 已降落',
  };
}

/** 每 tick 推進自動駕駛 plan */
export function tickAutopilot(dtMs: number): void {
  if (!autoPlan) return;
  autoPlan.elapsed += dtMs;
  const t = Math.min(autoPlan.elapsed / autoPlan.duration, 1);
  const e = easeInOut(t);
  const { from, to, fromYaw, toYaw } = autoPlan;
  droneState.position.x = from.x + (to.x - from.x) * e;
  droneState.position.y = from.y + (to.y - from.y) * e;
  droneState.position.z = from.z + (to.z - from.z) * e;
  droneState.yaw = fromYaw + (toYaw - fromYaw) * e;
  if (t >= 1) {
    copyVec3(droneState.position, autoPlan.to);
    droneState.yaw = autoPlan.toYaw;
    droneState.velocity.x = droneState.velocity.y = droneState.velocity.z = 0;
    if (autoPlan.landOnDone) {
      droneState.isFlying = false;
      droneState.isGrounded = true;
    }
    droneState.returning = false;
    toast(autoPlan.doneToast, 'success');
    stateHud('待命');
    autoPlan = null;
  }
}
