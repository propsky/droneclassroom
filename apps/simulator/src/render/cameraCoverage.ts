// 每個場景、隊伍、視角各算一次鏡頭，檢查焦點與飛行區取樣點有沒有被門框或其他幾何擋住。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LevelDef } from '@creafly/shared';
import { HOME_POSITION } from '../core/droneState';
import { ARENA_BOUND } from '../multiplayer/arena';
import { F9A_A, F9A_B, soccerCameraSign, type SoccerClassPreset } from '../soccer/constants';
import type { ActiveSoccerField } from '../soccer/field';
import { shellInner } from '../soccer/enclosureView';
import { CameraSight, type SightPoint, type SightSolid } from './cameraSight';
import { PilotView, type CameraPose, type CameraViewMode, type PilotEnd } from './pilotView';

export interface CoverageRow {
  scene: string;
  team: string;
  view: CameraViewMode;
  /** 這面鏡頭該看的焦點有沒有被擋住 */
  focusClear: boolean;
  focusBlocker: string | null;
  /** 全場類鏡頭才檢查飛行區取樣點；跟隨與 FPV 只對焦點負責 */
  checksField: boolean;
  fieldBlocked: string[];
  eye: SightPoint;
  target: SightPoint;
}

interface SceneCase {
  scene: string;
  team: string;
  sign: PilotEnd | null;
  field: ActiveSoccerField | null;
  level: LevelDef | null;
  arena: boolean;
  drone: SightPoint;
  yaw: number;
}

const VIEWS: CameraViewMode[] = ['follow', 'team', 'exam', 'fpv'];

export class CameraCoverage {
  static checkAll(levels: readonly LevelDef[] = CameraCoverage.officialLevels()): CoverageRow[] {
    const rows: CoverageRow[] = [];
    for (const scene of CameraCoverage.scenes(levels)) {
      for (const view of VIEWS) {
        if (view === 'team' && !scene.field) continue;
        rows.push(CameraCoverage.check(scene, view));
      }
    }
    return rows;
  }

  static failures(rows: readonly CoverageRow[]): CoverageRow[] {
    return rows.filter((row) => !row.focusClear || (row.checksField && row.fieldBlocked.length > 0));
  }

  /** 修改前的全場鏡位。練習場站在 +z，近端是藍門。 */
  static legacyTeamBlocked(field: ActiveSoccerField, sign: PilotEnd): string | null {
    const pose = PilotView.legacySoccerTeam(field, sign);
    const solids = PilotView.soccerSolids(field, pose.eye);
    const points = [
      { x: 0, y: Math.min(1.6, field.top * 0.45), z: 0 },
      { x: 0, y: field.goalY, z: -sign * field.goalZ },
    ];
    for (const point of points) {
      const name = CameraSight.blocker(pose.eye, point, solids);
      if (name) return name;
    }
    return null;
  }

  static officialLevels(): LevelDef[] {
    const root = join(dirname(fileURLToPath(import.meta.url)), '../../public/levels');
    const levels: LevelDef[] = [];
    for (const file of ['chapter1.json', 'chapter2.json', 'chapter3.json']) {
      const data = JSON.parse(readFileSync(join(root, file), 'utf8')) as { levels: LevelDef[] };
      levels.push(...data.levels);
    }
    return levels;
  }

  private static check(scene: SceneCase, view: CameraViewMode): CoverageRow {
    const pose = CameraCoverage.pose(scene, view);
    const solids = CameraCoverage.solids(scene, pose);
    const focusBlocker = CameraSight.blocker(
      pose.eye,
      pose.target,
      solids.filter((solid) => !solid.name.startsWith('端牆') && !solid.name.startsWith('邊牆')),
    );
    const checksField = view === 'exam' || view === 'team';
    const fieldBlocked = checksField
      ? PilotView.blockedSamples(pose, CameraCoverage.fieldPoints(scene), solids)
      : [];
    return {
      scene: scene.scene,
      team: scene.team,
      view,
      focusClear: focusBlocker == null,
      focusBlocker,
      checksField,
      fieldBlocked: [...new Set(fieldBlocked)],
      eye: pose.eye,
      target: pose.target,
    };
  }

  private static pose(scene: SceneCase, view: CameraViewMode): CameraPose {
    if (view === 'fpv') return PilotView.fpv(scene.drone, scene.yaw, scene.field);
    if (view === 'follow') {
      const pose = scene.field
        ? PilotView.soccerFollow(scene.drone, scene.yaw)
        : PilotView.thirdPerson(scene.drone, scene.yaw);
      if (scene.field || scene.arena) return pose;
      return PilotView.dodgeFocus(pose, PilotView.courseSolids(scene.level));
    }
    if (view === 'team' && scene.field && scene.sign) return PilotView.soccerTeam(scene.field, scene.sign);
    if (view === 'exam') {
      if (scene.field && scene.sign) return PilotView.soccerExam(scene.field, scene.sign);
      if (scene.arena) return PilotView.arenaExam();
      return PilotView.courseExam(scene.level);
    }
    return PilotView.thirdPerson(scene.drone, scene.yaw);
  }

  private static solids(scene: SceneCase, pose: CameraPose): SightSolid[] {
    if (scene.field) return PilotView.soccerSolids(scene.field, pose.eye);
    if (scene.arena) return PilotView.arenaSolids();
    return PilotView.courseSolids(scene.level);
  }

  private static fieldPoints(scene: SceneCase): SightPoint[] {
    if (scene.field && scene.sign) return PilotView.soccerPitchPoints(scene.field, scene.sign);
    if (scene.arena) return PilotView.keyPoints(PilotView.arenaBox());
    return PilotView.keyPoints(PilotView.courseBox(scene.level));
  }

  private static scenes(levels: readonly LevelDef[]): SceneCase[] {
    const scenes: SceneCase[] = [];
    for (const level of levels) {
      scenes.push({
        scene: `關卡 ${level.id}`,
        team: '無',
        sign: null,
        field: null,
        level,
        arena: false,
        drone: { x: 0, y: HOME_POSITION.y, z: 0 },
        yaw: 0,
      });
    }
    for (const preset of [F9A_A, F9A_B]) {
      const field = CameraCoverage.fieldOf(preset);
      const startZ = field.halfZ - field.startDepth / 2;
      scenes.push({
        scene: `足球 ${preset.id} 練習`,
        team: '練習（+z 藍門端）',
        sign: 1,
        field,
        level: null,
        arena: false,
        drone: { x: 0, y: HOME_POSITION.y, z: startZ },
        yaw: 0,
      });
      for (const team of ['red', 'blue'] as const) {
        const sign = soccerCameraSign(team) as PilotEnd;
        scenes.push({
          scene: `足球 ${preset.id} 對戰`,
          team: team === 'red' ? '紅' : '藍',
          sign,
          field,
          level: null,
          arena: false,
          drone: { x: 0, y: HOME_POSITION.y, z: sign * startZ },
          yaw: team === 'red' ? 0 : Math.PI,
        });
      }
    }
    for (const role of ['跑者', '鬼'] as const) {
      for (const fieldName of ['格線', '遊樂場'] as const) {
        scenes.push({
          scene: `大亂鬥 ${fieldName}`,
          team: role,
          sign: null,
          field: null,
          level: null,
          arena: true,
          drone: { x: 0, y: HOME_POSITION.y, z: 0 },
          yaw: 0,
        });
      }
    }
    return scenes;
  }

  private static fieldOf(preset: SoccerClassPreset): ActiveSoccerField {
    const goalZ = preset.halfZ - preset.goalInset;
    return {
      halfX: preset.halfX,
      halfZ: preset.halfZ,
      top: preset.top,
      goalZ,
      goalY: preset.goalY,
      goalR: preset.goalR,
      goalTube: preset.goalTube,
      shieldR: preset.shieldR,
      startDepth: preset.startDepth,
      startWidth: preset.shieldR * 2,
      startZ: preset.halfZ - preset.startDepth / 2,
    };
  }

  /** 考證鏡頭要站在籠外。給測試確認退距沒有站回飛行區。 */
  static examOutsideCage(field: ActiveSoccerField, sign: PilotEnd): boolean {
    const pose = PilotView.soccerExam(field, sign);
    const limit = shellInner(field.halfZ);
    return sign > 0 ? pose.eye.z > limit : pose.eye.z < -limit;
  }

  static arenaEyeOutside(): boolean {
    const pose = PilotView.arenaExam();
    return pose.eye.z > ARENA_BOUND.z && pose.eye.y === PilotView.EYE_HEIGHT_M;
  }
}
