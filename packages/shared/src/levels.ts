// 關卡 JSON schema 型別 — 與 legacy levels/chapter{1,2,3}.json 完全相容。
// 座標系慣例：右手系、機頭朝 -Z、yaw 正向 = 左轉（與 legacy Three.js 版一致）。

/**
 * 物件物理屬性（選填）。
 * 教育模擬器目前主要用 collidable；其餘欄位預留 Havok / 實體賽道化。
 */
export interface SimPhysicsDef {
  /** 是否參與碰撞（障礙預設跟 solid；圈/氣球預設 false） */
  collidable?: boolean;
  /** 質量 kg；未設 = 靜態/運動學體 */
  massKg?: number;
  /** 恢復係數 0–1 */
  restitution?: number;
  /** 摩擦係數 0–1 */
  friction?: number;
  /** 受重力影響 */
  gravity?: boolean;
}

export interface RingDef {
  x: number;
  y: number;
  z: number;
  color?: number | string;
  label?: string;
  /** 圈直徑（公尺）；缺省 3（與模擬器 torus 預設一致） */
  diameter?: number;
  /** 圈管粗細（公尺，僅視覺）；缺省 0.24 */
  thickness?: number;
  /** 每 tick 自轉角速度；缺省 0.015 */
  spin?: number;
  /** 上下漂浮幅度 m；0 = 關閉；缺省 0.2 */
  bobAmp?: number;
  /** 旋轉鑽圈關：機頭需對準的 yaw 角（度）才算穿過 */
  faceYaw?: number;
  /** faceYaw 容差（度），預設 35 */
  faceTol?: number;
  physics?: SimPhysicsDef;
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
  physics?: SimPhysicsDef;
}

export interface BalloonDef {
  x: number;
  y: number;
  z: number;
  color?: number | string;
  label?: string;
  /** 球徑 m；戳破判定半徑 = diameter/2（預設 1.4） */
  diameter?: number;
  physics?: SimPhysicsDef;
}

interface PassZoneBase {
  x: number;
  z: number;
  label: string;
  /** 地面標記圈直徑（position 型，預設 1.8） */
  markerDiameter?: number;
  /** 觸發體半徑（heading/altitude 中心點判定，預設 1.5） */
  triggerRadius?: number;
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
  /** 場景環境：展場模式用不同天空 / 霧效（F-02） */
  sceneEnv?: 'default' | 'exhibition';
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
