// 場景環境變體（F-02 展場 / 一般教室）。
export type SceneEnv = 'default' | 'exhibition';

export const SCENE_ENV_LABELS: Record<SceneEnv, string> = {
  default: '一般',
  exhibition: '展場',
};

export function parseSceneEnv(v: unknown): SceneEnv | undefined {
  if (v === 'default' || v === 'exhibition') return v;
  return undefined;
}
