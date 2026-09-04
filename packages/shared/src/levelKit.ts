// 關卡素材庫 — 老師編輯器可插入的圈點、障礙、任務步驟等預設片段。
// 座標以起飛墊 (0,0) 為中心，z 負值 = 向前。
import type { LevelDef } from './levels';

export type LevelKitCategory = 'rings' | 'obstacles' | 'tasks' | 'scenes';

export interface LevelKitSnippet {
  id: string;
  category: LevelKitCategory;
  name: string;
  desc: string;
  patch: Partial<LevelDef>;
}

export const LEVEL_KIT_CATEGORIES: { id: LevelKitCategory; label: string }[] = [
  { id: 'rings', label: '穿圈路線' },
  { id: 'obstacles', label: '障礙佈置' },
  { id: 'tasks', label: '任務步驟' },
  { id: 'scenes', label: '關卡情境' },
];

/** 老師可插入的素材片段（可 append 到現有關卡） */
export const LEVEL_KIT_SNIPPETS: LevelKitSnippet[] = [
  // --- 穿圈 ---
  {
    id: 'rings-line-3',
    category: 'rings',
    name: '直線三圈',
    desc: '向前直飛穿 3 圈（適合初學鑽圈）',
    patch: {
      returnHome: true,
      hud: '依序穿過 3 個圈 → 飛回起飛墊',
      rings: [
        { x: 0, y: 2.5, z: -4, color: '#38bdf8', label: '1' },
        { x: 0, y: 2.5, z: -8, color: '#38bdf8', label: '2' },
        { x: 0, y: 2.5, z: -12, color: '#38bdf8', label: '3' },
      ],
    },
  },
  {
    id: 'rings-slalom',
    category: 'rings',
    name: 'S 形繞圈',
    desc: '左右交錯 4 圈，練習轉向控制',
    patch: {
      returnHome: true,
      hud: 'S 形依序穿圈 → 返航降落',
      rings: [
        { x: -3, y: 2.5, z: -4, label: '1' },
        { x: 3, y: 2.5, z: -7, label: '2' },
        { x: -3, y: 2.5, z: -10, label: '3' },
        { x: 3, y: 2.5, z: -13, label: '4' },
      ],
    },
  },
  {
    id: 'rings-square',
    category: 'rings',
    name: '方形路線',
    desc: '四個角各一圈，練習轉彎',
    patch: {
      returnHome: true,
      hud: '沿方形路線穿圈 → 返航',
      rings: [
        { x: 0, y: 2.5, z: -5, label: '1' },
        { x: 4, y: 2.5, z: -5, label: '2' },
        { x: 4, y: 2.5, z: -9, label: '3' },
        { x: 0, y: 2.5, z: -9, label: '4' },
      ],
    },
  },
  {
    id: 'rings-face-1',
    category: 'rings',
    name: '旋轉鑽圈',
    desc: '需機頭對準紅圈方向才算過（faceYaw）',
    patch: {
      returnHome: true,
      hud: '機頭對準紅圈再穿過',
      rings: [{ x: 0, y: 2.5, z: -6, color: 'red', faceYaw: 0, faceTol: 35, label: '對準' }],
    },
  },
  // --- 障礙 ---
  {
    id: 'obs-soft-corners',
    category: 'obstacles',
    name: '四角標記柱',
    desc: '綠色軟障礙，標示場地四角（不擋飛行）',
    patch: {
      obstacles: [
        { type: 'soft-cube', x: 8, y: 1.5, z: 0, size: 1, color: '#4ade80' },
        { type: 'soft-cube', x: -8, y: 1.5, z: 0, size: 1, color: '#4ade80' },
        { type: 'soft-cube', x: 0, y: 1.5, z: 8, size: 1, color: '#4ade80' },
        { type: 'soft-cube', x: 0, y: 1.5, z: -8, size: 1, color: '#4ade80' },
      ],
    },
  },
  {
    id: 'obs-gate',
    category: 'obstacles',
    name: '門框通道',
    desc: '兩根實心柱，需從中間穿過',
    patch: {
      obstacles: [
        { type: 'cube', solid: true, x: -2, y: 1.5, z: -6, size: 1, color: '#f87171' },
        { type: 'cube', solid: true, x: 2, y: 1.5, z: -6, size: 1, color: '#f87171' },
      ],
    },
  },
  {
    id: 'obs-slalom',
    category: 'obstacles',
    name: '繞柱障礙',
    desc: '三根實心柱 S 形排列',
    patch: {
      obstacles: [
        { type: 'cube', solid: true, x: -2.5, y: 1.5, z: -4, size: 1, color: '#f87171' },
        { type: 'cube', solid: true, x: 2.5, y: 1.5, z: -7, size: 1, color: '#f87171' },
        { type: 'cube', solid: true, x: -2.5, y: 1.5, z: -10, size: 1, color: '#f87171' },
      ],
    },
  },
  // --- 任務步驟（passZones）---
  {
    id: 'task-takeoff-land',
    category: 'tasks',
    name: '起飛＋降落',
    desc: '升到 0.5m 以上再落地（無穿圈）',
    patch: {
      hud: '起飛 → 降落',
      passZones: [
        { x: 0, z: -2, label: '起飛 ≥ 0.5m', type: 'altitude', minY: 0.5 },
        { x: 0, z: -2, label: '落地', type: 'altitude', maxY: 0.5 },
      ],
    },
  },
  {
    id: 'task-altitude',
    category: 'tasks',
    name: '垂直升降',
    desc: '起飛 → 升到 3m → 降到 1m → 落地',
    patch: {
      hud: '起飛 → 升 3m → 降到 1m → 落地',
      passZones: [
        { x: 0, z: -2, label: '起飛 ≥ 0.5m', type: 'altitude', minY: 0.5 },
        { x: 0, z: -2, label: '升到 3m', type: 'altitude', minY: 2.8, maxY: 3.5 },
        { x: 0, z: -2, label: '降到 1m', type: 'altitude', minY: 0.8, maxY: 1.5 },
        { x: 0, z: -2, label: '落地', type: 'altitude', maxY: 0.5 },
      ],
    },
  },
  {
    id: 'task-heading',
    category: 'tasks',
    name: '旋轉四步',
    desc: '依序轉 90° / 180° / 270° / 回正',
    patch: {
      hud: '往左旋轉一整圈（每 90° 一關）',
      passZones: [
        { x: 0, z: -2, label: '轉 90°', type: 'heading', targetYaw: 90, tolerance: 20 },
        { x: 0, z: -2, label: '轉 180°', type: 'heading', targetYaw: 180, tolerance: 20 },
        { x: 0, z: -2, label: '轉 270°', type: 'heading', targetYaw: 270, tolerance: 20 },
        { x: 0, z: -2, label: '回正', type: 'heading', targetYaw: 0, tolerance: 20 },
      ],
    },
  },
  {
    id: 'task-cross',
    category: 'tasks',
    name: '十字移動',
    desc: '保持 2m 高度：前 → 後 → 右 → 左',
    patch: {
      hud: '保持 2m：前進 → 後退 → 右飛 → 左飛',
      passZones: [
        { x: 0, z: -3, label: '前 3m', type: 'position', maxZ: -2.5, minY: 1.2 },
        { x: 0, z: 0, label: '後退回原點', type: 'position', minZ: -0.5, maxZ: 0.5, minY: 1.2 },
        { x: 3, z: 0, label: '右飛 3m', type: 'position', minX: 2.5, minY: 1.2 },
        {
          x: 0,
          z: 0,
          label: '左飛回原點',
          type: 'position',
          minX: -0.5,
          maxX: 0.5,
          minZ: -0.5,
          maxZ: 0.5,
          minY: 1.2,
        },
      ],
    },
  },
  // --- 情境 ---
  {
    id: 'scene-balloons',
    category: 'scenes',
    name: '戳氣球',
    desc: '6 顆氣球散佈前方（戳破全部過關）',
    patch: {
      freeplay: true,
      returnHome: false,
      hud: '戳破全部氣球！',
      intro: '升到適當高度，用機身碰破所有氣球。',
      balloons: [
        { x: -3, y: 2, z: -4 },
        { x: 3, y: 2.5, z: -5 },
        { x: 0, y: 3, z: -7 },
        { x: -4, y: 2, z: -9 },
        { x: 4, y: 2, z: -10 },
        { x: 0, y: 2.5, z: -12 },
      ],
    },
  },
  {
    id: 'scene-warmup',
    category: 'scenes',
    name: '熱身自由飛',
    desc: '無任務、四角標記柱，適合第一堂課',
    patch: {
      freeplay: true,
      returnHome: false,
      hud: '自由飛行熱身',
      intro: '沒有任務，隨便推搖桿熟悉操控。四角綠柱只是標記，不會擋住你。',
      obstacles: [
        { type: 'soft-cube', x: 8, y: 1.5, z: 0, size: 1, color: '#4ade80' },
        { type: 'soft-cube', x: -8, y: 1.5, z: 0, size: 1, color: '#4ade80' },
        { type: 'soft-cube', x: 0, y: 1.5, z: 8, size: 1, color: '#4ade80' },
        { type: 'soft-cube', x: 0, y: 1.5, z: -8, size: 1, color: '#4ade80' },
      ],
    },
  },
];

export type LevelKitApplyMode = 'append' | 'replace-tasks';

/**
 * 將素材片段合併進關卡 definition。
 * - rings / obstacles / balloons：追加
 * - passZones：replace-tasks 模式會覆寫；append 模式在已有步驟時追加
 * - intro：僅在空白時填入；hud / returnHome / freeplay 有值則覆寫
 */
export function applyLevelKitSnippet(
  level: LevelDef,
  snippet: LevelKitSnippet,
  mode: LevelKitApplyMode = 'append',
): LevelDef {
  const p = snippet.patch;
  const next: LevelDef = { ...level };

  if (p.rings?.length) {
    const base = next.rings?.length ?? 0;
    next.rings = [
      ...(next.rings ?? []),
      ...p.rings.map((r, i) => ({
        ...r,
        label: r.label ?? String(base + i + 1),
      })),
    ];
  }
  if (p.obstacles?.length) {
    next.obstacles = [...(next.obstacles ?? []), ...p.obstacles];
  }
  if (p.balloons?.length) {
    next.balloons = [...(next.balloons ?? []), ...p.balloons];
  }
  if (p.passZones?.length) {
    const existing = next.passZones ?? [];
    if (mode === 'replace-tasks' || existing.length === 0) {
      next.passZones = [...p.passZones];
    } else {
      next.passZones = [...existing, ...p.passZones];
    }
  }
  if (p.intro && !next.intro?.trim()) next.intro = p.intro;
  if (p.hud) next.hud = p.hud;
  if (p.returnHome !== undefined) next.returnHome = p.returnHome;
  if (p.freeplay !== undefined) next.freeplay = p.freeplay;

  return next;
}

export function getLevelKitSnippet(id: string): LevelKitSnippet | undefined {
  return LEVEL_KIT_SNIPPETS.find((s) => s.id === id);
}

export function levelKitByCategory(category: LevelKitCategory): LevelKitSnippet[] {
  return LEVEL_KIT_SNIPPETS.filter((s) => s.category === category);
}
