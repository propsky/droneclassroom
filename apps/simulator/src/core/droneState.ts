// 無人機物理狀態 — 單一真相來源（框架無關純 TS）。
// 座標系：右手系、機頭朝 -Z、yaw 正向 = 左轉（與 legacy Three.js 版一致）。

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const copyVec3 = (dst: Vec3, src: Vec3): Vec3 => {
  dst.x = src.x;
  dst.y = src.y;
  dst.z = src.z;
  return dst;
};
export const lenVec3 = (v: Vec3): number => Math.hypot(v.x, v.y, v.z);
export const distVec3 = (a: Vec3, b: Vec3): number =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** 機頭方向（yaw 弧度 → 單位向量；yaw=0 時朝 -Z） */
export function forwardVec(yaw: number): Vec3 {
  return { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) };
}

/** 機身右方（yaw=0 時朝 +X） */
export function rightVec(yaw: number): Vec3 {
  return { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
}

// ---- 手感常數（legacy per-frame 值，本版定義為 per-tick @60Hz，數值原封沿用） ----
export const THRUST = 0.012;       // 水平推力（每 tick 速度增量）
export const MANUAL_LIFT = 0.015;  // 垂直推力
export const DRAG = 0.92;          // 每 tick 空氣阻力
export const YAW_KEY_RATE = 0.03;  // 方向鍵每 tick 旋轉（弧度）
export const YAW_STICK_RATE = 0.04; // 搖桿滿舵每 tick 旋轉（弧度）
export const DRONE_RADIUS = 0.6;   // 碰撞球半徑（略大於機身，避免視覺穿模）
export const TICK_HZ = 60;
export const TICK_MS = 1000 / TICK_HZ;

export const HOME_POSITION: Readonly<Vec3> = Object.freeze({ x: 0, y: 0.4, z: 0 });

export interface DroneState {
  position: Vec3;
  velocity: Vec3;
  /** 邏輯朝向（弧度；正向 = 左轉）。視覺傾斜只作用於模型、不動這裡。 */
  yaw: number;
  propellerRotation: number;
  isFlying: boolean;
  isGrounded: boolean;
  /** 緊急停止凍結中（任何輸入解凍） */
  frozen: boolean;
  /** 一鍵回家 / 自動降落中（鎖手動輸入） */
  returning: boolean;
}

export const droneState: DroneState = {
  position: vec3(HOME_POSITION.x, HOME_POSITION.y, HOME_POSITION.z),
  velocity: vec3(),
  yaw: 0,
  propellerRotation: 0,
  isFlying: false,
  isGrounded: true,
  frozen: false,
  returning: false,
};

/** 把 drone 放回起飛墊（不含關卡任務狀態；那由 level.resetMission 處理） */
export function resetDroneState(): void {
  copyVec3(droneState.position, HOME_POSITION);
  droneState.velocity.x = droneState.velocity.y = droneState.velocity.z = 0;
  droneState.yaw = 0;
  droneState.isFlying = false;
  droneState.isGrounded = true;
  droneState.frozen = false;
  droneState.returning = false;
}

// ---- 共享旗標（core 各模組共用，避免循環 import） ----
export type Mode = 'manual' | 'program';

export const flags = {
  mode: 'manual' as Mode,
  /** Blockly 程式執行中（鎖手動輸入與模式切換） */
  programRunning: false,
  /** 3-2-1 倒數中（鎖操控、不判定過關） */
  countdownActive: false,
  /**
   * 多人模式鎖操控（大亂鬥倒數中 / 鬼抓人暈眩中）。
   * 由 multiplayer/arena.ts 每 tick 更新 — core 不 import multiplayer，避免反向依賴。
   */
  multiplayerLock: false,
};

/** 手動輸入是否被鎖定（程式模式 / 程式執行中 / 倒數中 / 回家中 / 多人鎖定） */
export function isManualLocked(): boolean {
  return (
    flags.programRunning ||
    flags.mode !== 'manual' ||
    flags.countdownActive ||
    flags.multiplayerLock ||
    droneState.returning
  );
}
