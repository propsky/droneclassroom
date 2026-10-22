// 學生端的教師派送：留在目前關卡看等待看板、不能飛，右下活動鈕關掉。
// 進場由 main 注入，避免這裡 import 多人模組跟 ws 循環。
import { TeacherDispatch, type DispatchActivity } from '@creafly/shared';
import { droneState, flags } from '../core/droneState';
import { stopProgram } from '../core/program';

export interface DispatchEnterOpts {
  arenaMode?: 'balloon' | 'tag';
  arenaField?: 'grid' | 'playground';
}

type EnterFn = (activity: DispatchActivity, opts: DispatchEnterOpts) => void;

const BOARD_ID = 'dispatch-board';

/** 老師派送這位學生時的畫面與飛行鎖。靜態方法，DOM 不在就只改旗標（測試）。 */
export class StudentDispatch {
  private static enter: EnterFn | null = null;
  private static held: DispatchActivity | null = null;

  static bind(enter: EnterFn): void {
    this.enter = enter;
  }

  static unbind(): void {
    this.enter = null;
  }

  static isHeld(): boolean {
    return this.held !== null;
  }

  /** 留在這一關。不需學生確認。 */
  static hold(activity: DispatchActivity): void {
    this.held = activity;
    flags.dispatchHold = true;
    droneState.velocity.x = 0;
    droneState.velocity.y = 0;
    droneState.velocity.z = 0;
    stopProgram();
    this.renderBoard(TeacherDispatch.title(activity));
  }

  /** 看板收起，可以再飛。活動鈕要不要出現看 gate。 */
  static release(): void {
    this.held = null;
    flags.dispatchHold = false;
    this.removeBoard();
  }

  /** 老師按開始才進場。先解鎖，比賽自己的倒數會再管操控。 */
  static go(activity: DispatchActivity, opts: DispatchEnterOpts = {}): void {
    this.release();
    this.enter?.(activity, opts);
  }

  /** 有名單或比賽中，整房關掉右下活動入口。 */
  static gate(locked: boolean): void {
    const group = this.byId('entry-group');
    if (!group) return;
    group.classList.toggle('dispatch-locked', locked);
    if (locked) group.setAttribute('hidden', '');
    else group.removeAttribute('hidden');
  }

  /** 斷線：不要卡在看板上。重連後若還在名單，伺服器會再送 hold。 */
  static reset(): void {
    this.release();
    this.gate(false);
  }

  private static renderBoard(title: string): void {
    const doc = this.doc();
    if (!doc) return;
    this.ensureStyle(doc);
    let board = doc.getElementById(BOARD_ID);
    if (!board) {
      board = doc.createElement('div');
      board.id = BOARD_ID;
      board.className = 'dispatch-board';
      board.setAttribute('role', 'status');
      board.setAttribute('aria-live', 'polite');
      doc.body.appendChild(board);
    }
    board.replaceChildren();
    const card = doc.createElement('div');
    card.className = 'dispatch-board-card';
    const kicker = doc.createElement('p');
    kicker.className = 'dispatch-board-kicker';
    kicker.textContent = '等待進場';
    const heading = doc.createElement('h2');
    heading.textContent = `老師已把你排入${title}`;
    const body = doc.createElement('p');
    body.textContent = '請留在這一關，先不要飛。老師按開始後會自動進場。';
    card.append(kicker, heading, body);
    board.appendChild(card);
  }

  private static removeBoard(): void {
    this.byId(BOARD_ID)?.remove();
  }

  private static ensureStyle(doc: Document): void {
    if (doc.getElementById('dispatch-board-style')) return;
    const style = doc.createElement('style');
    style.id = 'dispatch-board-style';
    style.textContent = `
      #entry-group.dispatch-locked { display: none !important; }
      .dispatch-board {
        position: fixed;
        inset: 0;
        z-index: 160;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: color-mix(in srgb, var(--bg-0, #0e1412) 78%, transparent);
      }
      .dispatch-board-card {
        width: min(420px, 100%);
        padding: 28px 24px;
        border-radius: 16px;
        background: var(--bg-1, #17211c);
        color: var(--text-1, #f4f7f5);
        box-shadow: var(--shadow-2, 0 12px 40px rgb(0 0 0 / 35%));
        text-align: center;
      }
      .dispatch-board-kicker {
        margin: 0 0 8px;
        letter-spacing: 0.08em;
        font-size: 13px;
        color: var(--text-3, #9fb0a6);
      }
      .dispatch-board-card h2 { margin: 0 0 12px; font-size: 22px; }
      .dispatch-board-card p:last-child { margin: 0; line-height: 1.6; }
    `;
    doc.head.appendChild(style);
  }

  private static doc(): Document | null {
    return typeof document === 'undefined' ? null : document;
  }

  private static byId(id: string): HTMLElement | null {
    return this.doc()?.getElementById(id) ?? null;
  }
}
