// 關卡素材庫 — 老師編輯器可插入的圈點、障礙、任務步驟等預設片段。
// 座標以起飛墊 (0,0) 為中心，z 負值 = 向前。
import type { LevelDef } from './levels';

export type LevelKitCategory = 'rings' | 'obstacles' | 'tasks' | 'scenes' | 'draw' | 'races';

export interface LevelKitSnippet {
  id: string;
  category: LevelKitCategory;
  name: string;
  desc: string;
  patch: Partial<LevelDef>;
  /** 完整情境模板：插入時覆寫 intro（預設僅在空白時填入） */
  forceIntro?: boolean;
}

export const LEVEL_KIT_CATEGORIES: { id: LevelKitCategory; label: string }[] = [
  { id: 'rings', label: '穿圈路線' },
  { id: 'obstacles', label: '障礙佈置' },
  { id: 'tasks', label: '任務步驟' },
  { id: 'scenes', label: '關卡情境' },
  { id: 'draw', label: '畫畫教室' },
  { id: 'races', label: '競速賽道' },
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
  {
    id: 'rings-line-5',
    category: 'rings',
    name: '直線五圈',
    desc: '進階直線穿圈，間距 3m',
    patch: {
      returnHome: true,
      hud: '依序穿過 5 個圈 → 返航',
      rings: [0, 1, 2, 3, 4].map((i) => ({
        x: 0,
        y: 3,
        z: -4 - i * 2.5,
        color: '#38bdf8',
        label: String(i + 1),
      })),
    },
  },
  {
    id: 'rings-figure8',
    category: 'rings',
    name: '8 字路線',
    desc: '左右交叉 6 圈，練轉向與高度',
    patch: {
      returnHome: true,
      hud: '沿 8 字路線穿圈',
      rings: [
        { x: -3, y: 2.5, z: -3, label: '1' },
        { x: 3, y: 2.5, z: -5, label: '2' },
        { x: -3, y: 2.5, z: -7, label: '3' },
        { x: 3, y: 2.5, z: -9, label: '4' },
        { x: -3, y: 2.5, z: -11, label: '5' },
        { x: 0, y: 2.5, z: -13, label: '6' },
      ],
    },
  },
  {
    id: 'rings-u-turn',
    category: 'rings',
    name: 'U 形迴轉',
    desc: '向前後左轉一圈再回，適合轉彎練習',
    patch: {
      returnHome: true,
      hud: 'U 形穿圈後返航',
      rings: [
        { x: 0, y: 2.5, z: -4, label: '1' },
        { x: 0, y: 2.5, z: -8, label: '2' },
        { x: -4, y: 2.5, z: -10, label: '3' },
        { x: -4, y: 2.5, z: -6, label: '4' },
      ],
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
  {
    id: 'obs-wide-gate',
    category: 'obstacles',
    name: '寬門框（4m）',
    desc: '兩柱間距 4m，練精準穿過',
    patch: {
      obstacles: [
        { type: 'cube', solid: true, x: -2, y: 1.5, z: -8, size: 1, color: '#f87171' },
        { type: 'cube', solid: true, x: 2, y: 1.5, z: -8, size: 1, color: '#f87171' },
      ],
    },
  },
  {
    id: 'obs-tunnel',
    category: 'obstacles',
    name: '左右通道',
    desc: '兩排實心牆，中間留 4m 通道',
    patch: {
      obstacles: [
        { type: 'cube', solid: true, x: -4, y: 1.5, z: -5, size: 1, color: '#f87171' },
        { type: 'cube', solid: true, x: 4, y: 1.5, z: -5, size: 1, color: '#f87171' },
        { type: 'cube', solid: true, x: -4, y: 1.5, z: -8, size: 1, color: '#f87171' },
        { type: 'cube', solid: true, x: 4, y: 1.5, z: -8, size: 1, color: '#f87171' },
        { type: 'cube', solid: true, x: -4, y: 1.5, z: -11, size: 1, color: '#f87171' },
        { type: 'cube', solid: true, x: 4, y: 1.5, z: -11, size: 1, color: '#f87171' },
      ],
    },
  },
  {
    id: 'obs-center-block',
    category: 'obstacles',
    name: '中央大障礙',
    desc: '2×2 實心方塊，需繞行',
    patch: {
      obstacles: [
        { type: 'cube', solid: true, x: 0, y: 1.5, z: -7, size: 2, color: '#f87171' },
      ],
    },
  },
  {
    id: 'obs-landing-pad',
    category: 'obstacles',
    name: '降落平台標記',
    desc: '前方軟墊標記（不擋飛行）',
    patch: {
      obstacles: [
        { type: 'soft-cube', x: 0, y: 0.2, z: -6, size: 3, color: '#fbbf24' },
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
  {
    id: 'task-hover',
    category: 'tasks',
    name: '定高 2m',
    desc: '起飛後維持 2m 高度 3 秒概念（到區域即過）',
    patch: {
      hud: '起飛並維持約 2m 高度',
      passZones: [
        { x: 0, z: -2, label: '起飛', type: 'altitude', minY: 0.5 },
        { x: 0, z: -2, label: '維持 2m', type: 'altitude', minY: 1.8, maxY: 2.5 },
        { x: 0, z: -2, label: '降落', type: 'altitude', maxY: 0.5 },
      ],
    },
  },
  {
    id: 'task-forward-6',
    category: 'tasks',
    name: '前進 6m',
    desc: '起飛 → 前飛 6m → 退回 → 降落',
    patch: {
      hud: '前進 6m 再退回',
      passZones: [
        { x: 0, z: -2, label: '起飛', type: 'altitude', minY: 0.5 },
        { x: 0, z: -6, label: '前進 6m', type: 'position', maxZ: -5.5, minY: 1 },
        { x: 0, z: 0, label: '退回原點', type: 'position', minZ: -0.5, maxZ: 0.5, minY: 1 },
        { x: 0, z: -2, label: '降落', type: 'altitude', maxY: 0.5 },
      ],
    },
  },
  {
    id: 'task-side-step',
    category: 'tasks',
    name: '左右平移',
    desc: '起飛 → 右移 3m → 左移回原點 → 降落',
    patch: {
      hud: '右移 3m → 左移回中',
      passZones: [
        { x: 0, z: -2, label: '起飛', type: 'altitude', minY: 0.5 },
        { x: 3, z: 0, label: '右移 3m', type: 'position', minX: 2.5, minY: 1 },
        { x: 0, z: 0, label: '左移回中', type: 'position', minX: -0.5, maxX: 0.5, minY: 1 },
        { x: 0, z: -2, label: '降落', type: 'altitude', maxY: 0.5 },
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
  {
    id: 'scene-gate-rings',
    category: 'scenes',
    name: '穿門＋穿圈',
    desc: '門框障礙 + 直線三圈綜合練習',
    patch: {
      returnHome: true,
      hud: '穿過門框 → 穿 3 圈 → 返航',
      intro: '先從紅色門框中間穿過，再依序穿圈。',
      obstacles: [
        { type: 'cube', solid: true, x: -2, y: 1.5, z: -3, size: 1, color: '#f87171' },
        { type: 'cube', solid: true, x: 2, y: 1.5, z: -3, size: 1, color: '#f87171' },
      ],
      rings: [
        { x: 0, y: 2.5, z: -6, label: '1' },
        { x: 0, y: 2.5, z: -9, label: '2' },
        { x: 0, y: 2.5, z: -12, label: '3' },
      ],
    },
  },
  {
    id: 'scene-balloons-3',
    category: 'scenes',
    name: '三顆氣球',
    desc: '簡短戳氣球練習',
    patch: {
      freeplay: true,
      returnHome: false,
      hud: '戳破 3 顆氣球',
      balloons: [
        { x: -2, y: 2, z: -5 },
        { x: 2, y: 2.5, z: -6 },
        { x: 0, y: 3, z: -8 },
      ],
    },
  },
  // --- 畫畫教室 ---
  {
    id: 'draw-line',
    category: 'draw',
    name: '畫直線',
    desc: '畫筆模式 + 直線參考線',
    patch: {
      draw: true,
      drawHeight: 3,
      view: 'topdown',
      hud: '下筆 → 前進，畫出直線',
      intro: '用積木：起飛 → 下筆 → 前進 6m。',
      guide: [[0, 0], [0, -6]],
      passZones: [
        { x: 0, z: 0, label: '起飛離地', type: 'altitude', minY: 1.5 },
        { x: 0, z: -6, label: '畫到線尾', type: 'position', minX: -1.4, maxX: 1.4, minZ: -7.4, maxZ: -4.6, minY: 2 },
      ],
    },
  },
  {
    id: 'draw-square',
    category: 'draw',
    name: '畫正方形',
    desc: '正方形參考線 + 四角檢查點',
    patch: {
      draw: true,
      drawHeight: 3,
      view: 'topdown',
      hud: '重複 4 次〔前進 5m，右轉 90°〕',
      guide: [[0, 0], [0, -5], [5, -5], [5, 0], [0, 0]],
      passZones: [
        { x: 0, z: -5, label: '角 1', type: 'position', minX: -1.4, maxX: 1.4, minZ: -6.4, maxZ: -3.6, minY: 2 },
        { x: 5, z: -5, label: '角 2', type: 'position', minX: 3.6, maxX: 6.4, minZ: -6.4, maxZ: -3.6, minY: 2 },
        { x: 5, z: 0, label: '角 3', type: 'position', minX: 3.6, maxX: 6.4, minZ: -1.4, maxZ: 1.4, minY: 2 },
        { x: 0, z: 0, label: '收尾', type: 'position', minX: -1.4, maxX: 1.4, minZ: -1.4, maxZ: 1.4, minY: 2 },
      ],
    },
  },
  {
    id: 'draw-free',
    category: 'draw',
    name: '自由畫布',
    desc: '無任務，多色畫筆',
    patch: {
      draw: true,
      drawHeight: 3,
      view: 'topdown',
      freeplay: true,
      hud: '自由創作',
      intro: '用下筆 / 抬筆 / 換色自由作畫。',
      penColors: ['#ff5252', '#42a5f5', '#66bb6a', '#ffd54f', '#ab47bc'],
      passZones: [],
    },
  },
  // --- 穿圈（進階 / 市面常見賽道）---
  {
    id: 'rings-triangle',
    category: 'rings',
    name: '三角路線',
    desc: '三點折線穿圈（Robolink / 競賽常見）',
    patch: {
      returnHome: true,
      hud: '三角路線穿圈 → 返航',
      rings: [
        { x: 0, y: 2.5, z: -5, label: '1' },
        { x: 4, y: 2.5, z: -8, label: '2' },
        { x: -4, y: 2.5, z: -8, label: '3' },
      ],
    },
  },
  {
    id: 'rings-diamond',
    category: 'rings',
    name: '菱形路線',
    desc: '四點菱形轉彎（FPV 訓練）',
    patch: {
      returnHome: true,
      hud: '菱形路線穿圈',
      rings: [
        { x: 0, y: 2.5, z: -4, label: '1' },
        { x: 4, y: 2.5, z: -8, label: '2' },
        { x: 0, y: 2.5, z: -12, label: '3' },
        { x: -4, y: 2.5, z: -8, label: '4' },
      ],
    },
  },
  {
    id: 'rings-orbit-6',
    category: 'rings',
    name: '環形六圈',
    desc: '繞中心點一圈（Tello 繞圈任務風格）',
    patch: {
      returnHome: true,
      hud: '繞行穿過 6 個圈',
      rings: [
        { x: 0, y: 2.5, z: -4, label: '1' },
        { x: 3.5, y: 2.5, z: -6, label: '2' },
        { x: 3.5, y: 2.5, z: -10, label: '3' },
        { x: 0, y: 2.5, z: -12, label: '4' },
        { x: -3.5, y: 2.5, z: -10, label: '5' },
        { x: -3.5, y: 2.5, z: -6, label: '6' },
      ],
    },
  },
  {
    id: 'rings-ladder',
    category: 'rings',
    name: '爬升梯',
    desc: '逐圈升高（DroneBlocks 高度挑戰）',
    patch: {
      returnHome: true,
      hud: '越飛越高穿圈 → 返航',
      rings: [
        { x: 0, y: 2, z: -4, label: '1' },
        { x: 0, y: 2.5, z: -7, label: '2' },
        { x: 0, y: 3, z: -10, label: '3' },
        { x: 0, y: 3.5, z: -13, label: '4' },
      ],
    },
  },
  {
    id: 'rings-hairpin',
    category: 'rings',
    name: '髮夾彎',
    desc: '急轉彎雙圈（競速賽道）',
    patch: {
      returnHome: true,
      hud: '髮夾彎穿圈',
      rings: [
        { x: 0, y: 2.5, z: -4, label: '1' },
        { x: 5, y: 2.5, z: -6, label: '2' },
        { x: 5, y: 2.5, z: -10, label: '3' },
        { x: 0, y: 2.5, z: -12, label: '4' },
      ],
    },
  },
  {
    id: 'rings-face-course-3',
    category: 'rings',
    name: '旋轉鑽圈（三關）',
    desc: '官方 1-5 風格：每圈需對準機頭',
    patch: {
      returnHome: true,
      hud: '轉向對準紅圈穿過 → 返航',
      intro: '紅圈要機頭對準才算穿過。先轉向、再往前飛！',
      rings: [
        { x: 5, y: 3, z: 0, color: 'red', label: '1', faceYaw: 270, faceTol: 40 },
        { x: 5, y: 3, z: -5, color: 'red', label: '2', faceYaw: 0, faceTol: 40 },
        { x: 0, y: 3, z: -5, color: 'red', label: '3', faceYaw: 90, faceTol: 40 },
      ],
    },
  },
  {
    id: 'rings-zigzag-tight',
    category: 'rings',
    name: '密閉 Z 字',
    desc: '間距 2.5m 的 6 圈 Z 字（進階操控）',
    patch: {
      returnHome: true,
      hud: 'Z 字密閉穿圈',
      rings: [
        { x: -2, y: 2.5, z: -3, label: '1' },
        { x: 2, y: 2.5, z: -5, label: '2' },
        { x: -2, y: 2.5, z: -7, label: '3' },
        { x: 2, y: 2.5, z: -9, label: '4' },
        { x: -2, y: 2.5, z: -11, label: '5' },
        { x: 0, y: 2.5, z: -13, label: '6' },
      ],
    },
  },
  // --- 障礙（進階）---
  {
    id: 'obs-maze-l',
    category: 'obstacles',
    name: 'L 形牆',
    desc: '實心 L 形迷宮轉角（需繞行）',
    patch: {
      obstacles: [
        { type: 'cube', solid: true, x: -3, y: 1.5, z: -5, size: 1, color: '#f87171' },
        { type: 'cube', solid: true, x: -3, y: 1.5, z: -6, size: 1, color: '#f87171' },
        { type: 'cube', solid: true, x: -3, y: 1.5, z: -7, size: 1, color: '#f87171' },
        { type: 'cube', solid: true, x: -2, y: 1.5, z: -7, size: 1, color: '#f87171' },
        { type: 'cube', solid: true, x: -1, y: 1.5, z: -7, size: 1, color: '#f87171' },
      ],
    },
  },
  {
    id: 'obs-gate-series-3',
    category: 'obstacles',
    name: '三連門框',
    desc: '三道門框序列（DJI 模擬器障礙賽）',
    patch: {
      obstacles: [
        { type: 'cube', solid: true, x: -2, y: 1.5, z: -4, size: 1, color: '#f87171' },
        { type: 'cube', solid: true, x: 2, y: 1.5, z: -4, size: 1, color: '#f87171' },
        { type: 'cube', solid: true, x: -2, y: 1.5, z: -8, size: 1, color: '#f87171' },
        { type: 'cube', solid: true, x: 2, y: 1.5, z: -8, size: 1, color: '#f87171' },
        { type: 'cube', solid: true, x: -2, y: 1.5, z: -12, size: 1, color: '#f87171' },
        { type: 'cube', solid: true, x: 2, y: 1.5, z: -12, size: 1, color: '#f87171' },
      ],
    },
  },
  {
    id: 'obs-narrow-2m',
    category: 'obstacles',
    name: '窄門 2m',
    desc: '僅 2m 寬通道（精準操控）',
    patch: {
      obstacles: [
        { type: 'cube', solid: true, x: -1.5, y: 1.5, z: -7, size: 1, color: '#f87171' },
        { type: 'cube', solid: true, x: 1.5, y: 1.5, z: -7, size: 1, color: '#f87171' },
      ],
    },
  },
  {
    id: 'obs-field-rect',
    category: 'obstacles',
    name: '場地邊界柱',
    desc: '矩形軟標記（8 柱，不擋飛行）',
    patch: {
      obstacles: [
        { type: 'soft-cube', x: -6, y: 1.5, z: -10, size: 1, color: '#4ade80' },
        { type: 'soft-cube', x: 6, y: 1.5, z: -10, size: 1, color: '#4ade80' },
        { type: 'soft-cube', x: -6, y: 1.5, z: -2, size: 1, color: '#4ade80' },
        { type: 'soft-cube', x: 6, y: 1.5, z: -2, size: 1, color: '#4ade80' },
        { type: 'soft-cube', x: -6, y: 1.5, z: 6, size: 1, color: '#4ade80' },
        { type: 'soft-cube', x: 6, y: 1.5, z: 6, size: 1, color: '#4ade80' },
        { type: 'soft-cube', x: -6, y: 1.5, z: -6, size: 1, color: '#4ade80' },
        { type: 'soft-cube', x: 6, y: 1.5, z: -6, size: 1, color: '#4ade80' },
      ],
    },
  },
  {
    id: 'obs-tello-pad',
    category: 'obstacles',
    name: '起降墊標記',
    desc: 'Tello 任務墊風格：前方降落地點',
    patch: {
      obstacles: [
        { type: 'soft-cube', x: 0, y: 0.15, z: -8, size: 2.5, color: '#fbbf24' },
        { type: 'soft-cube', x: -1.2, y: 0.15, z: -8, size: 0.4, color: '#f97316' },
        { type: 'soft-cube', x: 1.2, y: 0.15, z: -8, size: 0.4, color: '#f97316' },
      ],
    },
  },
  // --- 任務（進階）---
  {
    id: 'task-box-perimeter',
    category: 'tasks',
    name: '方形周界',
    desc: '沿 4×4m 方形飛行（定點任務）',
    patch: {
      hud: '沿方形周界飛行',
      passZones: [
        { x: 0, z: -2, label: '起飛', type: 'altitude', minY: 0.5 },
        { x: 0, z: -4, label: '前方角', type: 'position', maxZ: -3.5, minY: 1.2 },
        { x: 4, z: -4, label: '右角', type: 'position', minX: 3.5, minZ: -4.5, maxZ: -3.5, minY: 1.2 },
        { x: 4, z: 0, label: '後方角', type: 'position', minX: 3.5, minZ: -0.5, maxZ: 0.5, minY: 1.2 },
        { x: 0, z: 0, label: '回起點', type: 'position', minX: -0.5, maxX: 0.5, minZ: -0.5, maxZ: 0.5, minY: 1.2 },
        { x: 0, z: -2, label: '降落', type: 'altitude', maxY: 0.5 },
      ],
    },
  },
  {
    id: 'task-relay-3',
    category: 'tasks',
    name: '三站接力',
    desc: '依序抵達三個檢查點（賽事接力風）',
    patch: {
      hud: '依序抵達 3 個檢查點',
      passZones: [
        { x: 0, z: -2, label: '起飛', type: 'altitude', minY: 0.5 },
        { x: 0, z: -5, label: '站 1', type: 'position', maxZ: -4.5, minY: 1 },
        { x: 4, z: -8, label: '站 2', type: 'position', minX: 3.5, maxZ: -7.5, minY: 1 },
        { x: -4, z: -11, label: '站 3', type: 'position', maxX: -3.5, maxZ: -10.5, minY: 1 },
        { x: 0, z: -2, label: '降落', type: 'altitude', maxY: 0.5 },
      ],
    },
  },
  {
    id: 'task-precision-land',
    category: 'tasks',
    name: '精準降落',
    desc: '飛到前方平台區域並降落',
    patch: {
      returnHome: false,
      hud: '飛到前方平台並降落',
      passZones: [
        { x: 0, z: -2, label: '起飛', type: 'altitude', minY: 0.5 },
        { x: 0, z: -7, label: '抵達平台區', type: 'position', minX: -1.5, maxX: 1.5, minZ: -8, maxZ: -6, minY: 1 },
        { x: 0, z: -7, label: '降落在平台', type: 'altitude', maxY: 0.5 },
      ],
    },
  },
  {
    id: 'task-yaw-180',
    category: 'tasks',
    name: '半圈轉向',
    desc: '起飛後轉 180° 再回正',
    patch: {
      hud: '轉半圈再回正',
      passZones: [
        { x: 0, z: -2, label: '起飛', type: 'altitude', minY: 0.5 },
        { x: 0, z: -2, label: '轉 180°', type: 'heading', targetYaw: 180, tolerance: 25 },
        { x: 0, z: -2, label: '回正', type: 'heading', targetYaw: 0, tolerance: 25 },
        { x: 0, z: -2, label: '降落', type: 'altitude', maxY: 0.5 },
      ],
    },
  },
  // --- 競速賽道 ---
  {
    id: 'race-gate-sprint',
    category: 'races',
    name: '門框衝刺',
    desc: '三連門 + 終點圈（FPV 入門）',
    patch: {
      returnHome: true,
      hud: '穿過三道門 → 終點圈 → 返航',
      obstacles: [
        { type: 'cube', solid: true, x: -2, y: 1.5, z: -4, size: 1, color: '#f87171' },
        { type: 'cube', solid: true, x: 2, y: 1.5, z: -4, size: 1, color: '#f87171' },
        { type: 'cube', solid: true, x: -2, y: 1.5, z: -8, size: 1, color: '#f87171' },
        { type: 'cube', solid: true, x: 2, y: 1.5, z: -8, size: 1, color: '#f87171' },
        { type: 'cube', solid: true, x: -2, y: 1.5, z: -12, size: 1, color: '#f87171' },
        { type: 'cube', solid: true, x: 2, y: 1.5, z: -12, size: 1, color: '#f87171' },
      ],
      rings: [{ x: 0, y: 2.5, z: -14, color: '#fbbf24', label: '終點' }],
    },
  },
  {
    id: 'race-slalom-mix',
    category: 'races',
    name: '繞柱＋穿圈',
    desc: 'S 形繞柱後接直線穿圈',
    patch: {
      returnHome: true,
      hud: '繞柱 → 穿圈 → 返航',
      obstacles: [
        { type: 'cube', solid: true, x: -2.5, y: 1.5, z: -4, size: 1, color: '#f87171' },
        { type: 'cube', solid: true, x: 2.5, y: 1.5, z: -6, size: 1, color: '#f87171' },
        { type: 'cube', solid: true, x: -2.5, y: 1.5, z: -8, size: 1, color: '#f87171' },
      ],
      rings: [
        { x: 0, y: 2.5, z: -10, label: '1' },
        { x: 0, y: 2.5, z: -13, label: '2' },
      ],
    },
  },
  {
    id: 'race-checkpoint-4',
    category: 'races',
    name: '四站競速',
    desc: '僅檢查點、無障礙（計時賽基礎）',
    patch: {
      hud: '依序抵達 4 站',
      passZones: [
        { x: 0, z: -2, label: '起飛', type: 'altitude', minY: 0.5 },
        { x: 0, z: -5, label: 'CP1', type: 'position', maxZ: -4.5, minY: 1 },
        { x: 4, z: -8, label: 'CP2', type: 'position', minX: 3.5, maxZ: -7.5, minY: 1 },
        { x: 0, z: -11, label: 'CP3', type: 'position', maxZ: -10.5, minY: 1 },
        { x: -4, z: -8, label: 'CP4', type: 'position', maxX: -3.5, maxZ: -7.5, minY: 1 },
        { x: 0, z: -2, label: '降落', type: 'altitude', maxY: 0.5 },
      ],
    },
  },
  // --- 完整情境模板 ---
  {
    id: 'scene-face-rings-full',
    category: 'scenes',
    name: '旋轉鑽圈（完整關）',
    desc: '官方 1-5 完整可玩關卡',
    forceIntro: true,
    patch: {
      returnHome: true,
      hud: '轉向對準紅圈穿過（3 個）→ 飛回原點降落',
      intro:
        '紅圈要「機頭對準」才算穿過。先轉向、再往前飛！\n升到 3m → 依序穿 3 個紅圈 → 飛回起飛墊降落。',
      rings: [
        { x: 5, y: 3, z: 0, color: 'red', label: '1', faceYaw: 270, faceTol: 40 },
        { x: 5, y: 3, z: -5, color: 'red', label: '2', faceYaw: 0, faceTol: 40 },
        { x: 0, y: 3, z: -5, color: 'red', label: '3', faceYaw: 90, faceTol: 40 },
      ],
      obstacles: [],
      passZones: [],
    },
  },
  {
    id: 'scene-balloon-adventure',
    category: 'scenes',
    name: '氣球大冒險',
    desc: '官方 1-6 風格：12 氣球 + 障礙',
    forceIntro: true,
    patch: {
      freeplay: true,
      returnHome: false,
      hud: '戳破 12 顆氣球',
      intro: '天空中藏了 12 顆氣球，繞過障礙把它們全部戳破！',
      obstacles: [
        { type: 'cube', solid: true, x: 3.5, y: 3, z: -6.5, size: 2, color: '#4dd0e1' },
        { type: 'cube', solid: true, x: -3.5, y: 3, z: -6.5, size: 2, color: '#4dd0e1' },
        { type: 'cube', solid: true, x: 0, y: 4, z: -12, size: 2, color: '#9b5de5' },
        { type: 'cube', solid: true, x: 5, y: 4.5, z: 5, size: 2, color: '#4ade80' },
        { type: 'cube', solid: true, x: -5, y: 4.5, z: 5, size: 2, color: '#4ade80' },
      ],
      balloons: [
        { x: 6, y: 1.8, z: -4 },
        { x: -6, y: 1.8, z: -4 },
        { x: 0, y: 1.5, z: -9 },
        { x: 0, y: 2.2, z: 7 },
        { x: 10, y: 3.5, z: -2 },
        { x: -10, y: 3.5, z: -2 },
        { x: 8, y: 3.5, z: -11 },
        { x: -8, y: 3.5, z: -11 },
        { x: 0, y: 6, z: -14 },
        { x: 9, y: 5, z: 8 },
        { x: -9, y: 5, z: 8 },
        { x: 0, y: 5.5, z: 12 },
      ],
    },
  },
  {
    id: 'scene-search-grid',
    category: 'scenes',
    name: '搜救九宮格',
    desc: '3×3 氣球網格（搜尋任務）',
    forceIntro: true,
    patch: {
      freeplay: true,
      returnHome: false,
      hud: '搜尋並戳破 9 顆氣球',
      intro: '九宮格分布的氣球，從近到遠逐一搜尋戳破。',
      balloons: [
        { x: -4, y: 2, z: -4 },
        { x: 0, y: 2.2, z: -4 },
        { x: 4, y: 2, z: -4 },
        { x: -4, y: 2.5, z: -8 },
        { x: 0, y: 3, z: -8 },
        { x: 4, y: 2.5, z: -8 },
        { x: -4, y: 2, z: -12 },
        { x: 0, y: 2.8, z: -12 },
        { x: 4, y: 2, z: -12 },
      ],
    },
  },
  {
    id: 'scene-rally-pro',
    category: 'scenes',
    name: '綜合拉力賽',
    desc: '門框 + 穿圈 + 檢查點完整賽道',
    forceIntro: true,
    patch: {
      returnHome: true,
      hud: '門框 → 穿圈 → 檢查點 → 返航',
      intro: '綜合賽道：先穿門框，再穿圈，最後抵達檢查點返航。',
      obstacles: [
        { type: 'cube', solid: true, x: -2, y: 1.5, z: -3, size: 1, color: '#f87171' },
        { type: 'cube', solid: true, x: 2, y: 1.5, z: -3, size: 1, color: '#f87171' },
      ],
      rings: [
        { x: 0, y: 2.5, z: -7, label: '1' },
        { x: 3, y: 2.5, z: -10, label: '2' },
      ],
      passZones: [
        { x: 0, z: -2, label: '起飛', type: 'altitude', minY: 0.5 },
        { x: 0, z: -13, label: '終點檢查', type: 'position', maxZ: -12.5, minY: 1 },
      ],
    },
  },
  {
    id: 'scene-precision-full',
    category: 'scenes',
    name: '精準降落（完整）',
    desc: '前方平台標記 + 精準降落任務',
    forceIntro: true,
    patch: {
      returnHome: false,
      hud: '飛到平台並降落',
      intro: '起飛後飛到前方黃色平台區，精準降落在平台上。',
      obstacles: [{ type: 'soft-cube', x: 0, y: 0.15, z: -8, size: 2.5, color: '#fbbf24' }],
      passZones: [
        { x: 0, z: -2, label: '起飛', type: 'altitude', minY: 0.5 },
        { x: 0, z: -8, label: '抵達平台', type: 'position', minX: -1.5, maxX: 1.5, minZ: -9, maxZ: -7, minY: 1 },
        { x: 0, z: -8, label: '降落', type: 'altitude', maxY: 0.5 },
      ],
    },
  },
  // --- 畫畫（進階 / 官方章節）---
  {
    id: 'draw-triangle',
    category: 'draw',
    name: '畫三角形',
    desc: '官方 2-3 風格：三角形參考線',
    patch: {
      draw: true,
      drawHeight: 3,
      view: 'topdown',
      hud: '重複 3 次〔前進 6m，右轉 120°〕',
      intro: '用迴圈畫正三角形，外角 120°。',
      guide: [[0, 0], [0, -6], [5.2, -3], [0, 0]],
      passZones: [
        { x: 0, z: -6, label: '角 1', type: 'position', minX: -1.4, maxX: 1.4, minZ: -7.4, maxZ: -4.6, minY: 2 },
        { x: 5.2, z: -3, label: '角 2', type: 'position', minX: 3.8, maxX: 6.6, minZ: -4.4, maxZ: -1.6, minY: 2 },
        { x: 0, z: 0, label: '收尾', type: 'position', minX: -1.4, maxX: 1.4, minZ: -1.4, maxZ: 1.4, minY: 2 },
      ],
    },
  },
  {
    id: 'draw-star',
    category: 'draw',
    name: '畫五角星',
    desc: '官方 2-4 風格：五角星參考線',
    patch: {
      draw: true,
      drawHeight: 3,
      view: 'topdown',
      hud: '重複 5 次〔前進 6m，右轉 144°〕',
      intro: '星星每個尖角轉 144°。',
      guide: [[0, 0], [0, -6], [3.53, -1.15], [-2.18, -3], [3.53, -4.85], [0, 0]],
      passZones: [
        { x: 0, z: -6, label: '尖角 1', type: 'position', minX: -1.4, maxX: 1.4, minZ: -7.4, maxZ: -4.6, minY: 2 },
        { x: 3.53, z: -1.15, label: '尖角 2', type: 'position', minX: 2.1, maxX: 4.9, minZ: -2.55, maxZ: 0.25, minY: 2 },
        { x: -2.18, z: -3, label: '尖角 3', type: 'position', minX: -3.6, maxX: -0.8, minZ: -4.4, maxZ: -1.6, minY: 2 },
        { x: 3.53, z: -4.85, label: '尖角 4', type: 'position', minX: 2.1, maxX: 4.9, minZ: -6.25, maxZ: -3.45, minY: 2 },
        { x: 0, z: 0, label: '收尾', type: 'position', minX: -1.4, maxX: 1.4, minZ: -1.4, maxZ: 1.4, minY: 2 },
      ],
    },
  },
  {
    id: 'draw-hexagon',
    category: 'draw',
    name: '畫六邊形',
    desc: '重複 6 次〔前進 4m，右轉 60°〕',
    patch: {
      draw: true,
      drawHeight: 3,
      view: 'topdown',
      hud: '重複 6 次〔前進 4m，右轉 60°〕',
      guide: [[0, 0], [0, -4], [3.46, -2], [3.46, 2], [0, 4], [-3.46, 2], [-3.46, -2], [0, 0]],
      passZones: [
        { x: 0, z: -4, label: '角 1', type: 'position', minX: -1.4, maxX: 1.4, minZ: -5.4, maxZ: -2.6, minY: 2 },
        { x: 3.46, z: -2, label: '角 2', type: 'position', minX: 2, maxX: 4.9, minZ: -3.4, maxZ: -0.6, minY: 2 },
        { x: 0, z: 0, label: '收尾', type: 'position', minX: -1.4, maxX: 1.4, minZ: -1.4, maxZ: 1.4, minY: 2 },
      ],
    },
  },
  {
    id: 'draw-spiral-3d',
    category: 'draw',
    name: '螺旋上升（3D）',
    desc: '官方 3-1 風格：立體螺旋塔',
    patch: {
      draw: true,
      drawHeight: 1,
      view: 'orbit3d',
      orbit: { center: [2.3, 6, -0.8], radius: 13, height: 9 },
      hud: '重複 20 次〔前進 1.5、右轉 36°、上升 0.5〕',
      intro: '前進 + 轉彎 + 上升放進迴圈，畫出螺旋塔。',
      passZones: [
        { x: 0, z: 0, label: '起飛離地', type: 'altitude', minY: 1.0 },
        { x: 4.6, z: 0, label: '螺旋半途', type: 'position', minX: 3.1, maxX: 6.1, minZ: -1.5, maxZ: 1.5, minY: 3.5, maxY: 5.5 },
        { x: 0, z: 0, label: '螺旋到頂', type: 'position', minX: -1.5, maxX: 1.5, minZ: -1.5, maxZ: 1.5, minY: 10.5 },
      ],
    },
  },
  {
    id: 'draw-free-3d',
    category: 'draw',
    name: '立體自由創作',
    desc: '官方 3-4 風格：orbit3d 自由畫',
    patch: {
      draw: true,
      drawHeight: 1,
      view: 'orbit3d',
      orbit: { center: [0, 4, 0], radius: 14, height: 9 },
      freeplay: true,
      hud: '立體自由創作',
      intro: '用上升/下降 + 畫筆，創作立體作品。',
      penColors: ['#ff5252', '#42a5f5', '#66bb6a', '#ffd54f', '#ab47bc'],
      passZones: [],
    },
  },
];

/** 場地邊界（世界座標 ±14.5m 內） */
export const LEVEL_KIT_BOUNDS = 14.5;

export type LevelKitApplyMode = 'append' | 'replace-tasks';

function inBounds(x: number, z: number): boolean {
  return x >= -LEVEL_KIT_BOUNDS && x <= LEVEL_KIT_BOUNDS && z >= -LEVEL_KIT_BOUNDS && z <= LEVEL_KIT_BOUNDS;
}

/** 驗證素材片段資料完整且座標在場地內；回傳錯誤訊息（空陣列 = 通過） */
export function validateLevelKitSnippet(snippet: LevelKitSnippet): string[] {
  const errs: string[] = [];
  const p = snippet.patch;
  const tag = snippet.id;

  if (!snippet.name.trim()) errs.push(`${tag}: 缺少名稱`);

  for (const r of p.rings ?? []) {
    if (typeof r.x !== 'number' || typeof r.y !== 'number' || typeof r.z !== 'number') {
      errs.push(`${tag}: 圈座標不完整`);
    } else if (!inBounds(r.x, r.z)) {
      errs.push(`${tag}: 圈 (${r.x}, ${r.z}) 超出場地`);
    }
    if (r.y < 0 || r.y > 12) errs.push(`${tag}: 圈高度 y=${r.y} 不合理`);
  }

  for (const o of p.obstacles ?? []) {
    if (typeof o.x !== 'number' || typeof o.y !== 'number' || typeof o.z !== 'number') {
      errs.push(`${tag}: 障礙座標不完整`);
    } else if (!inBounds(o.x, o.z)) {
      errs.push(`${tag}: 障礙 (${o.x}, ${o.z}) 超出場地`);
    }
    if ((o.size ?? 1) <= 0) errs.push(`${tag}: 障礙 size 無效`);
  }

  for (const b of p.balloons ?? []) {
    if (typeof b.x !== 'number' || typeof b.y !== 'number' || typeof b.z !== 'number') {
      errs.push(`${tag}: 氣球座標不完整`);
    } else if (!inBounds(b.x, b.z)) {
      errs.push(`${tag}: 氣球 (${b.x}, ${b.z}) 超出場地`);
    }
  }

  for (const z of p.passZones ?? []) {
    if (!z.label?.trim()) errs.push(`${tag}: 任務步驟缺少 label`);
    if (!inBounds(z.x, z.z)) errs.push(`${tag}: 任務點 (${z.x}, ${z.z}) 超出場地`);
    if (z.type === 'heading' && typeof z.targetYaw !== 'number') {
      errs.push(`${tag}: heading 缺少 targetYaw`);
    }
  }

  const hasContent =
    (p.rings?.length ?? 0) > 0 ||
    (p.obstacles?.length ?? 0) > 0 ||
    (p.balloons?.length ?? 0) > 0 ||
    (p.passZones?.length ?? 0) > 0 ||
    p.draw === true ||
    (p.guide?.length ?? 0) > 0;

  if (!hasContent) errs.push(`${tag}: 片段無任何可玩內容`);

  if (p.draw && !p.view) errs.push(`${tag}: draw 模式需指定 view`);

  return errs;
}

export function validateAllLevelKitSnippets(): { id: string; errors: string[] }[] {
  return LEVEL_KIT_SNIPPETS
    .map((s) => ({ id: s.id, errors: validateLevelKitSnippet(s) }))
    .filter((r) => r.errors.length > 0);
}

/**
 * 將素材片段合併進關卡 definition。
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
  if (p.intro && (snippet.forceIntro || !next.intro?.trim())) next.intro = p.intro;
  if (p.hud) next.hud = p.hud;
  if (p.returnHome !== undefined) next.returnHome = p.returnHome;
  if (p.freeplay !== undefined) next.freeplay = p.freeplay;
  if (p.draw !== undefined) next.draw = p.draw;
  if (p.drawHeight !== undefined) next.drawHeight = p.drawHeight;
  if (p.view !== undefined) next.view = p.view;
  if (p.orbit) next.orbit = { ...p.orbit };
  if (p.guide?.length) next.guide = [...p.guide];
  if (p.penColors?.length) next.penColors = [...p.penColors];

  return next;
}

export function getLevelKitSnippet(id: string): LevelKitSnippet | undefined {
  return LEVEL_KIT_SNIPPETS.find((s) => s.id === id);
}

export function levelKitByCategory(category: LevelKitCategory): LevelKitSnippet[] {
  return LEVEL_KIT_SNIPPETS.filter((s) => s.category === category);
}
