// Babylon 場景：engine / scene / 光影 / 環境（地面、格線、起飛台、雲、假陰影、軌跡線）。
// scene.useRightHandedSystem = true → 座標 / 關卡 JSON 完全沿用 legacy（機頭 -Z）。
import {
  Engine,
  Scene,
  Color3,
  Color4,
  Vector3,
  HemisphericLight,
  DirectionalLight,
  ShadowGenerator,
  MeshBuilder,
  StandardMaterial,
  HDRCubeTexture,
  Mesh,
  LinesMesh,
} from '@babylonjs/core';
import { droneState, HOME_POSITION } from '../core/droneState';
import { levelState } from '../core/level';
import { bus } from '../core/events';

export interface SceneWorld {
  engine: Engine;
  scene: Scene;
  shadowGenerator: ShadowGenerator;
  /** 每 tick 呼叫：雲漂移 + 假陰影 + 軌跡取樣 */
  tick: (nowMs: number) => void;
}

const hex = (n: number): Color3 => Color3.FromInts((n >> 16) & 255, (n >> 8) & 255, n & 255);

export const CREAFLY_COLOR = {
  primary: 0x00a3e0,
  accent: 0x1b998b,
  yellow: 0xffce00,
  dark: 0x0a2540,
  white: 0xffffff,
  ledGreen: 0x00ff66,
  ledRed: 0xff3355,
};

export { hex };

export function createSceneWorld(canvas: HTMLCanvasElement): SceneWorld {
  const engine = new Engine(canvas, true, { adaptToDeviceRatio: true });
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  scene.clearColor = Color4.FromInts(0x87, 0xce, 0xeb, 255); // 後備純色天空
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.008;
  scene.fogColor = hex(0xb0dfff);

  // HDRI 天空（載入失敗 → 靜默維持純色天空，不影響遊戲）
  try {
    const hdr = new HDRCubeTexture(
      '/assets/env/pretoria_gardens_1k.hdr',
      scene,
      128,
      false,
      true,
      false,
      true,
      () => {
        scene.environmentTexture = hdr;
        const skybox = scene.createDefaultSkybox(hdr, true, 1000, 0.04);
        // 天空不吃霧（否則遠景被霧色蓋掉、看不到 HDRI）
        if (skybox?.material && 'fogEnabled' in skybox.material) {
          (skybox.material as { fogEnabled: boolean }).fogEnabled = false;
        }
        console.log('[scene] HDRI 天空載入完成');
      },
      (msg) => console.warn('HDRI 天空載入失敗，維持純色天空：', msg),
    );
  } catch (e) {
    console.warn('HDRI 天空初始化失敗：', e);
  }

  // ---- 燈光 ----
  const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.55;
  // 幾乎正上方 → 影子投在物體正下方，好判斷位置
  const sun = new DirectionalLight('sun', new Vector3(-2, -60, -1).normalize(), scene);
  sun.position = new Vector3(2, 60, 1);
  sun.intensity = 1.0;
  const shadowGenerator = new ShadowGenerator(1024, sun);
  shadowGenerator.usePercentageCloserFiltering = true;

  // ---- 地面 ----
  const ground = MeshBuilder.CreateGround('ground', { width: 120, height: 120 }, scene);
  const groundMat = new StandardMaterial('groundMat', scene);
  groundMat.diffuseColor = hex(0x4fbe6e);
  groundMat.specularColor = new Color3(0.05, 0.05, 0.05);
  ground.material = groundMat;
  ground.receiveShadows = true;

  // 地面格線（50×50、10 格）— 幫助學生目測水平移動距離
  buildGrid(scene);

  // ---- 起飛台 ----
  const pad = MeshBuilder.CreateCylinder(
    'pad',
    { diameter: 3.6, height: 0.1, tessellation: 32 },
    scene,
  );
  pad.position.y = 0.05;
  const padMat = new StandardMaterial('padMat', scene);
  padMat.diffuseColor = hex(CREAFLY_COLOR.yellow);
  padMat.specularColor = new Color3(0.4, 0.4, 0.4);
  pad.material = padMat;
  pad.receiveShadows = true;

  // 起點指示白圈
  const startMarker = MeshBuilder.CreateTorus(
    'startMarker',
    { diameter: 1.8, thickness: 0.2, tessellation: 48 },
    scene,
  );
  startMarker.scaling.y = 0.05;
  startMarker.position.y = 0.06;
  const smMat = new StandardMaterial('smMat', scene);
  smMat.emissiveColor = Color3.White();
  smMat.disableLighting = true;
  startMarker.material = smMat;

  // ---- 雲（~20 朵，緩慢漂移）----
  const clouds: Mesh[] = [];
  const cloudMat = new StandardMaterial('cloudMat', scene);
  cloudMat.diffuseColor = Color3.White();
  cloudMat.emissiveColor = new Color3(0.55, 0.58, 0.62);
  cloudMat.alpha = 0.85;
  for (let i = 0; i < 20; i++) {
    const cloud = MeshBuilder.CreateSphere(
      `cloud${i}`,
      { diameter: (Math.random() * 2.5 + 1.5) * 2, segments: 8 },
      scene,
    );
    cloud.position.set(Math.random() * 200 - 100, Math.random() * 25 + 25, Math.random() * 200 - 100);
    cloud.scaling.y = 0.5;
    cloud.material = cloudMat;
    clouds.push(cloud);
  }

  // ---- 假陰影圓盤（半徑隨高度 0.8→2.5；正常黑 / 凍結紅 / 回家綠）----
  const groundShadow = MeshBuilder.CreateDisc('groundShadow', { radius: 1, tessellation: 32 }, scene);
  groundShadow.rotation.x = Math.PI / 2;
  groundShadow.position.y = 0.055;
  const gsMat = new StandardMaterial('gsMat', scene);
  gsMat.emissiveColor = hex(0x222222);
  gsMat.disableLighting = true;
  gsMat.alpha = 0.35;
  gsMat.backFaceCulling = false;
  gsMat.disableDepthWrite = true;
  groundShadow.material = gsMat;

  // ---- 飛行軌跡線（每 100ms 或 0.3m 取樣，CreateLines 定期重建）----
  const TRAIL_MAX = 100;
  let trailPoints: Vector3[] = [];
  let trailLastSample = 0;
  let trailLine: LinesMesh | null = null;

  function rebuildTrail(): void {
    if (trailLine) trailLine.dispose();
    trailLine = null;
    if (trailPoints.length < 2) return;
    trailLine = MeshBuilder.CreateLines('trail', { points: trailPoints, updatable: false }, scene);
    trailLine.color = hex(0x66ccff);
    trailLine.alpha = 0.7;
    trailLine.isPickable = false;
  }

  bus.on('trail-clear', () => {
    trailPoints = [];
    rebuildTrail();
  });

  function tick(nowMs: number): void {
    // 雲漂
    clouds.forEach((c, i) => {
      c.position.x += Math.sin(nowMs * 0.0008 + i) * 0.02;
      c.position.z += Math.cos(nowMs * 0.0008 + i) * 0.02;
    });

    // 假陰影
    const p = droneState.position;
    groundShadow.position.x = p.x;
    groundShadow.position.z = p.z;
    const r = Math.max(0.8, Math.min(2.5, 0.8 + p.y * 0.1));
    groundShadow.scaling.set(r, r, 1);
    if (droneState.frozen) gsMat.emissiveColor = hex(0xff4444);
    else if (droneState.returning) gsMat.emissiveColor = hex(0x44ff44);
    else gsMat.emissiveColor = hex(0x222222);

    // 軌跡取樣（畫畫教室不畫淡藍飛行軌跡 — 會跟彩色墨水線打架，只留墨水）
    if (
      droneState.isFlying &&
      !droneState.frozen &&
      !droneState.returning &&
      !levelState.current?.draw
    ) {
      if (nowMs - trailLastSample > 100) {
        const last = trailPoints[trailPoints.length - 1];
        if (!last || Vector3.Distance(last, new Vector3(p.x, p.y, p.z)) > 0.3) {
          trailPoints.push(new Vector3(p.x, p.y, p.z));
          if (trailPoints.length > TRAIL_MAX) trailPoints.shift();
          trailLastSample = nowMs;
          rebuildTrail();
        }
      }
    }
  }

  // 讓假陰影不會蓋掉起飛台圓圈以外的東西
  void HOME_POSITION;

  return { engine, scene, shadowGenerator, tick };
}

function buildGrid(scene: Scene): void {
  const size = 50;
  const divisions = 10;
  const step = size / divisions;
  const half = size / 2;
  const lines: Vector3[][] = [];
  for (let i = 0; i <= divisions; i++) {
    const v = -half + i * step;
    lines.push([new Vector3(v, 0.01, -half), new Vector3(v, 0.01, half)]);
    lines.push([new Vector3(-half, 0.01, v), new Vector3(half, 0.01, v)]);
  }
  const grid = MeshBuilder.CreateLineSystem('grid', { lines }, scene);
  grid.color = hex(0x4dd0e1);
  grid.alpha = 0.6;
  grid.isPickable = false;
}
