// ⚽ 無人機足球 — 單人自由練習。
// 沒有關卡任務、沒有過關。護罩從場內正面穿過任一端圓環就加 1 分，分數不封頂。
// 從球門後方（端牆那一側）穿回場內不算。穿環幾何在 crossing.ts，與對戰同一套。
// 視覺（場地 / 球門 / 門框碰撞 / 球形保護框）在 render/soccerField.ts；分數在 ui/soccerHud.ts。
import { droneState, resetDroneState, HOME_POSITION, flags } from '../core/droneState';
import { setMeshCollisionBackend, setSolidObstacles } from '../core/physics';
import { clearLevel } from '../core/level';
import { GameSession } from '../core/session';
import { setMode } from '../core/program';
import { bus, toast, sound, stateHud } from '../core/events';
import { SOCCER_FIELD } from './constants';
import { advanceRingPassage, createRingPassage, type RingCross, type RingPassage } from './crossing';
import { bounceSoccerWalls } from './contact';
import { activeSoccerField, resetSoccerField } from './field';
import { showSoccerPracticeHud, setPracticeStatus, showSoccerFeel } from '../ui/soccerHud';

/** 畫面分數。不出現任務步驟或「練習完成」。 */
export function formatPracticeScore(count: number): string {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return `分數：${n}`;
}

/**
 * 這一 tick 兩端圓環有沒有從場內向外穿過。
 * far／near 必須已經由 crossing 用進攻方向濾過；這裡只累加，不封頂、不要求回半場。
 */
export function notePracticeGoals(
  count: number,
  farPassed: boolean,
  nearPassed: boolean,
): { count: number; scored: boolean } {
  let next = count;
  if (farPassed) next += 1;
  if (nearPassed) next += 1;
  return { count: next, scored: next !== count };
}

export const practiceState = {
  active: false,
  /** 自由練習累計進球，不封頂 */
  count: 0,
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
  practiceState.startTime = Date.now();

  if (flags.mode !== 'manual') setMode('manual');
  clearLevel(); // 一般關卡判定 / 物件 / HUD 停用（main.ts 依 active 改跑 tickSoccerPractice）

  // 單人沒有伺服器 → 生效場地回 constants fallback（避免殘留上一場多人下發的尺寸）
  resetSoccerField();
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
  droneState.position.x = 0;
  droneState.position.y = HOME_POSITION.y;
  droneState.position.z = SOCCER_FIELD.startZ;
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
  const farStep = advanceRingPassage(farPassage, prev, p, practiceRing(-1));
  const nearStep = advanceRingPassage(nearPassage, prev, p, practiceRing(1));
  farPassage = farStep.state;
  nearPassage = nearStep.state;
  const next = notePracticeGoals(practiceState.count, farStep.passed, nearStep.passed);
  if (next.scored) {
    practiceState.count = next.count;
    sound('ring');
    const text = formatPracticeScore(practiceState.count);
    toast(`⚽ ${text}`, 'success');
    stateHud(`⚽ ${text}`);
  }
  practiceState.prevX = p.x;
  practiceState.prevY = p.y;
  practiceState.prevZ = p.z;
  setPracticeStatus(formatPracticeScore(practiceState.count));
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
