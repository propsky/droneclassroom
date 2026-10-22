import { describe, expect, it } from 'vitest';
import { SceneEnvChoice } from './sceneEnvChoice';

describe('SceneEnvChoice', () => {
  it('網址 scene 優先於記住的選擇', () => {
    expect(SceneEnvChoice.read('?scene=exhibition', 'default')).toBe('exhibition');
    expect(SceneEnvChoice.read('?scene=default', 'exhibition')).toBe('default');
  });

  it('沒有網址時用記住的值，不認得的字退回教室', () => {
    expect(SceneEnvChoice.read('', 'exhibition')).toBe('exhibition');
    expect(SceneEnvChoice.read('?scene=nope', 'exhibition')).toBe('exhibition');
    expect(SceneEnvChoice.read('', null)).toBe('default');
  });

  it('在教室與展場之間切換', () => {
    expect(SceneEnvChoice.next('default')).toBe('exhibition');
    expect(SceneEnvChoice.next('exhibition')).toBe('default');
    expect(SceneEnvChoice.label('exhibition')).toBe('展場');
    expect(SceneEnvChoice.label('default')).toBe('教室');
  });
});
