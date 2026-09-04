// 教學目標精靈 — 依教學情境組合官方素材片段，快速起稿自訂關卡。
import type { LevelDef } from './levels';
import { applyLevelKitSnippet, getLevelKitSnippet, type LevelKitApplyMode } from './levelKit';

export interface LevelGoalPreset {
  id: string;
  name: string;
  desc: string;
  /** 卡片上顯示的簡短標籤 */
  tag: string;
  /** 依序套用的官方素材 id */
  snippetIds: string[];
  intro?: string;
  hud?: string;
  titleHint?: string;
  returnHome?: boolean;
  freeplay?: boolean;
}

export const LEVEL_GOAL_PRESETS: LevelGoalPreset[] = [
  {
    id: 'goal-rings-basic',
    name: '初學穿圈',
    desc: '直線三圈，練基本前飛與返航降落',
    tag: '穿圈',
    snippetIds: ['rings-line-3'],
    intro: '依序穿過三個藍色圈，最後飛回黃色起飛墊降落。',
    hud: '依序穿過 3 個圈 → 返航降落',
    titleHint: '初學穿圈練習',
    returnHome: true,
  },
  {
    id: 'goal-turn',
    name: '轉向控制',
    desc: 'S 形左右交錯穿圈',
    tag: '穿圈',
    snippetIds: ['rings-slalom'],
    intro: '注意左右轉向，依序穿過 S 形路線上的圈。',
    hud: 'S 形穿圈 → 返航',
    titleHint: '轉向穿圈練習',
    returnHome: true,
  },
  {
    id: 'goal-takeoff',
    name: '起飛與降落',
    desc: '垂直起飛、定高、精準降落任務',
    tag: '任務',
    snippetIds: ['task-takeoff-land'],
    intro: '依任務提示完成起飛、維持高度與降落。',
    titleHint: '起飛降落任務',
    returnHome: false,
  },
  {
    id: 'goal-altitude',
    name: '定高飛行',
    desc: '練習維持 2–3m 高度',
    tag: '任務',
    snippetIds: ['task-altitude'],
    intro: '起飛後維持指定高度區間飛行。',
    titleHint: '定高飛行練習',
    returnHome: false,
  },
  {
    id: 'goal-balloons',
    name: '戳氣球',
    desc: '收集場上氣球，趣味入門',
    tag: '情境',
    snippetIds: ['scene-balloons-3'],
    intro: '飛近氣球把它戳破，全部收集完畢！',
    titleHint: '戳氣球趣玩',
    freeplay: true,
    returnHome: false,
  },
  {
    id: 'goal-face-yaw',
    name: '旋轉鑽圈',
    desc: '機頭需對準紅圈方向才算過',
    tag: '進階',
    snippetIds: ['scene-face-rings-full'],
    intro: '紅色圈需機頭對準後再穿過，練習 yaw 控制。',
    titleHint: '旋轉鑽圈挑戰',
    returnHome: true,
  },
  {
    id: 'goal-gate-rings',
    name: '門框穿圈',
    desc: '先過門框障礙，再穿三圈',
    tag: '綜合',
    snippetIds: ['obs-gate', 'rings-line-3'],
    intro: '從門框中間穿過，再完成穿圈路線。',
    hud: '過門框 → 穿 3 圈 → 返航',
    titleHint: '門框穿圈綜合',
    returnHome: true,
  },
  {
    id: 'goal-draw',
    name: '畫直線',
    desc: '畫畫教室，用程式畫出直線',
    tag: '畫畫',
    snippetIds: ['draw-line'],
    intro: '用程式控制無人機，沿參考線畫出直線。',
    titleHint: '畫直線教室',
    returnHome: false,
  },
  {
    id: 'goal-race',
    name: '競速衝刺',
    desc: '門框 + 穿圈短賽道',
    tag: '競速',
    snippetIds: ['race-gate-sprint'],
    intro: '依序通過檢查點，用最短時間完成賽道。',
    titleHint: '競速衝刺',
    returnHome: false,
  },
  {
    id: 'goal-warmup',
    name: '自由熱身',
    desc: '無過關壓力，熟悉操控',
    tag: '熱身',
    snippetIds: ['scene-warmup'],
    intro: '自由飛行熟悉場地，想飛多久就飛多久。',
    titleHint: '自由熱身',
    freeplay: true,
    returnHome: false,
  },
];

function snippetApplyMode(snippetId: string): LevelKitApplyMode {
  const snip = getLevelKitSnippet(snippetId);
  if (!snip) return 'append';
  if (snip.category === 'tasks' || snip.category === 'draw' || snip.category === 'races') {
    return 'replace-tasks';
  }
  return 'append';
}

/** 關卡是否尚無任何佈局（適合顯示精靈提示） */
export function isLevelLayoutEmpty(level: LevelDef): boolean {
  return (
    (level.rings?.length ?? 0) === 0 &&
    (level.obstacles?.length ?? 0) === 0 &&
    (level.balloons?.length ?? 0) === 0 &&
    (level.passZones?.length ?? 0) === 0 &&
    !level.draw &&
    !(level.guide?.length)
  );
}

export function getLevelGoalPreset(id: string): LevelGoalPreset | undefined {
  return LEVEL_GOAL_PRESETS.find((p) => p.id === id);
}

/**
 * 套用教學目標模板。
 * @param mode replace = 清空佈局後套用；append = 在現有佈局上追加
 */
export function applyLevelGoalPreset(
  level: LevelDef,
  presetId: string,
  mode: 'replace' | 'append' = 'replace',
): LevelDef | null {
  const preset = getLevelGoalPreset(presetId);
  if (!preset) return null;

  let next: LevelDef =
    mode === 'replace'
      ? {
          ...level,
          rings: [],
          obstacles: [],
          balloons: [],
          passZones: [],
          draw: undefined,
          drawHeight: undefined,
          view: undefined,
          orbit: undefined,
          guide: undefined,
          penColors: undefined,
          freeplay: undefined,
        }
      : { ...level };

  if (preset.titleHint && mode === 'replace') next.name = preset.titleHint;
  if (preset.intro) next.intro = preset.intro;
  if (preset.hud) next.hud = preset.hud;
  if (preset.returnHome !== undefined) next.returnHome = preset.returnHome;
  if (preset.freeplay !== undefined) next.freeplay = preset.freeplay;

  for (const snippetId of preset.snippetIds) {
    const snip = getLevelKitSnippet(snippetId);
    if (!snip) continue;
    next = applyLevelKitSnippet(next, snip, snippetApplyMode(snippetId));
  }

  return next;
}
