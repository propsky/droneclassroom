import { describe, expect, it } from 'vitest';
import { F9A_A, F9A_B, SOCCER_FIELD, type SoccerClassPreset } from './constants';
import {
  scoreboardBlocksRingMouth,
  soccerScoreboardPoses,
  type ScoreboardField,
} from './scoreboardPose';

function fieldOf(preset: SoccerClassPreset): ScoreboardField {
  return {
    halfX: preset.halfX,
    halfZ: preset.halfZ,
    top: preset.top,
    goalZ: preset.halfZ - preset.goalInset,
    goalY: preset.goalY,
    goalR: preset.goalR,
    goalTube: preset.goalTube,
  };
}

describe('計分板不擋穿環', () => {
  it('兩端牆上方，不在中線，也不蓋住圓環開口', () => {
    for (const preset of [F9A_A, F9A_B]) {
      const field = fieldOf(preset);
      const poses = soccerScoreboardPoses(field);
      expect(poses).toHaveLength(2);
      const signs = poses.map((p) => Math.sign(p.z));
      expect(signs).toContain(1);
      expect(signs).toContain(-1);
      for (const pose of poses) {
        expect(Math.abs(pose.z)).toBeGreaterThan(field.goalZ);
        expect(Math.abs(pose.z)).toBeLessThan(field.halfZ);
        expect(pose.depth).toBeLessThan(0.1);
        const ringTop = field.goalY + field.goalR + field.goalTube * 2;
        expect(pose.y - pose.height / 2).toBeGreaterThan(ringTop - 1e-6);
        expect(pose.y + pose.height / 2).toBeLessThanOrEqual(field.top - 0.05);
        expect(scoreboardBlocksRingMouth(pose, field)).toBe(false);
      }
    }
    const practice = soccerScoreboardPoses(SOCCER_FIELD);
    expect(practice.every((p) => Math.abs(p.z) > 2)).toBe(true);
  });
});
