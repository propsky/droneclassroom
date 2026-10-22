// 頂部「背景」按鈕。?scene= 仍可用；沒有網址時也看得到入口。
import type { SceneEnv } from '@creafly/shared';
import { bus } from '../core/events';
import { levelState } from '../core/level';
import { iconHtml } from './icons';
import { SceneEnvChoice } from './sceneEnvChoice';

const $ = (id: string): HTMLElement | null => document.getElementById(id);

export function initSceneEnvControl(): void {
  const btn = $('scene-env-btn');
  if (!btn) return;

  const stored = (): string | null => {
    try {
      return sessionStorage.getItem(SceneEnvChoice.STORAGE_KEY);
    } catch {
      return null;
    }
  };

  const remember = (env: SceneEnv): void => {
    try {
      sessionStorage.setItem(SceneEnvChoice.STORAGE_KEY, env);
    } catch {
      /* 隱私模式就算了 */
    }
    const url = new URL(location.href);
    url.searchParams.set('scene', env);
    history.replaceState(null, '', url);
  };

  const paint = (env: SceneEnv): void => {
    btn.innerHTML = `${iconHtml('sun')}<span>背景：${SceneEnvChoice.label(env)}</span>`;
    btn.classList.toggle('active', env === 'exhibition');
    btn.title = env === 'exhibition' ? '目前是展場背景，點一下改回教室' : '目前是教室背景，點一下改成展場';
  };

  let choice = SceneEnvChoice.read(location.search, stored());
  if (parseScene(location.search)) remember(choice);
  paint(choice);

  btn.addEventListener('click', () => {
    choice = SceneEnvChoice.next(choice);
    remember(choice);
    paint(choice);
    bus.emit('scene-env-selected', { env: choice });
    if (levelState.current?.sceneEnv && levelState.current.sceneEnv !== choice) {
      bus.emit('toast', { text: '這一關指定了背景，離開這關後才會換成你選的', kind: 'warning' });
    }
  });

  bus.on('level-loaded', ({ level }) => {
    paint(level.sceneEnv ?? choice);
  });
}

function parseScene(search: string): boolean {
  return new URLSearchParams(search).has('scene');
}
