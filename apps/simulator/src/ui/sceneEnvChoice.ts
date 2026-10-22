// 背景切換（?scene=default|exhibition）。網址優先，其次這次分頁記住的選擇。
import { parseSceneEnv, type SceneEnv } from '@creafly/shared';

export class SceneEnvChoice {
  static readonly STORAGE_KEY = 'creafly_scene_env';

  static read(search: string, stored: string | null): SceneEnv {
    const fromUrl = parseSceneEnv(new URLSearchParams(search).get('scene'));
    if (fromUrl) return fromUrl;
    return parseSceneEnv(stored) ?? 'default';
  }

  static next(current: SceneEnv): SceneEnv {
    return current === 'default' ? 'exhibition' : 'default';
  }

  static label(env: SceneEnv): string {
    return env === 'exhibition' ? '展場' : '教室';
  }
}
