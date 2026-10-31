import { describe, expect, it } from 'vitest';
import { F9A_A, F9A_B } from '../soccer/constants';
import { SOCCER_FOLLOW_DISTANCE, SOCCER_FOLLOW_HEIGHT } from '../soccer/enclosureView';
import { HOME_POSITION } from '../core/droneState';
import { CameraCoverage } from './cameraCoverage';
import { CameraSight } from './cameraSight';
import { PilotView } from './pilotView';

function fieldOf(preset: typeof F9A_A) {
  return {
    halfX: preset.halfX,
    halfZ: preset.halfZ,
    top: preset.top,
    goalZ: preset.halfZ - preset.goalInset,
    goalY: preset.goalY,
    goalR: preset.goalR,
    goalTube: preset.goalTube,
    shieldR: preset.shieldR,
    startDepth: preset.startDepth,
    startWidth: preset.shieldR * 2,
    startZ: preset.halfZ - preset.startDepth / 2,
  };
}

describe('鏡頭不被門框或場景幾何擋住', () => {
  const rows = CameraCoverage.checkAll();

  it('每個場景、隊伍、視角的焦點暢通；考證與全場看得到起飛區、半場與遠門', () => {
    const bad = CameraCoverage.failures(rows).map((row) => ({
      scene: row.scene,
      team: row.team,
      view: row.view,
      focus: row.focusBlocker,
      field: row.fieldBlocked,
    }));
    expect(bad).toEqual([]);
  });

  it('舊的全場鏡位會被近端門框擋住，新的不會', () => {
    for (const preset of [F9A_A, F9A_B]) {
      const field = fieldOf(preset);
      expect(CameraCoverage.legacyTeamBlocked(field, 1)).toBeTruthy();
      expect(CameraCoverage.legacyTeamBlocked(field, -1)).toBeTruthy();
      for (const sign of [1, -1] as const) {
        if (preset.id === 'F9A-B') {
          const legacy = PilotView.nearGoalFraming(PilotView.legacySoccerTeam(field, sign), field, sign);
          expect(legacy.throughDisk || legacy.diamDeg > 60).toBe(true);
        }
        const team = PilotView.soccerTeam(field, sign);
        const framing = PilotView.nearGoalFraming(team, field, sign);
        expect(framing.throughDisk).toBe(false);
        expect(framing.diamDeg).toBeLessThan(36);
        const solids = PilotView.soccerSolids(field, team.eye);
        for (const point of PilotView.soccerPitchPoints(field, sign)) {
          expect(PilotView.inFrame(team, point)).toBe(true);
          expect(CameraSight.blocker(team.eye, point, solids)).toBeNull();
        }
      }
    }
    const fixed = rows.filter((row) => row.view === 'team');
    expect(fixed.length).toBeGreaterThan(0);
    expect(fixed.every((row) => row.fieldBlocked.length === 0)).toBe(true);
  });

  it('練習場考證不再貼近端角落，近端門環不佔滿上半部', () => {
    const field = fieldOf(F9A_B);
    const corner: { eye: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } } = {
      eye: { x: field.halfX - 0.28, y: PilotView.EYE_HEIGHT_M, z: field.halfZ + PilotView.MIN_STAND_OFF_M },
      target: { x: 0, y: field.top / 2, z: 0 },
    };
    expect(PilotView.soccerExamDominated(corner, field, 1)).toBe(true);
    for (const sign of [1, -1] as const) {
      const exam = PilotView.soccerExam(field, sign);
      expect(PilotView.soccerExamDominated(exam, field, sign)).toBe(false);
      const framing = PilotView.nearGoalFraming(exam, field, sign);
      expect(framing.throughDisk).toBe(false);
      expect(framing.diamDeg).toBeLessThan(32);
      expect(exam.eye.y).toBeGreaterThan(field.top * 0.5);
      const solids = PilotView.soccerSolids(field, exam.eye);
      for (const point of PilotView.soccerPitchPoints(field, sign)) {
        expect(PilotView.inFrame(exam, point)).toBe(true);
        expect(CameraSight.blocker(exam.eye, point, solids)).toBeNull();
      }
    }
  });

  it('跟隨與第一人稱的鏡位公式不變', () => {
    const field = fieldOf(F9A_B);
    const pos = { x: 0, y: HOME_POSITION.y, z: field.startZ };
    const follow = PilotView.soccerFollow(pos, 0);
    expect(follow.eye).toEqual({
      x: 0,
      y: HOME_POSITION.y + SOCCER_FOLLOW_HEIGHT,
      z: field.startZ + SOCCER_FOLLOW_DISTANCE,
    });
    expect(follow.target).toEqual({ x: 0, y: HOME_POSITION.y + 0.02, z: field.startZ });
    const fpv = PilotView.fpv(pos, 0, field);
    expect(fpv.eye.z).toBeCloseTo(field.startZ - 0.35);
    expect(fpv.eye.y).toBeCloseTo(HOME_POSITION.y + 0.45);
    expect(fpv.eye.x).toBeCloseTo(0);
  });

  it('紅藍兩隊的考證與全場站在相反的短邊，眼高是 1.65', () => {
    const exam = rows.filter((row) => row.scene === '足球 F9A-A 對戰' && row.view === 'exam');
    const red = exam.find((row) => row.team === '紅');
    const blue = exam.find((row) => row.team === '藍');
    expect(red && blue).toBeTruthy();
    expect(red!.eye.z).toBeGreaterThan(0);
    expect(blue!.eye.z).toBeLessThan(0);
    expect(red!.eye.y).toBe(PilotView.EYE_HEIGHT_M);
    expect(blue!.eye.y).toBe(PilotView.EYE_HEIGHT_M);
    expect(CameraCoverage.examOutsideCage(fieldOf(F9A_A), 1)).toBe(true);
    expect(CameraCoverage.examOutsideCage(fieldOf(F9A_A), -1)).toBe(true);
    const team = rows.filter((row) => row.scene === '足球 F9A-A 對戰' && row.view === 'team');
    expect(team.find((row) => row.team === '紅')!.eye.z).toBeGreaterThan(0);
    expect(team.find((row) => row.team === '藍')!.eye.z).toBeLessThan(0);
  });

  it('1-6 跟隨鏡頭會側開，不會停在氣球正後方', () => {
    const row = rows.find((item) => item.scene === '關卡 1-6' && item.view === 'follow');
    expect(row?.focusClear).toBe(true);
    expect(Math.abs(row!.eye.x)).toBeGreaterThan(4);
  });

  it('大亂鬥鬼與跑者共用同一組鏡位，而且站在場外', () => {
    const runners = rows.filter((row) => row.scene === '大亂鬥 格線' && row.team === '跑者');
    const ghosts = rows.filter((row) => row.scene === '大亂鬥 格線' && row.team === '鬼');
    expect(runners.map((row) => row.eye)).toEqual(ghosts.map((row) => row.eye));
    expect(CameraCoverage.arenaEyeOutside()).toBe(true);
  });
});
