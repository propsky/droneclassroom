// 關卡物件預設值與物理屬性輔助（零 runtime 依賴）。
import type { BalloonDef, ObstacleDef, RingDef, SimPhysicsDef } from './levels';

export const DEFAULT_RING_SPIN = 0.015;
export const DEFAULT_RING_BOB_AMP = 0.2;
export const DEFAULT_BALLOON_DIAMETER = 1.4;
export const DEFAULT_ZONE_MARKER_DIAMETER = 1.8;
export const DEFAULT_ZONE_TRIGGER_RADIUS = 1.5;

export const DEFAULT_RING_COLOR = '#38bdf8';
export const DEFAULT_OBSTACLE_SOLID_COLOR = '#f87171';
export const DEFAULT_OBSTACLE_SOFT_COLOR = '#4ade80';
export const DEFAULT_BALLOON_COLORS = ['#f472b6', '#60a5fa', '#fbbf24', '#4ade80', '#c084fc'] as const;

export const PHYSICS_DEFAULTS: Readonly<SimPhysicsDef> = {
  collidable: false,
  massKg: undefined,
  restitution: 0.05,
  friction: 0.55,
  gravity: false,
};

export const OBSTACLE_PHYSICS_SOLID: Readonly<SimPhysicsDef> = {
  collidable: true,
  massKg: undefined,
  restitution: 0.08,
  friction: 0.65,
  gravity: false,
};

export function ringSpin(ring: { spin?: number } | undefined): number {
  const s = ring?.spin;
  return s != null && s >= 0 ? s : DEFAULT_RING_SPIN;
}

export function ringBobAmp(ring: { bobAmp?: number } | undefined): number {
  const a = ring?.bobAmp;
  return a != null && a >= 0 ? a : DEFAULT_RING_BOB_AMP;
}

export function balloonDiameter(balloon: { diameter?: number } | undefined): number {
  const d = balloon?.diameter;
  return d != null && d > 0 ? d : DEFAULT_BALLOON_DIAMETER;
}

/** 戳破判定半徑（模擬器 core/level 用） */
export function balloonPopRadius(balloon: { diameter?: number } | undefined): number {
  return balloonDiameter(balloon) / 2;
}

export function zoneMarkerDiameter(zone: { markerDiameter?: number } | undefined): number {
  const d = zone?.markerDiameter;
  return d != null && d > 0 ? d : DEFAULT_ZONE_MARKER_DIAMETER;
}

export function zoneTriggerRadius(zone: { triggerRadius?: number } | undefined): number {
  const r = zone?.triggerRadius;
  return r != null && r > 0 ? r : DEFAULT_ZONE_TRIGGER_RADIUS;
}

/** 將關卡顏色統一為 #rrggbb（編輯器 / 預覽用） */
export function parseLevelColor(raw: number | string | undefined, fallback: string): string {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'number') {
    const n = raw >>> 0;
    return `#${n.toString(16).padStart(6, '0')}`;
  }
  const s = raw.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s.toLowerCase()}`;
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    const h = s.slice(1);
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`.toLowerCase();
  }
  return fallback;
}

export function obstacleDefaultColor(solid: boolean | undefined): string {
  return solid ? DEFAULT_OBSTACLE_SOLID_COLOR : DEFAULT_OBSTACLE_SOFT_COLOR;
}

export function obstacleIsCollidable(obs: ObstacleDef): boolean {
  if (obs.physics?.collidable != null) return obs.physics.collidable;
  return !!obs.solid;
}

function numEq(a: number | undefined, b: number | undefined): boolean {
  return (a ?? undefined) === (b ?? undefined);
}

/** 儲存時省略與預設相同的 physics 欄位 */
export function compactPhysics(
  physics: SimPhysicsDef | undefined,
  defaults: SimPhysicsDef = PHYSICS_DEFAULTS,
): SimPhysicsDef | undefined {
  if (!physics) return undefined;
  const out: SimPhysicsDef = {};
  if (physics.collidable != null && physics.collidable !== defaults.collidable) {
    out.collidable = physics.collidable;
  }
  if (physics.massKg != null) out.massKg = physics.massKg;
  if (physics.restitution != null && !numEq(physics.restitution, defaults.restitution)) {
    out.restitution = physics.restitution;
  }
  if (physics.friction != null && !numEq(physics.friction, defaults.friction)) {
    out.friction = physics.friction;
  }
  if (physics.gravity != null && physics.gravity !== defaults.gravity) {
    out.gravity = physics.gravity;
  }
  return Object.keys(out).length ? out : undefined;
}

export function compactRing(ring: RingDef): RingDef {
  const out: RingDef = { x: ring.x, y: ring.y, z: ring.z };
  if (ring.label) out.label = ring.label;
  if (ring.color) out.color = ring.color;
  if (ring.diameter != null && ring.diameter !== 3) out.diameter = ring.diameter;
  if (ring.thickness != null && ring.thickness !== 0.24) out.thickness = ring.thickness;
  if (ring.faceYaw != null) {
    out.faceYaw = ring.faceYaw;
    if (ring.faceTol != null && ring.faceTol !== 35) out.faceTol = ring.faceTol;
  }
  if (ring.spin != null && ring.spin !== DEFAULT_RING_SPIN) out.spin = ring.spin;
  if (ring.bobAmp != null && ring.bobAmp !== DEFAULT_RING_BOB_AMP) out.bobAmp = ring.bobAmp;
  const p = compactPhysics(ring.physics);
  if (p) out.physics = p;
  return out;
}
