// CREAFLY 風格無人機 — 程式化幾何組裝，對齊 legacy buildCreaFlyDrone（§3）：
// 雙層機身、綠 logo、4 臂 X 形馬達、4 對轉螺旋槳、前綠後紅 LED、腳架、底板。
import {
  Scene,
  TransformNode,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  Quaternion,
  ShadowGenerator,
  Mesh,
} from '@babylonjs/core';
import { droneState, forwardVec, rightVec, type Vec3 } from '../core/droneState';
import { CREAFLY_COLOR, hex } from './scene';

// 視覺傾斜常數（只作用模型 quaternion，不動邏輯 yaw）
const TILT_MAX = 0.45; // 最大傾斜角 ≈ 26°
const TILT_REFSPD = 0.12; // 達此每 tick 水平位移即接近最大傾斜
const TILT_SMOOTH = 0.12; // 平滑係數

export class DroneVisual {
  readonly root: TransformNode;
  private propellers: TransformNode[] = [];
  private tiltPitch = 0;
  private tiltRoll = 0;
  private prevTickPos: Vec3 | null = null;
  /** 全機材質 + 原始 alpha（大亂鬥暈眩變暗 / 無敵閃爍用；還原時乘回 1） */
  private fadeMats: { mat: StandardMaterial; baseAlpha: number }[] = [];
  private opacityFactor = 1;

  constructor(scene: Scene, shadowGenerator: ShadowGenerator) {
    this.root = new TransformNode('drone', scene);
    this.root.rotationQuaternion = Quaternion.Identity();

    const createdMats: StandardMaterial[] = [];
    const mat = (name: string, color: number, spec = 0.3): StandardMaterial => {
      const m = new StandardMaterial(name, scene);
      m.diffuseColor = hex(color);
      m.specularColor = new Color3(spec, spec, spec);
      createdMats.push(m);
      return m;
    };
    const matWhite = mat('droneWhite', CREAFLY_COLOR.white, 0.5);
    const matPrimary = mat('dronePrimary', CREAFLY_COLOR.primary, 0.6);
    const matAccent = mat('droneAccent', CREAFLY_COLOR.accent, 0.6);
    const matDark = mat('droneDark', CREAFLY_COLOR.dark, 0.2);
    const matYellow = mat('droneYellow', CREAFLY_COLOR.yellow, 0.4);
    matYellow.alpha = 0.9;
    const matBladeWhite = mat('droneBladeWhite', CREAFLY_COLOR.white, 0.4);
    matBladeWhite.alpha = 0.9;

    const casters: Mesh[] = [];
    const box = (
      name: string,
      w: number,
      h: number,
      d: number,
      m: StandardMaterial,
      x = 0,
      y = 0,
      z = 0,
      castShadow = true,
    ): Mesh => {
      const b = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
      b.material = m;
      b.position.set(x, y, z);
      b.parent = this.root;
      if (castShadow) casters.push(b);
      return b;
    };

    // 中央主體（白色下層 + 青色頂蓋 + 綠 logo）
    box('lowerBody', 2.4, 0.5, 2.4, matWhite, 0, 0, 0);
    box('upperBody', 2.0, 0.3, 2.0, matPrimary, 0, 0.4, 0);
    box('logoBlock', 0.8, 0.15, 0.8, matAccent, 0, 0.62, 0, false);

    // 4 個馬達（X 形配置）+ 機臂 + 螺旋槳
    const armLength = 1.6;
    const motorPositions = [
      { x: armLength, z: armLength },
      { x: -armLength, z: armLength },
      { x: armLength, z: -armLength },
      { x: -armLength, z: -armLength },
    ];
    motorPositions.forEach((mp, i) => {
      // 機臂：沿徑向指向馬達
      const armLen = Math.hypot(mp.x, mp.z);
      const arm = MeshBuilder.CreateBox(
        `arm${i}`,
        { width: 0.18, height: 0.12, depth: armLen * 0.7 },
        scene,
      );
      arm.material = matDark;
      arm.position.set(mp.x * 0.5, 0, mp.z * 0.5);
      arm.rotation.y = Math.atan2(mp.x, mp.z);
      arm.parent = this.root;
      casters.push(arm);

      // 馬達座 + 頂蓋
      const motorBase = MeshBuilder.CreateCylinder(
        `motorBase${i}`,
        { diameter: 0.64, height: 0.25, tessellation: 16 },
        scene,
      );
      motorBase.material = matDark;
      motorBase.position.set(mp.x, 0.15, mp.z);
      motorBase.parent = this.root;
      casters.push(motorBase);

      const motorTop = MeshBuilder.CreateCylinder(
        `motorTop${i}`,
        { diameter: 0.56, height: 0.1, tessellation: 16 },
        scene,
      );
      motorTop.material = matPrimary;
      motorTop.position.set(mp.x, 0.32, mp.z);
      motorTop.parent = this.root;

      // 螺旋槳（十字雙葉；黃白交錯）
      const propGroup = new TransformNode(`prop${i}`, scene);
      propGroup.position.set(mp.x, 0.4, mp.z);
      propGroup.parent = this.root;
      const bladeMat = i % 2 === 0 ? matYellow : matBladeWhite;
      const blade1 = MeshBuilder.CreateBox(
        `blade${i}a`,
        { width: 1.4, height: 0.04, depth: 0.15 },
        scene,
      );
      blade1.material = bladeMat;
      blade1.parent = propGroup;
      const blade2 = MeshBuilder.CreateBox(
        `blade${i}b`,
        { width: 0.15, height: 0.04, depth: 1.4 },
        scene,
      );
      blade2.material = bladeMat;
      blade2.parent = propGroup;
      this.propellers.push(propGroup);
    });

    // LED（前綠後紅）
    const ledMatG = new StandardMaterial('ledG', scene);
    ledMatG.emissiveColor = hex(CREAFLY_COLOR.ledGreen);
    ledMatG.disableLighting = true;
    const ledMatR = new StandardMaterial('ledR', scene);
    ledMatR.emissiveColor = hex(CREAFLY_COLOR.ledRed);
    ledMatR.disableLighting = true;
    // 機頭朝 -Z → 前 LED 在 -Z（legacy 模型 front z=+1.25 是尾？照 legacy 座標：前綠 z=+1.25…
    // legacy 把綠 LED 放 z=+1.25、紅 z=-1.25，但機頭朝 -Z；照抄 legacy 讓外觀一致。
    const ledFront = MeshBuilder.CreateSphere('ledFront', { diameter: 0.24, segments: 8 }, scene);
    ledFront.material = ledMatG;
    ledFront.position.set(0, 0.15, 1.25);
    ledFront.parent = this.root;
    const ledRear = MeshBuilder.CreateSphere('ledRear', { diameter: 0.24, segments: 8 }, scene);
    ledRear.material = ledMatR;
    ledRear.position.set(0, 0.15, -1.25);
    ledRear.parent = this.root;

    // 腳架 ×4 + 底板
    for (const [x, z] of [
      [1, -1],
      [-1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      box(`leg${x}${z}`, 0.1, 0.4, 0.1, matDark, x * 0.7, -0.2, z * 0.7, false);
    }
    box('bottomPlate', 1.4, 0.05, 1.4, matAccent, 0, -0.1, 0, false);

    casters.forEach((m) => shadowGenerator.addShadowCaster(m));

    // LED 材質也要跟著暗 / 閃（大亂鬥視覺）
    createdMats.push(ledMatG, ledMatR);
    this.fadeMats = createdMats.map((m) => ({ mat: m, baseAlpha: m.alpha }));
  }

  /** 大亂鬥：鬼 = 1.6 倍、一般 = 1（只動視覺，不影響碰撞半徑 — 抓捕由伺服器判） */
  setScaleFactor(s: number): void {
    if (this.root.scaling.x !== s) this.root.scaling.setAll(s);
  }

  /** 大亂鬥：整機透明度倍率（暈眩 0.3 / 無敵閃爍 / 還原 1）；乘在各材質原始 alpha 上 */
  setOpacityFactor(f: number): void {
    if (this.opacityFactor === f) return;
    this.opacityFactor = f;
    for (const { mat, baseAlpha } of this.fadeMats) mat.alpha = baseAlpha * f;
  }

  /** 每個物理 tick：螺旋槳對轉 + 依每 tick 位移更新視覺傾斜目標 */
  tick(): void {
    droneState.propellerRotation += 0.6;
    this.propellers.forEach((p, i) => {
      p.rotation.y = droneState.propellerRotation * (i % 2 ? 1 : -1);
    });

    // 視覺傾斜：用每 tick 位置變化量推導水平速度（手動與程式模式皆適用）
    const pos = droneState.position;
    let dx = 0;
    let dz = 0;
    if (this.prevTickPos) {
      dx = pos.x - this.prevTickPos.x;
      dz = pos.z - this.prevTickPos.z;
    }
    this.prevTickPos = { ...pos };
    const yaw = droneState.yaw;
    const f = forwardVec(yaw);
    const r = rightVec(yaw);
    const fSpeed = dx * f.x + dz * f.z; // +前進 / -後退
    const rSpeed = dx * r.x + dz * r.z; // +右飛 / -左飛
    const clamp = (v: number): number => Math.max(-1, Math.min(1, v));
    // 前進 → 機頭下壓（負 pitch）；右飛 → 右側下沉（負 roll）
    const targetPitch = -clamp(fSpeed / TILT_REFSPD) * TILT_MAX;
    const targetRoll = -clamp(rSpeed / TILT_REFSPD) * TILT_MAX;
    this.tiltPitch += (targetPitch - this.tiltPitch) * TILT_SMOOTH;
    this.tiltRoll += (targetRoll - this.tiltRoll) * TILT_SMOOTH;
  }

  /** 每個渲染幀：以插值後的位置 / yaw 更新模型（alpha 由主迴圈算好） */
  render(pos: Vector3, yaw: number): void {
    this.root.position.copyFrom(pos);
    // YXZ：先 yaw，再機身座標 pitch/roll（等同 legacy Euler 'YXZ'）
    Quaternion.RotationYawPitchRollToRef(
      yaw,
      this.tiltPitch,
      this.tiltRoll,
      this.root.rotationQuaternion as Quaternion,
    );
  }

  setVisible(v: boolean): void {
    if (this.root.isEnabled() !== v) this.root.setEnabled(v);
  }
}
