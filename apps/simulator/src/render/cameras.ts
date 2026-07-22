// 相機：第三人稱跟隨（offset (0,4,12) 依 yaw 旋轉、lerp 0.06、lookAt drone）、
// FPV（C 鍵切換，機身隱藏），以及畫畫教室的 topdown / orbit3d 兩模式（依 level.view 切換）。
//
// topdown 對齊 legacy main.js L3484–3489 的視覺（近乎正上方、固定框住畫布、不跟機身轉），
// 但不寫死鏡位：由 guide 折線 bounding box 自動取景（含邊距係數），
// 關卡 JSON 可用選配欄位 topdownCam 覆寫。
// orbit3d 對齊 legacy L3490–3498：慢速繞著作品轉的展示台鏡頭，參數全由 JSON orbit 讀取。
import { Scene, FreeCamera, Vector3 } from '@babylonjs/core';
import type { LevelDef } from '@creafly/shared';
import { droneState, forwardVec } from '../core/droneState';
import { levelState } from '../core/level';
import { DRAW_HEIGHT_DEFAULT } from '../core/pen';
import { bus, toast } from '../core/events';
import { activeSoccerField } from '../soccer/field';

// ---- 俯視（topdown）取景常數 ----
/** 邊距係數：取景半徑 = guide bbox 半徑 × 此係數（>1 = 圖形四周留白） */
const TOPDOWN_MARGIN = 1.35;
/** 最小取景半徑（m）：小圖形不放到滿版，留空間看起飛台與參考線全貌 */
const TOPDOWN_MIN_HALF_VIEW = 6;
/** 無 guide 的 draw 關（自由畫布）後備取景半徑（m），中心取原點 */
const TOPDOWN_FALLBACK_HALF = 8;
/** 俯角比例：相機沿 +Z 偏移 = 視距 × 此值（legacy (1.5,21,3)→lookAt z-2.4 約 0.3，非正上方避免方向感喪失） */
const TOPDOWN_TILT_RATIO = 0.3;

// ---- 環繞（orbit3d）常數（legacy L3493–3496 的 fallback 與速度）----
/** 慢速繞行角速度（rad/ms）— legacy performance.now() * 0.00025 */
const ORBIT3D_SPEED_RAD_PER_MS = 0.00025;
/** JSON orbit 欄位缺省時的後備參數（legacy `o.center || [0,4,0]` 等） */
const ORBIT3D_DEFAULT_CENTER: readonly [number, number, number] = [0, 4, 0];
const ORBIT3D_DEFAULT_RADIUS = 13;
const ORBIT3D_DEFAULT_HEIGHT = 9;

/** guide 折線的俯視 bounding box（自動取景用） */
interface GuideBounds {
  cx: number;
  cz: number;
  halfX: number;
  halfZ: number;
}

function computeGuideBounds(level: LevelDef): GuideBounds {
  const guide = level.guide;
  if (!Array.isArray(guide) || guide.length < 2) {
    return { cx: 0, cz: 0, halfX: TOPDOWN_FALLBACK_HALF, halfZ: TOPDOWN_FALLBACK_HALF };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of guide) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return {
    cx: (minX + maxX) / 2,
    cz: (minZ + maxZ) / 2,
    halfX: (maxX - minX) / 2,
    halfZ: (maxZ - minZ) / 2,
  };
}

export class CameraRig {
  readonly camera: FreeCamera;
  fpv = false;
  private tmpTarget = new Vector3();
  /** 目前關卡的 topdown 取景（level-loaded 時重算一次；高度在 update 依 aspect 求） */
  private guideBounds: GuideBounds = { cx: 0, cz: 0, halfX: TOPDOWN_FALLBACK_HALF, halfZ: TOPDOWN_FALLBACK_HALF };
  /** ⚽ 足球窄邊定點視角：站哪個 z 端往場內看（+1 / -1）；null = 一般跟隨視角 */
  private soccerSign: number | null = null;
  /** ⚽ 足球視角模式：'follow' 跟隨（預設 — 定點視角會被門環/球/其他飛機擋住）｜'team' 窄邊全場 */
  private soccerCam: 'follow' | 'team' = 'follow';

  constructor(scene: Scene) {
    this.camera = new FreeCamera('cam', new Vector3(0, 15, 30), scene);
    this.camera.fov = (60 * Math.PI) / 180;
    this.camera.minZ = 0.1;
    this.camera.maxZ = 1000;
    this.camera.setTarget(Vector3.Zero());
    // 不 attachControl：相機完全由程式驅動
    bus.on('level-loaded', ({ level }) => {
      this.guideBounds = computeGuideBounds(level);
    });
    // ⚽ 足球模式：進場設 sign（多人依隊伍動態換）、離場還原 null + 視角回預設跟隨
    bus.on('soccer-view-changed', ({ sign }) => {
      this.soccerSign = sign;
      if (sign === null) this.soccerCam = 'follow';
    });
  }

  /** 切換視角（C 鍵 / header 按鈕）。足球中三段循環：跟隨 → 全場 → FPV；其餘二段。 */
  toggleView(): { label: string; fpv: boolean } {
    let label: string;
    if (this.soccerSign !== null) {
      if (!this.fpv && this.soccerCam === 'follow') {
        this.soccerCam = 'team';
        label = '🏟 全場視角';
      } else if (!this.fpv) {
        this.fpv = true;
        label = '👁 第一視角(FPV)';
      } else {
        this.fpv = false;
        this.soccerCam = 'follow';
        label = '🎥 跟隨視角';
      }
    } else {
      this.fpv = !this.fpv;
      label = this.fpv ? '👁 第一視角(FPV)' : '🎥 第三人稱';
    }
    toast(label);
    return { label, fpv: this.fpv };
  }

  /** 每個渲染幀更新（pos/yaw 已是插值後的值）。回傳機身是否應顯示。 */
  update(pos: Vector3, yaw: number): boolean {
    if (this.fpv) {
      // 第一視角：相機在機身、看機頭方向（略往下，像 FPV 眼鏡）
      const f = forwardVec(yaw);
      const eye = new Vector3(pos.x + f.x * 0.35, pos.y + 0.45, pos.z + f.z * 0.35);
      this.camera.position.copyFrom(eye);
      this.tmpTarget.set(eye.x + f.x * 10, eye.y - 1.2, eye.z + f.z * 10);
      this.camera.setTarget(this.tmpTarget);
      return false; // FPV 不顯示自己的機身
    }

    // ⚽ 足球：窄邊定點「全場視角」— 站己方端線後方、略高於門頂，看向場內遠端門。
    // 預設是跟隨視角（落到下方一般分支）：定點視角容易被門環/球/其他飛機擋住，
    // 想看全場再用 C 鍵/視角鈕切過來。尺寸依伺服器下發的生效場地（soccer/field.ts）。
    if (this.soccerSign !== null && this.soccerCam === 'team') {
      const sign = this.soccerSign;
      const F = activeSoccerField();
      const dist = F.halfZ + Math.max(9, F.halfZ * 0.5); // 端線後方：至少 9m，大場地按比例退
      const camY = F.goalY + F.goalR + 2; // 高過門頂一點 → 近端門環不擋視線
      this.camera.position.set(0, camY, sign * dist);
      this.tmpTarget.set(0, Math.max(F.goalY - 1, 2), -sign * F.halfZ * 0.3);
      this.camera.setTarget(this.tmpTarget);
      return true;
    }

    // 畫畫教室：依 level.view 切到 topdown / orbit3d（都顯示機身）
    const level = levelState.current;
    if (level?.draw && level.view === 'topdown') {
      this.updateTopdown(level);
      return true;
    }
    if (level?.draw && level.view === 'orbit3d') {
      this.updateOrbit3d(level);
      return true;
    }

    // 第三人稱跟隨：offset (0,4,12) 依 yaw 旋轉
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    // 旋轉 (0,4,12)：x' = z*sin、z' = z*cos（右手系繞 Y）
    const ox = 12 * sin;
    const oz = 12 * cos;
    const target = new Vector3(pos.x + ox, pos.y + 4, pos.z + oz);
    Vector3.LerpToRef(this.camera.position, target, 0.06, this.camera.position);
    this.camera.setTarget(new Vector3(pos.x, pos.y, pos.z));
    return true;
  }

  /**
   * 俯視鏡頭：固定框住畫布、近乎正上方（圖才看得出來；不跟機身轉）。
   * 鏡位由 guide bounds 自動求：視距 = 取景半徑 / tan(fov/2)（含邊距係數、
   * 橫向依畫面長寬比換算），JSON topdownCam 存在時直接覆寫。
   */
  private updateTopdown(level: LevelDef): void {
    const cam = level.topdownCam;
    if (cam) {
      this.camera.position.set(cam.x, cam.y, cam.z);
      this.tmpTarget.set(cam.lookAt[0], cam.lookAt[1], cam.lookAt[2]);
      this.camera.setTarget(this.tmpTarget);
      return;
    }
    const b = this.guideBounds;
    const aspect = this.camera.getEngine().getAspectRatio(this.camera);
    const tanHalfFov = Math.tan(this.camera.fov / 2); // fov 是垂直視角
    // 垂直方向裝 z 範圍、水平方向裝 x 範圍（除以 aspect 折算回垂直等效）
    const halfView = Math.max(b.halfZ, b.halfX / aspect, TOPDOWN_MIN_HALF_VIEW) * TOPDOWN_MARGIN;
    const dist = halfView / tanHalfFov; // 距繪圖面的視距
    const drawY = level.drawHeight ?? DRAW_HEIGHT_DEFAULT;
    this.camera.position.set(b.cx, drawY + dist, b.cz + dist * TOPDOWN_TILT_RATIO);
    this.tmpTarget.set(b.cx, 0, b.cz);
    this.camera.setTarget(this.tmpTarget);
  }

  /** 環繞鏡頭：慢慢繞著作品轉（立體感才出得來，像展示台）。參數全由 JSON orbit。 */
  private updateOrbit3d(level: LevelDef): void {
    const o = level.orbit ?? {};
    const c = o.center ?? ORBIT3D_DEFAULT_CENTER;
    const r = o.radius ?? ORBIT3D_DEFAULT_RADIUS;
    const h = o.height ?? ORBIT3D_DEFAULT_HEIGHT;
    const ang = performance.now() * ORBIT3D_SPEED_RAD_PER_MS;
    this.camera.position.set(c[0] + Math.cos(ang) * r, c[1] + h, c[2] + Math.sin(ang) * r);
    this.tmpTarget.set(c[0], c[1], c[2]);
    this.camera.setTarget(this.tmpTarget);
  }

  /** 使用 droneState 目前值立刻取用（初始化用） */
  snapBehindDrone(): void {
    const yaw = droneState.yaw;
    const p = droneState.position;
    this.camera.position.set(p.x + 12 * Math.sin(yaw), p.y + 4, p.z + 12 * Math.cos(yaw));
    this.camera.setTarget(new Vector3(p.x, p.y, p.z));
  }
}
