// ⚽ 足球視覺：室內護網球館、護罩機、吊掛發光圓環、雙面計分板、撞擊／進球特效。
// 門框碰撞仍用同一顆 torus（內徑 70cm、厚度 20cm）烤進 Havok，不改判定。
// 場地尺寸一律讀 soccer/field.ts 的生效值。
import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  DynamicTexture,
  Color3,
  Color4,
  Vector3,
  TransformNode,
  DirectionalLight,
  HemisphericLight,
  PointLight,
  ShadowGenerator,
  type AbstractMesh,
} from '@babylonjs/core';
import { bus, toast } from '../core/events';
import { droneState, DRONE_RADIUS, type Vec3 } from '../core/droneState';
import { setMeshCollisionBackend } from '../core/physics';
import {
  SOCCER_BALL_R,
  SOCCER_START_DEPTH,
  SOCCER_START_WIDTH,
  SOCCER_TEAM_COLORS,
  soccerGoalTorusDiameter,
  soccerGoalTorusThickness,
} from '../soccer/constants';
import {
  readBroadcast,
  readPracticeBroadcast,
  soccerGuardColor,
  type BroadcastView,
} from '../soccer/broadcast';
import { activeSoccerField } from '../soccer/field';
import { soccerState, type SoccerOther } from '../multiplayer/soccer';
import { practiceState } from '../soccer/practice';
import { getHavokBackend, type HavokBackend } from './havokBackend';
import { bakeTriangleSoup } from './playground';
import { makeNameLabel } from './clones';
import { hex } from './scene';
import type { DroneVisual } from './drone';
import { createSoccerDrone, type SoccerDroneModel } from './soccerDrone';
import { createSoccerScoreboard, stretchScoreboardRods, type SoccerScoreboard } from './soccerScoreboard';
import { setSoccerArenaAudio } from '../ui/audio';
import { setSoccerEndScreen, setSoccerFlag } from '../ui/soccerHud';

const CLONE_LABEL_Y = 0.34;

type SoccerVariant = 'practice' | 'match';

interface SoccerCloneVisual {
  root: TransformNode;
  model: SoccerDroneModel;
  appliedTeam: string | null;
  appliedStriker: boolean;
}

interface Spark {
  mesh: Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
}

interface GoalVisual {
  z: number;
  color: number;
  mat: StandardMaterial;
  baseEmissive: Color3;
}

interface SavedOutdoor {
  clear: Color4;
  fogDensity: number;
  fogColor: Color3;
  sunPos: Vector3;
  sunDir: Vector3;
  sunInt: number;
  hemiInt: number;
  hemiDiffuse: Color3;
  hemiGround: Color3;
  darkness: number;
}

function previewKind(): string | null {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').get('phase3preview');
  } catch {
    return null;
  }
}

export class SoccerFieldVisuals {
  private readonly scene: Scene;
  private readonly drone: DroneVisual;
  private readonly backend: HavokBackend;
  private readonly shadows: ShadowGenerator | null;
  private fieldMeshes: Mesh[] = [];
  private dummyMeshes: Mesh[] = [];
  private goalMeshes: Mesh[] = [];
  private goals: GoalVisual[] = [];
  private myDrone: SoccerDroneModel | null = null;
  private scoreboard: SoccerScoreboard | null = null;
  private lights: PointLight[] = [];
  private sharedBall: Mesh | null = null;
  private sharedBallMat: StandardMaterial | null = null;
  private sharedBallR = 0;
  private sharedBallGlow = 0;
  private clones = new Map<string, SoccerCloneVisual>();
  private sparks: Spark[] = [];
  private active = false;
  private variant: SoccerVariant = 'practice';
  private collisionReady = false;
  private generation = 0;
  private savedOutdoor: SavedOutdoor | null = null;
  private hiddenOutdoor: { mesh: AbstractMesh; was: boolean }[] = [];
  private outdoorSweep = 0;
  private goalFlashUntil = 0;
  private goalFlashZ = 0;
  private preview: string | null = null;
  private previewHeld = false;
  private previewBurstTick = 0;
  private casters: Mesh[] = [];

  constructor(scene: Scene, drone: DroneVisual, shadows: ShadowGenerator | null = null) {
    this.scene = scene;
    this.drone = drone;
    this.shadows = shadows;
    this.backend = getHavokBackend(scene);
    bus.on('soccer-entered', ({ variant }) => this.build(variant));
    bus.on('soccer-exited', () => this.disposeAll());
    bus.on('soccer-dummies-changed', ({ boxes }) => this.buildDummies(boxes));
    bus.on('soccer-field-changed', () => {
      if (this.active) this.build(this.variant);
    });
    bus.on('sound', ({ name }) => {
      if (!this.active) return;
      if (name === 'ring') this.burstGoal();
      else if (name === 'bump') this.burstHit();
    });

    const debug = (window as unknown as Record<string, unknown>).__creaflySoccer as
      | Record<string, unknown>
      | undefined;
    const api = {
      ...(debug ?? {}),
      collisionReady: () => this.collisionReady,
      probe: (x: number, y: number, z: number): { pos: Vec3; bumped: boolean } => {
        const pos = { x, y, z };
        const vel = { x: 0, y: 0, z: 0 };
        const { bumped } = this.backend.resolveCollisions(pos, vel, SOCCER_BALL_R);
        return { pos, bumped };
      },
      burstGoal: () => this.burstGoal(),
      burstHit: () => this.burstHit(),
    };
    (window as unknown as Record<string, unknown>).__creaflySoccer = api;
  }

  // ---------------------------------------------------------------------------
  // 場地
  // ---------------------------------------------------------------------------
  private build(variant: SoccerVariant): void {
    this.disposeAll();
    this.active = true;
    this.variant = variant;
    this.preview = previewKind();
    this.previewHeld = false;
    const gen = ++this.generation;
    const scene = this.scene;
    const F = activeSoccerField();
    this.drone.setScaleFactor(1);
    this.drone.setForceHidden(true);
    this.setDefaultGroundVisible(false);
    this.enterIndoor();
    setSoccerArenaAudio(true);

    this.buildTurf();
    this.buildFrameAndNets();
    this.buildMarkings(variant);
    if (variant === 'match') {
      this.buildStartZone(-1, SOCCER_TEAM_COLORS.blue);
      this.buildStartZone(1, SOCCER_TEAM_COLORS.red);
    } else {
      this.buildStartZone(1, SOCCER_TEAM_COLORS.blue);
      this.buildStartZone(-1, SOCCER_TEAM_COLORS.red);
    }

    const farColor = variant === 'match' ? SOCCER_TEAM_COLORS.blue : SOCCER_TEAM_COLORS.red;
    const nearColor = variant === 'match' ? SOCCER_TEAM_COLORS.red : SOCCER_TEAM_COLORS.blue;
    this.goalMeshes = [this.makeGoalRing(-F.goalZ, farColor), this.makeGoalRing(F.goalZ, nearColor)];
    this.fieldMeshes.push(...this.goalMeshes);
    this.hangGoal(-F.goalZ);
    this.hangGoal(F.goalZ);
    void this.registerGoalCollision(gen);

    this.myDrone = createSoccerDrone(scene, 'me', SOCCER_BALL_R, this.shadows);
    this.myDrone.pose(
      droneState.position.x,
      droneState.position.y,
      droneState.position.z,
      droneState.yaw,
      0,
      0,
      0,
    );

    const boardY = Math.min(F.top - 1.15, F.goalY + 0.55);
    this.scoreboard = createSoccerScoreboard(scene, boardY);
    stretchScoreboardRods(this.scoreboard.root, F.top - 0.05);
    this.syncBroadcast();
  }

  /** 草皮：深草綠割紋＋細葉，整面鋪一次，不要淺色或發白 */
  private buildTurf(): void {
    const F = activeSoccerField();
    const floor = MeshBuilder.CreateGround(
      'soccerFloor',
      { width: F.halfX * 2, height: F.halfZ * 2 },
      this.scene,
    );
    floor.position.y = 0.02;
    const mat = new StandardMaterial('soccerFloorMat', this.scene);
    const size = 512;
    const tex = new DynamicTexture('soccerGrass', { width: size, height: size }, this.scene, false);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    const stripes = 8;
    for (let i = 0; i < stripes; i++) {
      const x0 = Math.floor((i * size) / stripes);
      const x1 = Math.floor(((i + 1) * size) / stripes);
      ctx.fillStyle = i % 2 === 0 ? '#145228' : '#1c6434';
      ctx.fillRect(x0, 0, x1 - x0, size);
      ctx.fillStyle = 'rgba(8,36,16,0.45)';
      ctx.fillRect(x1 - 2, 0, 2, size);
    }
    for (let i = 0; i < 3200; i++) {
      const x = (i * 73) % size;
      const y = (i * 137) % size;
      const band = Math.floor((x * stripes) / size) % 2;
      const g = (band ? 86 : 70) + (i % 18);
      ctx.fillStyle = `rgba(${14 + (i % 9)},${g},${18 + (i % 7)},0.4)`;
      ctx.fillRect(x, y, 1 + (i % 2), 4 + (i % 5));
    }
    tex.update();
    tex.uScale = 1;
    tex.vScale = 1;
    mat.diffuseTexture = tex;
    mat.specularColor = new Color3(0.03, 0.04, 0.03);
    floor.material = mat;
    floor.receiveShadows = true;
    this.fieldMeshes.push(floor);
  }

  /** 球館用的實色材質（護墊、鋼架、色塊）。不改碰撞。 */
  private gymMat(name: string, color: number, emissiveScale: number, spec: number): StandardMaterial {
    const mat = new StandardMaterial(name, this.scene);
    const c = hex(color);
    mat.diffuseColor = c;
    mat.emissiveColor = c.scale(emissiveScale);
    mat.specularColor = new Color3(spec, spec, spec);
    return mat;
  }

  /** 軟墊框架＋網＋鋼架。網在框架內側，天花板封起來。尺寸沿用場地生效值。 */
  private buildFrameAndNets(): void {
    const F = activeSoccerField();
    const scene = this.scene;
    // 鋼架與外殼以色塊自發光為主、漫反射壓低，避免燈一照就整片過曝成白
    const steel = this.gymMat('soccerSteel', 0x7a8da3, 0.62, 0.12);
    steel.diffuseColor = hex(0x24303c);

    const darkMat = new StandardMaterial('soccerShellMat', scene);
    darkMat.diffuseColor = hex(0x121820);
    darkMat.specularColor = new Color3(0.03, 0.03, 0.04);
    darkMat.emissiveColor = hex(0x3a4c60);

    const addBox = (
      name: string,
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
      mat: StandardMaterial,
      cast = true,
    ): Mesh => {
      const m = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
      m.position.set(x, y, z);
      m.material = mat;
      m.isPickable = false;
      if (cast) this.cast(m);
      this.fieldMeshes.push(m);
      return m;
    };

    const corners: Array<[number, number]> = [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ];
    for (const [sx, sz] of corners) {
      const post = MeshBuilder.CreateCylinder(
        `soccerPost-${sx}-${sz}`,
        { diameter: 0.28, height: F.top, tessellation: 12 },
        scene,
      );
      post.position.set(sx * F.halfX, F.top / 2, sz * F.halfZ);
      post.material = steel;
      post.isPickable = false;
      this.cast(post);
      this.fieldMeshes.push(post);
    }

    const beamT = 0.16;
    const ys = [beamT / 2, F.top * 0.5, F.top - beamT / 2];
    for (const y of ys) {
      addBox('soccerBeamX', F.halfX * 2, beamT, beamT, 0, y, -F.halfZ, steel);
      addBox('soccerBeamX', F.halfX * 2, beamT, beamT, 0, y, F.halfZ, steel);
      addBox('soccerBeamZ', beamT, beamT, F.halfZ * 2, -F.halfX, y, 0, steel);
      addBox('soccerBeamZ', beamT, beamT, F.halfZ * 2, F.halfX, y, 0, steel);
    }

    // 兩側護墊：+X 偏紅、-X 偏藍，下緣深、中間一條淺色，不要一片亮白
    this.addSidePad(1, 0x8c2e34, 0xc46a64, 0x4c1e22);
    this.addSidePad(-1, 0x2a4c86, 0x6e96c8, 0x16243f);
    const skirt = this.gymMat('soccerEndSkirt', 0x2c333c, 0.14, 0.05);
    const skirtLen = F.halfX * 2 - 0.55;
    addBox('soccerEndSkirt', skirtLen, 1.05, 0.12, 0, 0.68, -F.halfZ + 0.1, skirt, false);
    addBox('soccerEndSkirt', skirtLen, 1.05, 0.12, 0, 0.68, F.halfZ - 0.1, skirt, false);
    this.addEndBlocks(-1, [0x1e4f92, 0xb83a34, 0x243044, 0xd4cbb8, 0x1e4f92]);
    this.addEndBlocks(1, [0xb83a34, 0x243044, 0x1e4f92, 0xd4cbb8, 0xb83a34]);

    // 外殼深色擋板（網後面），避免看到戶外天空
    const shellA = 0.02;
    addBox('soccerShell', F.halfX * 2, F.top, shellA, 0, F.top / 2, -F.halfZ - 0.08, darkMat, false);
    addBox('soccerShell', F.halfX * 2, F.top, shellA, 0, F.top / 2, F.halfZ + 0.08, darkMat, false);
    addBox('soccerShell', shellA, F.top, F.halfZ * 2, -F.halfX - 0.08, F.top / 2, 0, darkMat, false);
    addBox('soccerShell', shellA, F.top, F.halfZ * 2, F.halfX + 0.08, F.top / 2, 0, darkMat, false);
    // 天花板單獨用藍灰、不吃光，避免燈一弱就整片死黑
    const ceilMat = new StandardMaterial('soccerCeilMat', scene);
    ceilMat.diffuseColor = hex(0x7e96ae);
    ceilMat.emissiveColor = hex(0x7e96ae);
    ceilMat.specularColor = Color3.Black();
    ceilMat.disableLighting = true;
    ceilMat.backFaceCulling = false;
    const ceil = addBox('soccerCeil', F.halfX * 2, 0.08, F.halfZ * 2, 0, F.top - 0.02, 0, ceilMat, false);
    ceil.receiveShadows = false;

    const inset = 0.2;
    const cell = 0.18;
    const netY = 1.28;
    const netH = F.top - netY - 0.2;
    const netLo = new Color3(0.4, 0.44, 0.48);
    const netHi = new Color3(0.12, 0.14, 0.18);
    this.addSplitNet(
      'soccerNetFar',
      new Vector3(-F.halfX + inset, netY, -F.halfZ + 0.05),
      new Vector3((F.halfX - inset) * 2, 0, 0),
      netH,
      Math.round(((F.halfX - inset) * 2) / cell),
      netLo,
      netHi,
    );
    this.addSplitNet(
      'soccerNetNear',
      new Vector3(-F.halfX + inset, netY, F.halfZ - 0.05),
      new Vector3((F.halfX - inset) * 2, 0, 0),
      netH,
      Math.round(((F.halfX - inset) * 2) / cell),
      netLo,
      netHi,
    );
    this.addSplitNet(
      'soccerNetLeft',
      new Vector3(-F.halfX + 0.05, netY, -F.halfZ + inset),
      new Vector3(0, 0, (F.halfZ - inset) * 2),
      netH,
      Math.round(((F.halfZ - inset) * 2) / cell),
      netLo,
      netHi,
    );
    this.addSplitNet(
      'soccerNetRight',
      new Vector3(F.halfX - 0.05, netY, -F.halfZ + inset),
      new Vector3(0, 0, (F.halfZ - inset) * 2),
      netH,
      Math.round(((F.halfZ - inset) * 2) / cell),
      netLo,
      netHi,
    );
    this.addNet(
      'soccerNetCeil',
      new Vector3(-F.halfX + inset, F.top - 0.16, -F.halfZ + inset),
      new Vector3((F.halfX - inset) * 2, 0, 0),
      new Vector3(0, 0, (F.halfZ - inset) * 2),
      Math.round(((F.halfX - inset) * 2) / cell),
      Math.round(((F.halfZ - inset) * 2) / cell),
      new Color3(0.55, 0.62, 0.7),
      0.55,
    );

    this.addCeilingTruss();

    // 燈具掛在鋼架下方：藍灰燈殼（不吃光，避免變成黑塊）＋朝下的亮燈片
    const housing = new StandardMaterial('soccerLampHouseMat', scene);
    housing.diffuseColor = hex(0xb7c6d4);
    housing.emissiveColor = hex(0xb7c6d4);
    housing.specularColor = Color3.Black();
    housing.disableLighting = true;
    const lampMat = new StandardMaterial('soccerLampMat', scene);
    lampMat.emissiveColor = hex(0xfff6df);
    lampMat.disableLighting = true;
    for (const t of [-0.62, -0.2, 0.2, 0.62]) {
      const z = t * F.halfZ;
      addBox('soccerLampHouse', 1.25, 0.1, 0.48, 0, F.top - 0.7, z, housing, false);
      const lamp = MeshBuilder.CreateBox(
        `soccerLamp-${z}`,
        { width: 1.02, height: 0.04, depth: 0.32 },
        scene,
      );
      lamp.position.set(0, F.top - 0.76, z);
      lamp.material = lampMat;
      lamp.isPickable = false;
      this.fieldMeshes.push(lamp);
      const light = new PointLight(`soccerLight-${z}`, new Vector3(0, F.top - 0.9, z), scene);
      light.diffuse = hex(0xfff3e4);
      light.specular = hex(0x4a453e);
      light.intensity = 2.4;
      light.range = 9;
      this.lights.push(light);
    }
  }

  /** 長邊護墊。sign +1 為 +X。只是外觀，不進碰撞。 */
  private addSidePad(sign: number, main: number, stripe: number, cap: number): void {
    const F = activeSoccerField();
    const x = sign * (F.halfX - 0.06);
    const len = F.halfZ * 2 - 0.7;
    const mainMat = this.gymMat(`soccerPad-${sign}`, main, 0.18, 0.06);
    const stripeMat = this.gymMat(`soccerPadStripe-${sign}`, stripe, 0.28, 0.08);
    const capMat = this.gymMat(`soccerPadCap-${sign}`, cap, 0.1, 0.04);
    const add = (
      name: string,
      w: number,
      h: number,
      d: number,
      px: number,
      py: number,
      pz: number,
      mat: StandardMaterial,
      cast = true,
    ): void => {
      const m = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, this.scene);
      m.position.set(px, py, pz);
      m.material = mat;
      m.isPickable = false;
      if (cast) this.cast(m);
      this.fieldMeshes.push(m);
    };
    add('soccerSidePad', 0.16, 1.05, len, x, 0.68, 0, mainMat);
    add('soccerSideStripe', 0.05, 0.16, len - 0.15, x - sign * 0.09, 0.78, 0, stripeMat, false);
    add('soccerSideCap', 0.18, 0.08, len, x, 1.24, 0, capMat);
  }

  /** 端牆色塊（球館內牆，不是戶外天空，也不是廣告字） */
  private addEndBlocks(sign: number, colors: number[]): void {
    const F = activeSoccerField();
    const gap = 0.1;
    const span = F.halfX * 2 - 0.9;
    const bw = (span - gap * (colors.length - 1)) / colors.length;
    let x = -span / 2 + bw / 2;
    const z = sign * (F.halfZ - 0.16);
    colors.forEach((color, i) => {
      const mat = this.gymMat(`soccerEndBlock-${sign}-${i}`, color, 0.2, 0.05);
      const m = MeshBuilder.CreateBox(
        `soccerEndBlock-${sign}-${i}`,
        { width: bw, height: 2.05, depth: 0.06 },
        this.scene,
      );
      m.position.set(x, 2.55, z);
      m.material = mat;
      m.isPickable = false;
      this.fieldMeshes.push(m);
      x += bw + gap;
    });
  }

  /** 天花板藍灰鋼架。不吃光，掛在燈的上方，從場內就看得到格子。 */
  private addCeilingTruss(): void {
    const F = activeSoccerField();
    const trussMat = new StandardMaterial('soccerTrussMat', this.scene);
    trussMat.diffuseColor = hex(0xe4edf4);
    trussMat.emissiveColor = hex(0xe4edf4);
    trussMat.specularColor = Color3.Black();
    trussMat.disableLighting = true;
    const y = F.top - 0.42;
    const add = (name: string, w: number, h: number, d: number, x: number, py: number, z: number): void => {
      const m = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, this.scene);
      m.position.set(x, py, z);
      m.material = trussMat;
      m.isPickable = false;
      this.fieldMeshes.push(m);
    };
    for (const t of [-0.72, -0.36, 0, 0.36, 0.72]) {
      add('soccerTrussZ', 0.22, 0.16, F.halfZ * 2 - 0.45, t * F.halfX, y, 0);
    }
    for (const t of [-0.78, -0.52, -0.26, 0, 0.26, 0.52, 0.78]) {
      add('soccerTrussX', F.halfX * 2 - 0.3, 0.14, 0.22, 0, y - 0.12, t * F.halfZ);
    }
  }

  /** 牆網分上下兩段：下方網紋還在，上方再暗一階 */
  private addSplitNet(
    name: string,
    origin: Vector3,
    axisU: Vector3,
    height: number,
    cellsU: number,
    lower: Color3,
    upper: Color3,
  ): void {
    const cell = 0.18;
    const mid = height * 0.45;
    this.addNet(name + 'Lo', origin, axisU, new Vector3(0, mid, 0), cellsU, Math.max(2, Math.round(mid / cell)), lower, 0.84);
    const hi = origin.add(new Vector3(0, mid, 0));
    this.addNet(
      name + 'Hi',
      hi,
      axisU,
      new Vector3(0, height - mid, 0),
      cellsU,
      Math.max(2, Math.round((height - mid) / cell)),
      upper,
      0.92,
    );
  }

  private addNet(
    name: string,
    origin: Vector3,
    axisU: Vector3,
    axisV: Vector3,
    cellsU: number,
    cellsV: number,
    color: Color3,
    alpha: number,
  ): void {
    const lines: Vector3[][] = [];
    const cu = Math.max(2, cellsU);
    const cv = Math.max(2, cellsV);
    for (let i = 0; i <= cu; i++) {
      const a = origin.add(axisU.scale(i / cu));
      lines.push([a, a.add(axisV)]);
    }
    for (let j = 0; j <= cv; j++) {
      const a = origin.add(axisV.scale(j / cv));
      lines.push([a, a.add(axisU)]);
    }
    const g = MeshBuilder.CreateLineSystem(name, { lines }, this.scene);
    g.color = color;
    g.alpha = alpha;
    g.isPickable = false;
    this.fieldMeshes.push(g);
  }

  private buildMarkings(variant: SoccerVariant): void {
    const F = activeSoccerField();
    const scene = this.scene;
    const lineMat = new StandardMaterial('soccerLineMat', scene);
    lineMat.emissiveColor = hex(0xd2d8d0);
    lineMat.disableLighting = true;
    lineMat.alpha = 0.9;
    const strip = (name: string, w: number, d: number, x: number, z: number): void => {
      const m = MeshBuilder.CreateGround(name, { width: w, height: d }, scene);
      m.position.set(x, 0.045, z);
      m.material = lineMat;
      m.isPickable = false;
      this.fieldMeshes.push(m);
    };
    const t = 0.08;
    const width = F.halfX * 2 - 0.7;
    const length = F.halfZ * 2 - 0.7;
    strip('soccerLineN', width, t, 0, -length / 2);
    strip('soccerLineS', width, t, 0, length / 2);
    strip('soccerLineW', t, length, -width / 2, 0);
    strip('soccerLineE', t, length, width / 2, 0);
    strip('soccerMidLine', width, variant === 'match' ? 0.1 : 0.12, 0, 0);

    const spot = MeshBuilder.CreateCylinder(
      'soccerCenterSpot',
      { diameter: 0.36, height: 0.01, tessellation: 20 },
      scene,
    );
    spot.position.set(0, 0.05, 0);
    spot.material = lineMat;
    spot.isPickable = false;
    this.fieldMeshes.push(spot);

    const circle = MeshBuilder.CreateTorus(
      'soccerCenterCircle',
      { diameter: 2.4, thickness: 0.08, tessellation: 40 },
      scene,
    );
    circle.scaling.y = 0.06;
    circle.position.y = 0.05;
    circle.material = lineMat;
    circle.isPickable = false;
    this.fieldMeshes.push(circle);

    if (variant === 'match') {
      (
        [
          ['blue', -1],
          ['red', 1],
        ] as const
      ).forEach(([team, s]) => {
        const half = MeshBuilder.CreateGround(
          `soccerHalf-${team}`,
          { width: F.halfX * 2, height: F.halfZ },
          scene,
        );
        half.position.set(0, 0.03, (s * F.halfZ) / 2);
        const hm = new StandardMaterial(`soccerHalfMat-${team}`, scene);
        hm.emissiveColor = hex(SOCCER_TEAM_COLORS[team]);
        hm.disableLighting = true;
        hm.alpha = 0.06;
        half.material = hm;
        half.isPickable = false;
        this.fieldMeshes.push(half);
      });
    }
  }

  private buildStartZone(sign: number, color: number): void {
    const F = activeSoccerField();
    const w = SOCCER_START_WIDTH;
    const d = SOCCER_START_DEPTH;
    const centerZ = sign * (F.halfZ - d / 2);
    const fill = MeshBuilder.CreateGround(`soccerStart-${centerZ}`, { width: w, height: d }, this.scene);
    fill.position.set(0, 0.05, centerZ);
    const mat = new StandardMaterial(`soccerStartMat-${centerZ}`, this.scene);
    mat.emissiveColor = hex(color);
    mat.disableLighting = true;
    mat.alpha = 0.22;
    fill.material = mat;
    fill.isPickable = false;
    this.fieldMeshes.push(fill);

    const hw = w / 2;
    const hd = d / 2;
    const y = 0.07;
    const border = MeshBuilder.CreateLines(
      `soccerStartLine-${centerZ}`,
      {
        points: [
          new Vector3(-hw, y, centerZ - hd),
          new Vector3(hw, y, centerZ - hd),
          new Vector3(hw, y, centerZ + hd),
          new Vector3(-hw, y, centerZ + hd),
          new Vector3(-hw, y, centerZ - hd),
        ],
      },
      this.scene,
    );
    border.color = hex(color);
    border.isPickable = false;
    this.fieldMeshes.push(border);
  }

  /**
   * 圓環本體維持階段一尺寸（洞 70cm、管厚 20cm），材質改成軟墊發光。
   * 這顆 mesh 會烤進碰撞，幾何不要改。
   */
  private makeGoalRing(z: number, color: number): Mesh {
    const F = activeSoccerField();
    const ring = MeshBuilder.CreateTorus(
      `soccerGoal-${z}`,
      {
        diameter: soccerGoalTorusDiameter(F.goalR, F.goalTube),
        thickness: soccerGoalTorusThickness(F.goalTube),
        tessellation: 32,
      },
      this.scene,
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, F.goalY, z);
    const mat = new StandardMaterial(`soccerGoalMat-${z}`, this.scene);
    const c = hex(color);
    mat.diffuseColor = c;
    mat.emissiveColor = c.scale(0.92);
    mat.specularColor = new Color3(0.5, 0.5, 0.5);
    ring.material = mat;
    ring.receiveShadows = true;
    this.cast(ring);
    this.goals.push({ z, color, mat, baseEmissive: c.scale(0.92) });
    return ring;
  }

  /** 從天花板垂兩條吊帶，不進碰撞網格 */
  private hangGoal(z: number): void {
    const F = activeSoccerField();
    const scene = this.scene;
    const strapMat = new StandardMaterial(`soccerStrapMat-${z}`, scene);
    strapMat.diffuseColor = hex(0x6a7c90);
    strapMat.specularColor = new Color3(0.28, 0.3, 0.34);
    strapMat.emissiveColor = hex(0x4a5c6e).scale(0.25);
    const top = F.goalY + F.goalR + F.goalTube * 2;
    const drop = F.top - 0.05 - top;
    for (const x of [-0.28, 0.28]) {
      const strap = MeshBuilder.CreateCylinder(
        `soccerStrap-${z}-${x}`,
        { diameter: 0.025, height: Math.max(0.2, drop), tessellation: 8 },
        scene,
      );
      strap.position.set(x, top + drop / 2, z);
      strap.material = strapMat;
      strap.isPickable = false;
      this.fieldMeshes.push(strap);
    }
    const bar = MeshBuilder.CreateBox(
      `soccerStrapBar-${z}`,
      { width: 0.7, height: 0.04, depth: 0.08 },
      scene,
    );
    bar.position.set(0, F.top - 0.06, z);
    bar.material = strapMat;
    bar.isPickable = false;
    this.fieldMeshes.push(bar);
  }

  private async registerGoalCollision(gen: number): Promise<void> {
    try {
      await this.backend.init();
    } catch (e) {
      console.warn('[Soccer] Havok WASM 載入失敗，門框暫時可穿過：', e);
      toast('⚠ 碰撞引擎載入失敗 — 門框暫時可穿過', 'warning');
      return;
    }
    if (gen !== this.generation || !this.active) return;
    const soup = bakeTriangleSoup(this.goalMeshes);
    if (!soup) return;
    this.backend.addStaticMesh('soccer-goals', soup.positions, soup.indices);
    setMeshCollisionBackend(this.backend, SOCCER_BALL_R);
    this.collisionReady = true;
  }

  private buildDummies(boxes: { x: number; y: number; z: number; half: number }[]): void {
    this.dummyMeshes.forEach((m) => m.dispose(false, true));
    this.dummyMeshes = boxes.map((b, i) => {
      const m = MeshBuilder.CreateBox(`soccerDummy-${i}`, { size: b.half * 2 }, this.scene);
      m.position.set(b.x, b.y, b.z);
      const mat = new StandardMaterial(`soccerDummyMat-${i}`, this.scene);
      mat.diffuseColor = hex(0x9b5de5);
      mat.emissiveColor = hex(0x9b5de5).scale(0.2);
      mat.alpha = 0.9;
      m.material = mat;
      m.isPickable = false;
      return m;
    });
  }

  // ---------------------------------------------------------------------------
  // 每 tick／每幀
  // ---------------------------------------------------------------------------
  tick(): void {
    if (!this.active) return;
    this.outdoorSweep++;
    if (this.outdoorSweep % 20 === 1) this.hideOutdoorMeshes();
    this.holdPreviewPose();
    this.stepSparks();
    this.stepGoalFlash();
    this.syncBroadcast();
    if (this.preview && (this.preview === '1' || this.preview === 'goal')) {
      this.previewBurstTick++;
      if (this.previewBurstTick === 25 || this.previewBurstTick % 140 === 0) this.burstGoal();
    }

    if (!soccerState.active) return;
    this.syncClones();
    this.syncSharedBall();
    for (const [id, c] of this.clones) {
      const o = soccerState.others.get(id);
      if (!o) continue;
      if (o.hasPos) c.model.pose(o.pos.x, o.pos.y, o.pos.z, o.pos.yaw, 0, 0, droneState.propellerRotation);
      const striker = soccerState.mode === 'striker' && o.striker;
      if (c.appliedTeam !== o.team || c.appliedStriker !== striker) {
        c.appliedTeam = o.team;
        c.appliedStriker = striker;
        const team = o.team === 'red' || o.team === 'blue' ? o.team : null;
        c.model.setGuardColor(soccerGuardColor(team, striker));
      }
    }
  }

  /** 插值後的自機姿態（主迴圈在渲染前呼叫） */
  present(x: number, y: number, z: number, yaw: number, visible: boolean): void {
    if (!this.active || !this.myDrone) return;
    const pitch = -(droneState.attitudePitch ?? 0);
    const roll = -(droneState.attitudeRoll ?? 0);
    this.myDrone.pose(x, y, z, yaw, pitch, roll, droneState.propellerRotation);
    this.myDrone.setEnabled(visible);
  }

  private holdPreviewPose(): void {
    if (!this.preview || this.previewHeld) return;
    this.previewHeld = true;
    droneState.position.x = 0.35;
    droneState.position.y = 1.65;
    droneState.position.z = 0.8;
    droneState.velocity.x = 0;
    droneState.velocity.y = 0;
    droneState.velocity.z = 0;
    droneState.yaw = 0;
    droneState.isFlying = true;
    droneState.isGrounded = false;
  }

  private syncBroadcast(): void {
    const view = this.broadcastView();
    this.scoreboard?.update(view);
    setSoccerFlag(view.flag);
    setSoccerEndScreen({
      show: view.ended,
      title: view.title,
      detail: view.detail,
    });
    if (!this.myDrone) return;
    if (soccerState.active) {
      const team = soccerState.myTeam === 'red' || soccerState.myTeam === 'blue' ? soccerState.myTeam : null;
      const striker = soccerState.mode === 'striker' && soccerState.myStriker;
      this.myDrone.setGuardColor(soccerGuardColor(team, striker));
    } else {
      this.myDrone.setGuardColor(soccerGuardColor('blue', true));
    }
  }

  private broadcastView(): BroadcastView {
    if (this.preview === 'end') {
      return readBroadcast({
        status: 'done',
        mode: 'striker',
        scores: { blue: 3, red: 2 },
        sets: { blue: 2, red: 1 },
        period: 3,
        endTime: 0,
        now: 0,
        myTeam: 'blue',
        myStriker: true,
        needReturn: false,
      });
    }
    if (this.preview) {
      return readBroadcast({
        status: 'running',
        mode: 'striker',
        scores: { blue: 2, red: 1 },
        sets: { blue: 1, red: 0 },
        period: 2,
        endTime: Date.now() + 95_000,
        now: Date.now(),
        myTeam: 'blue',
        myStriker: true,
        needReturn: this.preview === 'return',
      });
    }
    if (soccerState.active) {
      const team = soccerState.myTeam;
      return readBroadcast({
        status: soccerState.status,
        mode: soccerState.mode,
        scores: soccerState.scores,
        sets: soccerState.sets,
        period: soccerState.period,
        endTime: soccerState.endTime,
        now: Date.now(),
        myTeam: team,
        myStriker: soccerState.myStriker,
        needReturn: !!team && soccerState.armed[team] === false,
        pkScores: soccerState.pkScores,
      });
    }
    const drill = practiceState.drill;
    const elapsed = practiceState.startTime ? (Date.now() - practiceState.startTime) / 1000 : 0;
    return readPracticeBroadcast({
      running: practiceState.status === 'running',
      goals: practiceState.count,
      elapsedSec: elapsed,
      needReturn: drill?.type === 'shuttle' && !practiceState.shuttleReturned && practiceState.count > 0,
      scoredDrill: drill?.type === 'pass' || drill?.type === 'shuttle',
    });
  }

  private syncClones(): void {
    for (const [id, o] of soccerState.others) {
      if (!this.clones.has(id)) this.clones.set(id, this.makeClone(id, o));
    }
    for (const [id, c] of this.clones) {
      if (!soccerState.others.has(id)) {
        c.model.dispose();
        this.clones.delete(id);
      }
    }
  }

  private makeClone(id: string, o: SoccerOther): SoccerCloneVisual {
    const team = o.team === 'red' || o.team === 'blue' ? o.team : null;
    const striker = soccerState.mode === 'striker' && o.striker;
    const model = createSoccerDrone(this.scene, id, SOCCER_BALL_R, this.shadows);
    model.setGuardColor(soccerGuardColor(team, striker));
    const label = makeNameLabel(this.scene, `${o.emoji || ''}${o.name || '?'}`);
    label.scaling.setAll(0.22);
    label.position.y = CLONE_LABEL_Y;
    label.parent = model.root;
    if (o.hasPos) model.pose(o.pos.x, o.pos.y, o.pos.z, o.pos.yaw, 0, 0, 0);
    return { root: model.root, model, appliedTeam: o.team, appliedStriker: striker };
  }

  private syncSharedBall(): void {
    const b = soccerState.ball;
    const want = soccerState.mode === 'ball' && !!b && b.hasPos;
    if (!want) {
      if (this.sharedBall) {
        this.sharedBall.dispose(false, true);
        this.sharedBall = null;
        this.sharedBallMat = null;
        this.sharedBallR = 0;
      }
      return;
    }
    const ball = b;
    if (!ball) return;
    if (!this.sharedBall || this.sharedBallR !== ball.r) {
      this.sharedBall?.dispose(false, true);
      this.sharedBallR = ball.r;
      const mesh = MeshBuilder.CreateSphere(
        'soccerSharedBall',
        { diameter: ball.r * 2, segments: 20 },
        this.scene,
      );
      const mat = new StandardMaterial('soccerSharedBallMat', this.scene);
      mat.diffuseColor = hex(0xffd60a);
      mat.emissiveColor = hex(0xffd60a).scale(0.42);
      mat.specularColor = new Color3(0.3, 0.3, 0.3);
      mesh.material = mat;
      mesh.isPickable = false;
      const seams = MeshBuilder.CreateIcoSphere(
        'soccerSharedBallSeams',
        { radius: ball.r * 1.002, subdivisions: 1 },
        this.scene,
      );
      const seamMat = new StandardMaterial('soccerSharedBallSeamMat', this.scene);
      seamMat.emissiveColor = hex(0x1a1a1a);
      seamMat.disableLighting = true;
      seamMat.wireframe = true;
      seams.material = seamMat;
      seams.isPickable = false;
      seams.parent = mesh;
      this.sharedBall = mesh;
      this.sharedBallMat = mat;
      this.sharedBallGlow = 0.42;
    }
    this.sharedBall.position.set(ball.pos.x, ball.pos.y, ball.pos.z);
    const glow = soccerState.ballNear ? 0.95 : 0.42;
    if (glow !== this.sharedBallGlow && this.sharedBallMat) {
      this.sharedBallGlow = glow;
      this.sharedBallMat.emissiveColor = hex(0xffd60a).scale(glow);
    }
  }

  private burstGoal(): void {
    const F = activeSoccerField();
    const z = this.pickGoalZ();
    const goal = this.goals.find((g) => g.z === z) ?? this.goals[0];
    const color = goal?.color ?? 0xffe08a;
    this.spawnBurst(0, F.goalY, z, color, 28, 0.08);
    this.goalFlashZ = z;
    this.goalFlashUntil = performance.now() + 700;
  }

  private burstHit(): void {
    const p = droneState.position;
    this.spawnBurst(p.x, p.y, p.z, 0xffe08a, 14, 0.05);
  }

  private pickGoalZ(): number {
    const F = activeSoccerField();
    if (this.preview) return F.goalZ;
    const nearPos = Math.abs(droneState.position.z - F.goalZ);
    const nearNeg = Math.abs(droneState.position.z + F.goalZ);
    return nearPos <= nearNeg ? F.goalZ : -F.goalZ;
  }

  private spawnBurst(x: number, y: number, z: number, color: number, count: number, speed: number): void {
    while (this.sparks.length > 70) {
      const old = this.sparks.shift();
      old?.mesh.dispose(false, true);
    }
    for (let i = 0; i < count; i++) {
      const mesh = MeshBuilder.CreateBox(
        `soccerSpark-${this.generation}-${this.sparks.length}-${i}`,
        { size: 0.05 + Math.random() * 0.04 },
        this.scene,
      );
      mesh.position.set(x, y, z);
      mesh.isPickable = false;
      const mat = new StandardMaterial(`soccerSparkMat-${mesh.name}`, this.scene);
      mat.emissiveColor = hex(color);
      mat.disableLighting = true;
      mesh.material = mat;
      const a = Math.random() * Math.PI * 2;
      const b = Math.random() * Math.PI;
      const sp = speed * (0.45 + Math.random());
      this.sparks.push({
        mesh,
        vx: Math.sin(b) * Math.cos(a) * sp,
        vy: Math.abs(Math.cos(b)) * sp,
        vz: Math.sin(b) * Math.sin(a) * sp,
        life: 1,
      });
    }
  }

  private stepSparks(): void {
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      if (!s) continue;
      s.life -= 0.045;
      s.mesh.position.x += s.vx;
      s.mesh.position.y += s.vy;
      s.mesh.position.z += s.vz;
      s.vy -= 0.003;
      const mat = s.mesh.material as StandardMaterial | null;
      if (mat) mat.alpha = Math.max(0, s.life);
      if (s.life <= 0) {
        s.mesh.dispose(false, true);
        this.sparks.splice(i, 1);
      }
    }
  }

  private stepGoalFlash(): void {
    const flashing = performance.now() < this.goalFlashUntil;
    for (const g of this.goals) {
      const hot = flashing && g.z === this.goalFlashZ;
      g.mat.emissiveColor = hot ? hex(g.color) : g.baseEmissive;
    }
  }

  // ---------------------------------------------------------------------------
  // 室內／戶外切換
  // ---------------------------------------------------------------------------
  private enterIndoor(): void {
    const sun = this.scene.getLightByName('sun') as DirectionalLight | null;
    const hemi = this.scene.getLightByName('hemi') as HemisphericLight | null;
    if (!this.savedOutdoor && sun && hemi) {
      this.savedOutdoor = {
        clear: this.scene.clearColor.clone(),
        fogDensity: this.scene.fogDensity,
        fogColor: this.scene.fogColor.clone(),
        sunPos: sun.position.clone(),
        sunDir: sun.direction.clone(),
        sunInt: sun.intensity,
        hemiInt: hemi.intensity,
        hemiDiffuse: hemi.diffuse.clone(),
        hemiGround: hemi.groundColor.clone(),
        darkness: this.shadows?.darkness ?? 0,
      };
    }
    this.scene.clearColor = new Color4(0.07, 0.09, 0.12, 1);
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogDensity = 0.012;
    this.scene.fogColor = hex(0x2a3544);
    if (sun) {
      sun.direction = new Vector3(0.42, -1, 0.22);
      sun.position = new Vector3(-2.4, 8, 1.4);
      sun.intensity = 0.82;
    }
    if (hemi) {
      hemi.intensity = 0.36;
      hemi.diffuse = hex(0xc5d0dc);
      hemi.groundColor = hex(0x163024);
    }
    if (this.shadows) this.shadows.darkness = 0.62;
    this.hideOutdoorMeshes();
  }

  private leaveIndoor(): void {
    const saved = this.savedOutdoor;
    if (!saved) return;
    const sun = this.scene.getLightByName('sun') as DirectionalLight | null;
    const hemi = this.scene.getLightByName('hemi') as HemisphericLight | null;
    this.scene.clearColor = saved.clear;
    this.scene.fogDensity = saved.fogDensity;
    this.scene.fogColor = saved.fogColor;
    if (sun) {
      sun.position.copyFrom(saved.sunPos);
      sun.direction.copyFrom(saved.sunDir);
      sun.intensity = saved.sunInt;
    }
    if (hemi) {
      hemi.intensity = saved.hemiInt;
      hemi.diffuse = saved.hemiDiffuse;
      hemi.groundColor = saved.hemiGround;
    }
    if (this.shadows) this.shadows.darkness = saved.darkness;
    for (const h of this.hiddenOutdoor) {
      if (!h.mesh.isDisposed()) h.mesh.setEnabled(h.was);
    }
    this.hiddenOutdoor = [];
    this.savedOutdoor = null;
  }

  private hideOutdoorMeshes(): void {
    for (const mesh of this.scene.meshes) {
      if (!this.isOutdoorMesh(mesh)) continue;
      if (this.hiddenOutdoor.some((h) => h.mesh === mesh)) {
        mesh.setEnabled(false);
        continue;
      }
      this.hiddenOutdoor.push({ mesh, was: mesh.isEnabled() });
      mesh.setEnabled(false);
    }
  }

  private isOutdoorMesh(mesh: AbstractMesh): boolean {
    const n = mesh.name.toLowerCase();
    if (n.startsWith('soccer')) return false;
    if (n.startsWith('cloud')) return true;
    if (n.includes('sky')) return true;
    if (mesh.infiniteDistance) return true;
    if (n === 'groundshadow' || n === 'trail') return true;
    return false;
  }

  private cast(mesh: Mesh): void {
    this.shadows?.addShadowCaster(mesh);
    this.casters.push(mesh);
  }

  // ---------------------------------------------------------------------------
  // 清理
  // ---------------------------------------------------------------------------
  private disposeAll(): void {
    if (!this.active && this.fieldMeshes.length === 0 && !this.myDrone) return;
    this.active = false;
    this.generation++;
    this.backend.removeStatic('soccer-goals');
    setMeshCollisionBackend(null, DRONE_RADIUS);
    this.collisionReady = false;
    setSoccerArenaAudio(false);
    setSoccerFlag('');
    setSoccerEndScreen({ show: false, title: '', detail: '' });

    for (const mesh of this.casters) this.shadows?.removeShadowCaster(mesh);
    this.casters = [];
    this.fieldMeshes.forEach((m) => m.dispose(false, true));
    this.fieldMeshes = [];
    this.goalMeshes = [];
    this.goals = [];
    this.dummyMeshes.forEach((m) => m.dispose(false, true));
    this.dummyMeshes = [];
    this.myDrone?.dispose();
    this.myDrone = null;
    this.scoreboard?.dispose();
    this.scoreboard = null;
    for (const light of this.lights) light.dispose();
    this.lights = [];
    for (const s of this.sparks) s.mesh.dispose(false, true);
    this.sparks = [];
    this.sharedBall?.dispose(false, true);
    this.sharedBall = null;
    this.sharedBallMat = null;
    this.sharedBallR = 0;
    for (const c of this.clones.values()) c.model.dispose();
    this.clones.clear();

    this.drone.setForceHidden(false);
    this.drone.setScaleFactor(1);
    this.setDefaultGroundVisible(true);
    this.leaveIndoor();
  }

  private setDefaultGroundVisible(on: boolean): void {
    for (const name of ['ground', 'grid', 'pad', 'startMarker']) {
      const m = this.scene.getMeshByName(name);
      if (m) m.isVisible = on;
    }
    const levelFloor = this.scene.getMeshByName('levelFloor');
    if (levelFloor) {
      levelFloor.isVisible = on && levelFloor.metadata?.hasFloor === true;
    }
  }
}
