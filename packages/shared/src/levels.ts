// 關卡 JSON schema 型別 — 與 legacy levels/chapter{1,2,3}.json 完全相容。
// 座標系慣例：右手系、機頭朝 -Z、yaw 正向 = 左轉（與 legacy Three.js 版一致）。

export interface RingDef {
  x: number;
  y: number;
  z: number;
  color?: number | string;
  label?: string;
  /** 旋轉鑽圈關：機頭需對準的 yaw 角（度）才算穿過 */
  faceYaw?: number;
  /** faceYaw 容差（度），預設 35 */
  faceTol?: number;
}

export interface ObstacleDef {
  type: 'cube' | 'soft-cube';
  /** true = 實心，AABB 阻擋 */
  solid?: boolean;
  x: number;
  y: number;
  z: number;
  size: number;
  color?: number | string;
}

export interface BalloonDef {
  x: number;
  y: number;
  z: number;
}

interface PassZoneBase {
  x: number;
  z: number;
  label: string;
}

export interface AltitudeZone extends PassZoneBase {
  type: 'altitude';
  minY?: number;
  maxY?: number;
}

export interface PositionZone extends PassZoneBase {
  type: 'position';
  minX?: number;
  maxX?: number;
  minZ?: number;
  maxZ?: number;
  minY?: number;
  maxY?: number;
}

export interface HeadingZone extends PassZoneBase {
  type: 'heading';
  /** 目標 yaw（度） */
  targetYaw: number;
  /** 容差（度） */
  tolerance: number;
}

export type PassZoneDef = AltitudeZone | PositionZone | HeadingZone;

export interface OrbitDef {
  center?: [number, number, number];
  radius?: number;
  height?: number;
}

/**
 * 俯視相機覆寫（選配）— 預設由 guide 折線 bounding box 自動取景；
 * 關卡想固定鏡位時（例如自由畫布無 guide）可用此欄位指定。
 */
export interface TopdownCamDef {
  x: number;
  y: number;
  z: number;
  lookAt: [number, number, number];
}

export interface LevelDef {
  /** "章-關"，如 "1-0" */
  id: string;
  name: string;
  intro?: string;
  hud?: string;
  /** 僅 1-0：時間到自動進下一關（秒） */
  duration?: number;
  /** 自由活動：無過關順序 */
  freeplay?: boolean;
  /** 要求返航起飛墊並降落才算過關 */
  returnHome?: boolean;
  /** 畫畫教室：啟用畫筆 */
  draw?: boolean;
  drawHeight?: number;
  view?: 'topdown' | 'orbit3d';
  orbit?: OrbitDef;
  /** 俯視相機覆寫（選配，向後相容：缺省時由 guide bounds 自動取景） */
  topdownCam?: TopdownCamDef;
  /** 目標圖形參考線（俯視 [x,z] 折線） */
  guide?: [number, number][];
  penColors?: string[];
  rings?: RingDef[];
  obstacles?: ObstacleDef[];
  balloons?: BalloonDef[];
  passZones?: PassZoneDef[];
}

export interface ChapterDef {
  chapter: number;
  name: string;
  description?: string;
  levels: LevelDef[];
}

/** 寬鬆執行期驗證：確保載入的 JSON 至少長得像章節資料 */
export function isChapterDef(v: unknown): v is ChapterDef {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  return typeof c.chapter === 'number' && Array.isArray(c.levels);
}
