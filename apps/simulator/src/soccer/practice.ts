// ⚽ 無人機足球 — 單人自由練習。
// 跟對戰同一套進球：練習員站 +z（紅隊那一側），只有從場內正面穿過對方（-z）球門才算分。
// 穿自己這側的門不加分。得分後要先回到自己半場（z > 0），下一球才算。
// 不計時、不扣分。場地用房間目前的子類；沒進房就用預設 F9A-B。
// 穿環幾何在 crossing.ts，與對戰同一套。
import { droneState, resetDroneState, HOME_POSITION, flags } from '../core/droneState';
import { setMeshCollisionBackend, setSolidObstacles } from '../core/physics';
import { clearLevel } from '../core/level';
import { GameSession } from '../core/session';
import { setMode } from '../core/program';
import { bus, toast, sound, stateHud } from '../core/events';
import { wsState } from '../net/ws';
import { advanceRingPassage, createRingPassage, type RingCross, type RingPassage } from './crossing';
import { bounceSoccerWalls } from './contact';
import { activeSoccerField, setSoccerFieldFromPreset } from './field';
import { showSoccerPracticeHud, setPracticeStatus, showSoccerFeel } from '../ui/soccerHud';

/** 練習計分。站在 +z、攻 -z。靜態方法，方便跟對戰規則對照。 */
export class PracticeScoring {
  /** 對方球門在 -z。 */
  static readonly attackSign = -1 as const;

  static onOwnHalf(z: number): boolean {
    return z > 0;
  }

  /**
   * opponentPassed：從場內正面穿過對方門。
   * ownPassed：穿過自己這側的門，一律不加分。
   * 得分後 needReturn，直到回到自己半場。
   */
  static apply(
    count: number,
    needReturn: boolean,
    opponentPassed: boolean,
    ownPassed: boolean,
    z: number,
  ): { count: number; needReturn: boolean; scored: boolean } {
    void ownPassed;
    const back = needReturn && PracticeScoring.onOwnHalf(z) ? false : needReturn;
    if (!opponentPassed || back) {
      return { count, needReturn: back, scored: false };
    }
    return { count: count + 1, needReturn: true, scored: true };
  }
}

/** 畫面分數。不出現任務步驟或「練習完成」。 */
export function formatPracticeScore(count: number): string {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return `分數：${n}`;
}

export const practiceState = {
  active: false,
  /** 自由練習累計進球，不封頂 */
  count: 0,
  /** 剛得分，還沒回到自己半場 */
  needReturn: false,
  startTime: 0,
  /** 上一 tick 的位置（穿環看護罩後緣與行進方向） */
  prevX: 0,
  prevY: 0.4,
  prevZ: 0,
};

// =============================================================================
// 初始化 / 進出場
// =============================================================================
export function initSoccerPractice(): void {
  // 開發後門：?soccer=1 自動進練習場（headless 驗收 / demo 用；對齊 ?arena=1）。
  // 等關卡清單載完再進場，避免預設關卡晚到把練習場蓋回教室。
  if (new URLSearchParams(location.search).get('soccer') === '1') {
    const offReady = bus.on('levels-ready', () => {
      offReady();
      const offLoaded = bus.on('level-loaded', () => {
        offLoaded();
        setTimeout(() => enterSoccerPractice(), 200);
      });
    });
  }
}

export function enterSoccerPractice(): void {
  if (practiceState.active) return;
  GameSession.enter('soccer-practice');
  practiceState.active = true;
  practiceState.count = 0;
  practiceState.needReturn = false;
  practiceState.startTime = Date.now();

  if (flags.mode !== 'manual') setMode('manual');
  clearLevel(); // 一般關卡判定 / 物件 / HUD 停用（main.ts 依 active 改跑 tickSoccerPractice）

  // 跟房間同一組場地。沒進房（或舊伺服器沒帶子類）用預設 F9A-B。
  setSoccerFieldFromPreset(wsState.room?.soccerClass);
  bus.emit('soccer-entered', { variant: 'practice' }); // render 建場地 + 球門碰撞 + 縮小飛機
  bus.emit('soccer-view-changed', { sign: 1 }); // 窄邊定點視角：站 +z 端看向遠端門
  bus.emit('soccer-dummies-changed', { spheres: [] });
  farPassage = createRingPassage();
  nearPassage = createRingPassage();
  resetPracticeDronePos();

  showSoccerPracticeHud(true);
  showSoccerFeel(true);
  const text = formatPracticeScore(0);
  setPracticeStatus(text);
  stateHud(`⚽ ${text}`);
  toast('⚽ 進入足球自由練習', 'success');
}

export function exitSoccerPractice(): void {
  if (GameSession.active === 'soccer-practice') {
    GameSession.exit('soccer-practice');
    return;
  }
  teardownSoccerPractice();
}

/** 拆掉足球練習：碰撞、場地事件。由 GameSession.onExit 呼叫。 */
function teardownSoccerPractice(): void {
  if (!practiceState.active) return;
  practiceState.active = false;
  practiceState.count = 0;
  practiceState.needReturn = false;
  practiceState.startTime = 0;
  farPassage = createRingPassage();
  nearPassage = createRingPassage();
  setSolidObstacles([]);
  setMeshCollisionBackend(null);
  bus.emit('soccer-dummies-changed', { spheres: [] });
  bus.emit('soccer-view-changed', { sign: null });
  bus.emit('soccer-exited', {}); // render 清場地 / 碰撞、還原機體大小與地面
  showSoccerPracticeHud(false);
  showSoccerFeel(false);
  resetDroneState();
  bus.emit('trail-clear', {}); // 瞬移回原點後清軌跡，避免舊取樣點連到原點拉出長直線
  stateHud('待命');
  toast('已離開足球練習', 'success');
}

GameSession.onExit('soccer-practice', teardownSoccerPractice);

/**
 * 飛機回到起飛區地面。
 * F9A 起飛區在底線內側、門面與端牆之間（門離底線 1.5 m、起飛進深也是 1.5 m）。
 * 中心 z = +startZ、高度在地面，低於圓環開口，不會卡進球門，也不會一出生就穿環。
 * 機頭朝遠端門（yaw 0 = -Z）。
 */
function resetPracticeDronePos(): void {
  const field = activeSoccerField();
  droneState.position.x = 0;
  droneState.position.y = HOME_POSITION.y;
  droneState.position.z = field.startZ;
  droneState.velocity.x = droneState.velocity.y = droneState.velocity.z = 0;
  droneState.yaw = 0;
  droneState.isFlying = false;
  droneState.isGrounded = true;
  practiceState.prevX = droneState.position.x;
  practiceState.prevY = droneState.position.y;
  practiceState.prevZ = droneState.position.z;
}

// =============================================================================
// 每 tick（60Hz；main.ts 在 practiceState.active 時呼叫，取代一般關卡判定）
// =============================================================================
let farPassage: RingPassage = createRingPassage();
let nearPassage: RingPassage = createRingPassage();

function practiceRing(attackSign: 1 | -1): RingCross {
  const F = activeSoccerField();
  return {
    goalZ: attackSign * F.goalZ,
    goalY: F.goalY,
    goalR: F.goalR,
    shieldR: F.shieldR,
    halfThick: F.goalTube,
    attackSign,
  };
}

export function tickSoccerPractice(): void {
  clampSoccerBounds();
  if (!practiceState.active) return;
  const p = droneState.position;
  const prev = { x: practiceState.prevX, y: practiceState.prevY, z: practiceState.prevZ };
  // 遠端門在 -z，合法方向是往 -z（由場內向外）。近端門相反。背後穿回 attackSign 對不上，passed 為 false。
  const farStep = advanceRingPassage(farPassage, prev, p, practiceRing(PracticeScoring.attackSign));
  const nearStep = advanceRingPassage(nearPassage, prev, p, practiceRing(1));
  farPassage = farStep.state;
  nearPassage = nearStep.state;
  const next = PracticeScoring.apply(
    practiceState.count,
    practiceState.needReturn,
    farStep.passed,
    nearStep.passed,
    p.z,
  );
  practiceState.needReturn = next.needReturn;
  if (next.scored) {
    practiceState.count = next.count;
    sound('ring');
    const text = formatPracticeScore(practiceState.count);
    toast(`⚽ ${text}，先回自己半場`, 'success');
    stateHud(`⚽ ${text}，先回自己半場`);
  }
  practiceState.prevX = p.x;
  practiceState.prevY = p.y;
  practiceState.prevZ = p.z;
  const text = practiceState.needReturn
    ? `${formatPracticeScore(practiceState.count)}，先回自己半場`
    : formatPracticeScore(practiceState.count);
  setPracticeStatus(text);
}

/** 場地邊界：護罩貼牆後輕微反彈（地板仍由 integrate 落地） */
function clampSoccerBounds(): void {
  const F = activeSoccerField();
  bounceSoccerWalls(
    droneState.position,
    droneState.velocity,
    { halfX: F.halfX, halfZ: F.halfZ, top: F.top },
    F.shieldR,
  );
}
