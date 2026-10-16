// 學生積木頁「模擬器／真機」切換要不要出現。
// 工具列只問這裡。PR-C 改成依老師的班級設定開放時，改這個函式即可。
import type { ExecutionMode } from '@creafly/shared';

/**
 * 現在一律顯示，不看網址參數。
 * PR-C：改成讀老師為這個班級開的真機權限。
 */
export function isRealDroneSwitchVisible(): boolean {
  return true;
}

/**
 * 切換沒開放時，即使上次選過真機也維持模擬器。
 * 切換有開放時，沿用上次選擇；沒存過就是模擬器。
 */
export function resolveInitialExecutionMode(
  stored: ExecutionMode,
  switchVisible = isRealDroneSwitchVisible(),
): ExecutionMode {
  if (!switchVisible) return 'sim';
  return stored === 'real' ? 'real' : 'sim';
}
