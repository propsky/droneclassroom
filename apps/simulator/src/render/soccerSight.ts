// 全場／考證：鏡頭這一端擋視線的門環、端牆中橫梁、端牆網用固定半透明。
// 只改外觀。鏡位、碰撞、進球判定都不在這裡。
// 跟隨與第一人稱維持不透明。

/** 與 CameraViewMode 同一組字串。放在這裡避免 core 事件去依賴 render。 */
export type SoccerSightMode = 'follow' | 'team' | 'exam' | 'fpv';

/**
 * 半透明強度（1 = 不透明）。
 * 門環自發光很強，再高就還是一塊實心色；再低遠看會消失。
 * 端牆網原本就有自己的 alpha，套用時直接改成這個值。
 */
export const SOCCER_SIGHT_VEIL = 0.32;

/** 全場或考證，而且這一面就是鏡頭站的那一端，才淡化。 */
export function soccerSightVeiled(mode: SoccerSightMode, end: 1 | -1, nearEnd: 1 | -1): boolean {
  if (mode !== 'team' && mode !== 'exam') return false;
  return end === nearEnd;
}
