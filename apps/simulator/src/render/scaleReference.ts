// 比例尺：1 m 地面格線、從起飛墊算起的距離標籤、一套國小課桌椅和 140 cm 的學生剪影。
// 純視覺：不參與碰撞、不進 core，機身可以直接穿過去。一般關卡與沒有關卡的自由飛行顯示，
// 足球／大亂鬥（有自己的場地）收起來。開著的時候把場景原本的 5 m 格線（scene.ts 'grid'）關掉，不疊兩套。
//
// 尺寸（公尺）：
//   課桌：桌面 60×45 cm、桌面高 70 cm；椅子：座面 38×36 cm、座高 40 cm。
//   這是國小高年級課桌椅的常見尺寸取整（台灣學校課桌椅依身高分號，桌高約 52～76 cm、
//   椅高約 30～45 cm）；不是逐條引用某一號規格，用來給「大概多大」的直覺。
//   學生剪影：140 cm，約國小五年級學生的平均身高。
import {
  Color3,
  DynamicTexture,
  Material,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Vector3,
  VertexData,
  type LinesMesh,
  type Scene,
} from '@babylonjs/core';
import type { LevelDef } from '@creafly/shared';
import { bus } from '../core/events';
import { levelState } from '../core/level';
import { SceneLedger } from '../core/sceneLedger';
import { MAJOR_STEP_M, ScaleLayout, type GroundRect } from './scaleLayout';
import { hex } from './scene';

const DESK_TOP_W = 0.6;
const DESK_TOP_D = 0.45;
const DESK_H = 0.7;
const CHAIR_SEAT_W = 0.38;
const CHAIR_SEAT_D = 0.36;
const CHAIR_H = 0.4;
const STUDENT_H = 1.4;

/** 細線（每 1 m）與粗線（每 5 m）抬離地面：場地底圖在 0.02、飛行範圍框在 0.05。 */
const MINOR_Y = 0.03;
const MAJOR_Y = 0.035;
const LABEL_Y = 0.04;
const MAJOR_W = 0.06;

/** 文字圖集：4×4 格，每格 256×128 px。0～11 = 5～60 m，12 = 140 cm，13 = 課桌高。 */
const ATLAS_COLS = 4;
const ATLAS_ROWS = 4;
const CELL_W = 256;
const CELL_H = 128;
const CELL_STUDENT = 12;
const CELL_DESK = 13;
const LABEL_W = 2.2;
const LABEL_H = 1.1;

const cellOfDistance = (d: number): number => d / MAJOR_STEP_M - 1;

function cellUv(cell: number): [number, number, number, number] {
  const col = cell % ATLAS_COLS;
  const row = Math.floor(cell / ATLAS_COLS);
  // DynamicTexture 的 v 由下往上；圖集第 0 列在畫布最上面
  const u0 = col / ATLAS_COLS;
  const u1 = (col + 1) / ATLAS_COLS;
  const v1 = 1 - row / ATLAS_ROWS;
  const v0 = 1 - (row + 1) / ATLAS_ROWS;
  return [u0, v0, u1, v1];
}

function paintAtlas(tex: DynamicTexture): void {
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, CELL_W * ATLAS_COLS, CELL_H * ATLAS_ROWS);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const write = (cell: number, text: string, size: number): void => {
    const cx = (cell % ATLAS_COLS) * CELL_W + CELL_W / 2;
    const cy = Math.floor(cell / ATLAS_COLS) * CELL_H + CELL_H / 2;
    ctx.font = `bold ${size}px sans-serif`;
    ctx.lineWidth = 12;
    ctx.strokeStyle = 'rgba(15, 30, 45, 0.85)';
    ctx.strokeText(text, cx, cy);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, cx, cy);
  };
  for (let i = 0; i < 12; i++) write(i, `${(i + 1) * MAJOR_STEP_M} m`, 72);
  write(CELL_STUDENT, `${Math.round(STUDENT_H * 100)} cm`, 64);
  write(CELL_DESK, `桌高 ${Math.round(DESK_H * 100)} cm`, 50);
  tex.update();
}

/** 很多張平貼地面的字卡併成一個 mesh（共用圖集，一次 draw call）。 */
function groundLabels(scene: Scene, marks: { x: number; z: number; cell: number }[]): Mesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  const hw = LABEL_W / 2;
  const hh = LABEL_H / 2;
  marks.forEach(({ x, z, cell }, i) => {
    const [u0, v0, u1, v1] = cellUv(cell);
    // 字的上方朝 -Z（機頭方向）：從機尾後方的鏡頭看是正的
    positions.push(x - hw, LABEL_Y, z + hh, x + hw, LABEL_Y, z + hh, x + hw, LABEL_Y, z - hh, x - hw, LABEL_Y, z - hh);
    uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
    normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    const b = i * 4;
    indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  const mesh = new Mesh('scaleRefLabels', scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.uvs = uvs;
  vd.normals = normals;
  vd.indices = indices;
  vd.applyToMesh(mesh);
  return mesh;
}

/** 立著、永遠面向鏡頭的字卡（圖集裡的一格）。 */
function billboardLabel(scene: Scene, name: string, cell: number, w: number): Mesh {
  const h = w / 2;
  const [u0, v0, u1, v1] = cellUv(cell);
  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = [-w / 2, -h / 2, 0, w / 2, -h / 2, 0, w / 2, h / 2, 0, -w / 2, h / 2, 0];
  vd.uvs = [u0, v0, u1, v0, u1, v1, u0, v1];
  vd.normals = [0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1];
  vd.indices = [0, 2, 1, 0, 3, 2];
  vd.applyToMesh(mesh);
  mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
  return mesh;
}

/** 每 5 m 的粗線：細長的平面條（WebGL 的線只有 1 px，粗線改用面），併成一個 mesh。 */
function majorStrips(scene: Scene, r: GroundRect): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  const hw = MAJOR_W / 2;
  let n = 0;
  const quad = (x0: number, z0: number, x1: number, z1: number): void => {
    positions.push(x0, MAJOR_Y, z1, x1, MAJOR_Y, z1, x1, MAJOR_Y, z0, x0, MAJOR_Y, z0);
    normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    const b = n * 4;
    indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
    n++;
  };
  for (let x = r.minX; x <= r.maxX; x += MAJOR_STEP_M) quad(x - hw, r.minZ, x + hw, r.maxZ);
  for (let z = r.minZ; z <= r.maxZ; z += MAJOR_STEP_M) quad(r.minX, z - hw, r.maxX, z + hw);
  const mesh = new Mesh('scaleRefMajor', scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.normals = normals;
  vd.indices = indices;
  vd.applyToMesh(mesh);
  return mesh;
}

/** 每 1 m 的細線（5 m 的位置由粗線負責，不重畫）。 */
function minorLines(scene: Scene, r: GroundRect): LinesMesh {
  const lines: Vector3[][] = [];
  for (let x = r.minX; x <= r.maxX; x++) {
    if (x % MAJOR_STEP_M !== 0) lines.push([new Vector3(x, MINOR_Y, r.minZ), new Vector3(x, MINOR_Y, r.maxZ)]);
  }
  for (let z = r.minZ; z <= r.maxZ; z++) {
    if (z % MAJOR_STEP_M !== 0) lines.push([new Vector3(r.minX, MINOR_Y, z), new Vector3(r.maxX, MINOR_Y, z)]);
  }
  const mesh = MeshBuilder.CreateLineSystem('scaleRefMinor', { lines }, scene);
  mesh.color = Color3.White();
  mesh.alpha = 0.22;
  return mesh;
}

export class ScaleReference {
  private enabled = false;
  /** 足球／大亂鬥進行中：它們有自己的場地，比例尺先收起來。 */
  private suppressed = false;
  private meshes: Mesh[] = [];
  private mats: Material[] = [];
  private atlas: DynamicTexture | null = null;

  constructor(private readonly scene: Scene) {
    bus.on('level-loaded', ({ level }) => this.refresh(level));
    // 換關會緊接著 level-loaded 重建；進足球／大亂鬥則由下面收起
    bus.on('level-cleared', () => this.clear());
    const hide = (): void => {
      this.suppressed = true;
      this.clear();
    };
    // 離開足球／大亂鬥：回到關卡或沒有關卡的自由飛行，都要再顯示
    const show = (): void => {
      this.suppressed = false;
      this.refresh(levelState.current);
    };
    bus.on('arena-entered', hide);
    bus.on('soccer-entered', hide);
    bus.on('arena-exited', show);
    bus.on('soccer-exited', show);
  }

  /** 回傳現在畫面上有沒有比例尺（足球／大亂鬥中開啟要等回來才看得到）。 */
  setEnabled(on: boolean): boolean {
    this.enabled = on;
    this.refresh(levelState.current);
    return on && !this.suppressed;
  }

  private refresh(level: LevelDef | null): void {
    if (this.enabled && !this.suppressed) this.build(level);
    else this.clear();
  }

  private clear(): void {
    this.meshes.forEach((m) => m.dispose());
    this.meshes = [];
    this.mats.forEach((m) => m.dispose());
    this.mats = [];
    this.atlas?.dispose();
    this.atlas = null;
    this.scene.getMeshByName('grid')?.setEnabled(true);
    SceneLedger.set('scaleReference', 0);
  }

  private material(name: string, color: Color3, opts: { emissive?: boolean; alpha?: number } = {}): StandardMaterial {
    const mat = new StandardMaterial(name, this.scene);
    mat.diffuseColor = color;
    mat.specularColor = new Color3(0.08, 0.08, 0.08);
    if (opts.emissive) {
      mat.emissiveColor = color;
      mat.disableLighting = true;
    }
    if (opts.alpha !== undefined) mat.alpha = opts.alpha;
    this.mats.push(mat);
    return mat;
  }

  private keep<T extends Mesh>(mesh: T): T {
    mesh.isPickable = false;
    this.meshes.push(mesh);
    return mesh;
  }

  private build(level: LevelDef | null): void {
    this.clear();
    const scene = this.scene;
    const r = ScaleLayout.extent(level);
    // 原本的 5 m 格線關掉（用 setEnabled，不碰 playground／足球在用的 isVisible）
    scene.getMeshByName('grid')?.setEnabled(false);

    this.keep(minorLines(scene, r));
    const major = this.keep(majorStrips(scene, r));
    const majorMat = this.material('scaleRefMajorMat', hex(0x4dd0e1), { emissive: true, alpha: 0.85 });
    majorMat.backFaceCulling = false;
    major.material = majorMat;

    const atlas = new DynamicTexture(
      'scaleRefAtlas',
      { width: CELL_W * ATLAS_COLS, height: CELL_H * ATLAS_ROWS },
      scene,
      true,
    );
    atlas.hasAlpha = true;
    paintAtlas(atlas);
    this.atlas = atlas;
    const labelMat = this.material('scaleRefLabelMat', Color3.White(), { emissive: true });
    labelMat.diffuseTexture = atlas;
    labelMat.useAlphaFromDiffuseTexture = true;
    labelMat.transparencyMode = Material.MATERIAL_ALPHABLEND;
    labelMat.backFaceCulling = false;

    // 標籤在刻度線旁邊：前後軸的放右側、左右軸的放線後方（靠鏡頭）
    const marks = ScaleLayout.axisMarks(r).map(({ x, z, d }) => ({
      x: x === 0 ? LABEL_W / 2 + 0.15 : x,
      z: x === 0 ? z + LABEL_H / 2 + 0.05 : LABEL_H / 2 + 0.05,
      cell: cellOfDistance(d),
    }));
    if (marks.length > 0) this.keep(groundLabels(scene, marks)).material = labelMat;

    this.buildProps(level, labelMat);
    // 立牌要每張畫面轉向鏡頭，不能凍結世界矩陣
    for (const m of this.meshes) if (m.billboardMode === Mesh.BILLBOARDMODE_NONE) m.freezeWorldMatrix();
    for (const m of this.mats) m.freeze();
    SceneLedger.set('scaleReference', this.meshes.length);
  }

  /** 課桌椅與學生剪影：按材質併成三個 mesh，放在起飛墊旁。 */
  private buildProps(level: LevelDef | null, labelMat: StandardMaterial): void {
    const scene = this.scene;
    const spot = ScaleLayout.propSpot(level);
    const box = (w: number, h: number, d: number, x: number, y: number, z: number): Mesh => {
      const m = MeshBuilder.CreateBox('scaleRefPart', { width: w, height: h, depth: d }, scene);
      m.position.set(x, y, z);
      return m;
    };

    // 桌子在原點、椅子在桌子後方（靠鏡頭），學生站在桌子左邊，大家面向 -Z
    const TOP_T = 0.025;
    const LEG = 0.03;
    const SEAT_T = 0.02;
    const chairZ = DESK_TOP_D / 2 + 0.15;
    const wood = [
      box(DESK_TOP_W, TOP_T, DESK_TOP_D, 0, DESK_H - TOP_T / 2, 0),
      // 抽屜（書包格）
      box(DESK_TOP_W - 0.06, 0.12, DESK_TOP_D - 0.06, 0, DESK_H - TOP_T - 0.08, 0),
      box(CHAIR_SEAT_W, SEAT_T, CHAIR_SEAT_D, 0, CHAIR_H - SEAT_T / 2, chairZ),
      box(CHAIR_SEAT_W, 0.2, SEAT_T, 0, CHAIR_H + 0.22, chairZ + CHAIR_SEAT_D / 2 - SEAT_T / 2),
    ];
    const metal: Mesh[] = [];
    const legs = (w: number, d: number, h: number, cz: number): void => {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          metal.push(box(LEG, h, LEG, sx * (w / 2 - LEG), h / 2, cz + sz * (d / 2 - LEG)));
        }
      }
    };
    legs(DESK_TOP_W, DESK_TOP_D, DESK_H - TOP_T, 0);
    legs(CHAIR_SEAT_W, CHAIR_SEAT_D, CHAIR_H - SEAT_T, chairZ);
    // 椅背兩根立柱
    for (const sx of [-1, 1]) {
      metal.push(box(LEG, 0.34, LEG, sx * (CHAIR_SEAT_W / 2 - LEG), CHAIR_H + 0.15, chairZ + CHAIR_SEAT_D / 2 - LEG));
    }

    // 140 cm 剪影：頭頂剛好 1.40 m
    const sx0 = -0.85;
    const cap = (h: number, r: number, x: number, y: number): Mesh => {
      const m = MeshBuilder.CreateCapsule('scaleRefPart', { height: h, radius: r, tessellation: 12 }, scene);
      m.position.set(x, y, 0);
      return m;
    };
    const head = MeshBuilder.CreateSphere('scaleRefPart', { diameter: 0.22, segments: 12 }, scene);
    head.position.set(sx0, STUDENT_H - 0.11, 0);
    const figure = [
      cap(0.74, 0.065, sx0 - 0.075, 0.37),
      cap(0.74, 0.065, sx0 + 0.075, 0.37),
      cap(0.54, 0.15, sx0, 0.95),
      cap(0.52, 0.045, sx0 - 0.2, 0.9),
      cap(0.52, 0.045, sx0 + 0.2, 0.9),
      head,
    ];

    const merge = (parts: Mesh[], name: string, mat: StandardMaterial): void => {
      const m = Mesh.MergeMeshes(parts, true, true);
      if (!m) return;
      m.name = name;
      m.position.set(spot.x, 0, spot.z);
      m.material = mat;
      this.keep(m);
    };
    merge(wood, 'scaleRefDeskWood', this.material('scaleRefWoodMat', hex(0xd9a86c)));
    merge(metal, 'scaleRefDeskMetal', this.material('scaleRefMetalMat', hex(0x7a8794)));
    merge(figure, 'scaleRefStudent', this.material('scaleRefFigureMat', hex(0x34495e)));

    const studentTag = this.keep(billboardLabel(scene, 'scaleRefStudentTag', CELL_STUDENT, 1.2));
    studentTag.position.set(spot.x + sx0, STUDENT_H + 0.4, spot.z);
    studentTag.material = labelMat;
    const deskTag = this.keep(billboardLabel(scene, 'scaleRefDeskTag', CELL_DESK, 1.2));
    deskTag.position.set(spot.x + 0.3, DESK_H + 0.4, spot.z);
    deskTag.material = labelMat;
  }
}
