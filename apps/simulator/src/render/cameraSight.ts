// 視線遮擋：從鏡頭射向焦點或飛行區取樣點，看會不會先撞到門框或其他幾何。
// 純數學，不碰 Babylon，測試與鏡頭取景共用同一套。

export interface SightPoint {
  x: number;
  y: number;
  z: number;
}

export type SightAxis = 'x' | 'y' | 'z';

export interface SightAabb {
  kind: 'aabb';
  name: string;
  min: SightPoint;
  max: SightPoint;
}

export interface SightSphere {
  kind: 'sphere';
  name: string;
  center: SightPoint;
  radius: number;
}

export interface SightCylinder {
  kind: 'cylinder';
  name: string;
  center: SightPoint;
  axis: SightAxis;
  radius: number;
  halfHeight: number;
}

/** 圓環。major 是環心半徑，tube 是管半徑。足球門與關卡圈的軸是 z。 */
export interface SightTorus {
  kind: 'torus';
  name: string;
  center: SightPoint;
  axis: SightAxis;
  major: number;
  tube: number;
}

export type SightSolid = SightAabb | SightSphere | SightCylinder | SightTorus;

const HIT_EPS = 0.02;

export class CameraSight {
  /** 射線在到達目標前撞到的第一個固體名稱；暢通則 null。目標自己所在的那顆固體不算擋住。 */
  static blocker(
    origin: SightPoint,
    target: SightPoint,
    solids: readonly SightSolid[],
  ): string | null {
    let best: { name: string; t: number } | null = null;
    for (const solid of solids) {
      if (CameraSight.contains(solid, target)) continue;
      const t = CameraSight.hitT(origin, target, solid);
      if (t == null) continue;
      if (!best || t < best.t) best = { name: solid.name, t };
    }
    return best?.name ?? null;
  }

  static clear(origin: SightPoint, target: SightPoint, solids: readonly SightSolid[]): boolean {
    return CameraSight.blocker(origin, target, solids) == null;
  }

  static contains(solid: SightSolid, p: SightPoint): boolean {
    const q = CameraSight.sub(p, CameraSight.centerOf(solid));
    if (solid.kind === 'aabb') {
      return (
        p.x >= solid.min.x - 1e-6 &&
        p.x <= solid.max.x + 1e-6 &&
        p.y >= solid.min.y - 1e-6 &&
        p.y <= solid.max.y + 1e-6 &&
        p.z >= solid.min.z - 1e-6 &&
        p.z <= solid.max.z + 1e-6
      );
    }
    if (solid.kind === 'sphere') return CameraSight.len(q) <= solid.radius + 1e-6;
    if (solid.kind === 'cylinder') {
      const axial = CameraSight.axisValue(q, solid.axis);
      const radial = CameraSight.radial(q, solid.axis);
      return Math.abs(axial) <= solid.halfHeight + 1e-6 && radial <= solid.radius + 1e-6;
    }
    return CameraSight.torusSdf(q, solid.major, solid.tube, solid.axis) <= 1e-4;
  }

  /** 參數 t ∈ (0,1) 上的交點；起點埋在固體裡算 t=0。沒撞到回 null。 */
  static hitT(origin: SightPoint, target: SightPoint, solid: SightSolid): number | null {
    if (CameraSight.contains(solid, origin)) return 0;
    if (solid.kind === 'aabb') return CameraSight.aabbT(origin, target, solid);
    if (solid.kind === 'sphere') return CameraSight.sphereT(origin, target, solid);
    if (solid.kind === 'cylinder') return CameraSight.cylinderT(origin, target, solid);
    return CameraSight.torusT(origin, target, solid);
  }

  static torusSdf(p: SightPoint, major: number, tube: number, axis: SightAxis): number {
    const axial = CameraSight.axisValue(p, axis);
    const radial = CameraSight.radial(p, axis);
    return Math.hypot(radial - major, axial) - tube;
  }

  private static centerOf(solid: SightSolid): SightPoint {
    if (solid.kind === 'aabb') {
      return {
        x: (solid.min.x + solid.max.x) / 2,
        y: (solid.min.y + solid.max.y) / 2,
        z: (solid.min.z + solid.max.z) / 2,
      };
    }
    return solid.center;
  }

  private static aabbT(origin: SightPoint, target: SightPoint, box: SightAabb): number | null {
    const dir = CameraSight.sub(target, origin);
    let tMin = 0;
    let tMax = 1;
    const slabs: Array<[number, number, number]> = [
      [origin.x, dir.x, box.min.x],
      [origin.y, dir.y, box.min.y],
      [origin.z, dir.z, box.min.z],
    ];
    const maxes = [box.max.x, box.max.y, box.max.z];
    for (let i = 0; i < 3; i++) {
      const [o, d, mn] = slabs[i]!;
      const mx = maxes[i]!;
      if (Math.abs(d) < 1e-12) {
        if (o < mn || o > mx) return null;
        continue;
      }
      let t1 = (mn - o) / d;
      let t2 = (mx - o) / d;
      if (t1 > t2) {
        const s = t1;
        t1 = t2;
        t2 = s;
      }
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) return null;
    }
    if (tMin > HIT_EPS && tMin < 1 - HIT_EPS) return tMin;
    if (tMax > HIT_EPS && tMax < 1 - HIT_EPS && tMin <= HIT_EPS) return tMax;
    return null;
  }

  private static sphereT(origin: SightPoint, target: SightPoint, sphere: SightSphere): number | null {
    const dir = CameraSight.sub(target, origin);
    const oc = CameraSight.sub(origin, sphere.center);
    const a = CameraSight.dot(dir, dir);
    const b = 2 * CameraSight.dot(oc, dir);
    const c = CameraSight.dot(oc, oc) - sphere.radius * sphere.radius;
    const disc = b * b - 4 * a * c;
    if (disc < 0 || a < 1e-12) return null;
    const root = Math.sqrt(disc);
    const t0 = (-b - root) / (2 * a);
    const t1 = (-b + root) / (2 * a);
    if (t0 > HIT_EPS && t0 < 1 - HIT_EPS) return t0;
    if (t1 > HIT_EPS && t1 < 1 - HIT_EPS) return t1;
    return null;
  }

  private static cylinderT(
    origin: SightPoint,
    target: SightPoint,
    cyl: SightCylinder,
  ): number | null {
    const dir = CameraSight.sub(target, origin);
    const oc = CameraSight.sub(origin, cyl.center);
    const d = CameraSight.dropAxis(dir, cyl.axis);
    const o = CameraSight.dropAxis(oc, cyl.axis);
    const a = CameraSight.dot(d, d);
    const b = 2 * CameraSight.dot(o, d);
    const c = CameraSight.dot(o, o) - cyl.radius * cyl.radius;
    const ts: number[] = [];
    if (a > 1e-12) {
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        const root = Math.sqrt(disc);
        ts.push((-b - root) / (2 * a), (-b + root) / (2 * a));
      }
    }
    let best: number | null = null;
    for (const t of ts) {
      if (t <= HIT_EPS || t >= 1 - HIT_EPS) continue;
      const p = CameraSight.add(origin, CameraSight.scale(dir, t));
      const axial = CameraSight.axisValue(CameraSight.sub(p, cyl.center), cyl.axis);
      if (Math.abs(axial) > cyl.halfHeight) continue;
      if (best == null || t < best) best = t;
    }
    return best;
  }

  /** 圓環 SDF 步進。步長不超過距離，交點誤差約 5 mm。 */
  private static torusT(origin: SightPoint, target: SightPoint, torus: SightTorus): number | null {
    const dir = CameraSight.sub(target, origin);
    const len = CameraSight.len(dir);
    if (len < 1e-8) return null;
    const stepDir = CameraSight.scale(dir, 1 / len);
    let t = 0;
    const limit = len * (1 - HIT_EPS);
    for (let i = 0; i < 48; i++) {
      const p = CameraSight.sub(CameraSight.add(origin, CameraSight.scale(stepDir, t)), torus.center);
      const d = CameraSight.torusSdf(p, torus.major, torus.tube, torus.axis);
      if (d <= 0.005) {
        return t > HIT_EPS * len && t < limit ? t / len : null;
      }
      t += Math.max(d, 0.008);
      if (t >= limit) return null;
    }
    return null;
  }

  static sub(a: SightPoint, b: SightPoint): SightPoint {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  }

  static add(a: SightPoint, b: SightPoint): SightPoint {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
  }

  static scale(a: SightPoint, s: number): SightPoint {
    return { x: a.x * s, y: a.y * s, z: a.z * s };
  }

  static dot(a: SightPoint, b: SightPoint): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  static len(a: SightPoint): number {
    return Math.hypot(a.x, a.y, a.z);
  }

  static axisValue(p: SightPoint, axis: SightAxis): number {
    if (axis === 'x') return p.x;
    if (axis === 'y') return p.y;
    return p.z;
  }

  static radial(p: SightPoint, axis: SightAxis): number {
    if (axis === 'x') return Math.hypot(p.y, p.z);
    if (axis === 'y') return Math.hypot(p.x, p.z);
    return Math.hypot(p.x, p.y);
  }

  private static dropAxis(p: SightPoint, axis: SightAxis): SightPoint {
    if (axis === 'x') return { x: 0, y: p.y, z: p.z };
    if (axis === 'y') return { x: p.x, y: 0, z: p.z };
    return { x: p.x, y: p.y, z: 0 };
  }
}
