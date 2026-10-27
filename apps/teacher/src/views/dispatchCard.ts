// 足球／大亂鬥分頁的教師派送卡。單人、勾選批次、取消。
// 名單以伺服器 dispatch_state 為準；這裡只組訊息與畫面。
import {
  TeacherDispatch,
  type DispatchActivity,
  type DispatchStateMsg,
  type StudentInfo,
  type TeacherToServer,
} from '@creafly/shared';
import { toast } from '../toast';

type Send = (msg: TeacherToServer) => boolean;

interface ActivityView {
  phase: DispatchStateMsg['phase'];
  cap: number;
  waiting: DispatchStateMsg['waiting'];
  selected: Set<string>;
}

/** 兩張派送卡。靜態方法組訊息，實例只管這一頁的 DOM。 */
export class DispatchCard {
  static addMessage(activity: DispatchActivity, studentIds: string[]) {
    return { type: 'dispatch_add' as const, activity, studentIds };
  }

  static cancelMessage(activity: DispatchActivity, studentIds: string[] = []) {
    return { type: 'dispatch_cancel' as const, activity, studentIds };
  }

  static bind(root: ParentNode, send: Send): DispatchCard {
    return new DispatchCard(root, send);
  }

  private readonly students: StudentInfo[] = [];
  private readonly views: Record<DispatchActivity, ActivityView> = {
    soccer: { phase: 'idle', cap: TeacherDispatch.soccerCap, waiting: [], selected: new Set() },
    arena: { phase: 'idle', cap: TeacherDispatch.arenaCap, waiting: [], selected: new Set() },
  };

  private constructor(
    private readonly root: ParentNode,
    private readonly send: Send,
  ) {
    for (const activity of ['soccer', 'arena'] as const) {
      this.button(activity, 'selected')?.addEventListener('click', () => this.dispatchSelected(activity));
      this.button(activity, 'cancel')?.addEventListener('click', () => this.cancelAll(activity));
      this.list(activity)?.addEventListener('click', (ev) => this.onRowClick(activity, ev));
      this.list(activity)?.addEventListener('change', (ev) => this.onCheck(activity, ev));
    }
    this.render('soccer');
    this.render('arena');
  }

  syncStudents(list: StudentInfo[]): void {
    this.students.splice(0, this.students.length, ...list);
    const ids = new Set(list.map((s) => s.id));
    for (const view of Object.values(this.views)) {
      for (const id of [...view.selected]) if (!ids.has(id)) view.selected.delete(id);
    }
    this.render('soccer');
    this.render('arena');
  }

  /** 切換房間：舊房的學生與名單不能留著（按派送會送到新房、被伺服器拒絕）。等新房的 student_list / dispatch_state。 */
  reset(): void {
    this.students.splice(0, this.students.length);
    for (const activity of ['soccer', 'arena'] as const) {
      const view = this.views[activity];
      view.phase = 'idle';
      view.waiting = [];
      view.selected.clear();
      this.render(activity);
    }
  }

  apply(msg: DispatchStateMsg): void {
    const view = this.views[msg.activity];
    view.phase = msg.phase;
    view.cap = msg.cap;
    view.waiting = msg.waiting;
    const waitingIds = new Set(msg.waiting.map((s) => s.id));
    for (const id of [...view.selected]) if (waitingIds.has(id)) view.selected.delete(id);
    this.render(msg.activity);
    if (msg.notice) toast(msg.notice, 'error');
  }

  private dispatchSelected(activity: DispatchActivity): void {
    const view = this.views[activity];
    if (view.phase === 'live') {
      toast('比賽中不可追加。', 'error');
      return;
    }
    const ids = [...view.selected].filter((id) => this.canAdd(activity, id));
    if (!ids.length) {
      toast('請先勾選要派送的學生', 'error');
      return;
    }
    this.emit(DispatchCard.addMessage(activity, ids));
  }

  private cancelAll(activity: DispatchActivity): void {
    if (!this.views[activity].waiting.length) {
      toast('目前沒有等待中的學生', 'info');
      return;
    }
    this.emit(DispatchCard.cancelMessage(activity));
  }

  private onRowClick(activity: DispatchActivity, ev: Event): void {
    const btn = (ev.target as HTMLElement | null)?.closest('button');
    if (!btn) return;
    const id = btn.dataset.id;
    const act = btn.dataset.act;
    if (!id || !act) return;
    if (act === 'add') this.emit(DispatchCard.addMessage(activity, [id]));
    else this.emit(DispatchCard.cancelMessage(activity, [id]));
  }

  private onCheck(activity: DispatchActivity, ev: Event): void {
    const input = ev.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'checkbox') return;
    const id = input.dataset.id;
    if (!id) return;
    if (input.checked) this.views[activity].selected.add(id);
    else this.views[activity].selected.delete(id);
  }

  private canAdd(activity: DispatchActivity, id: string): boolean {
    const student = this.students.find((s) => s.id === id);
    if (!student?.connected) return false;
    return !this.views[activity].waiting.some((s) => s.id === id);
  }

  private emit(msg: TeacherToServer): void {
    if (!this.send(msg)) toast('尚未連線', 'error');
  }

  private render(activity: DispatchActivity): void {
    const list = this.list(activity);
    const status = this.root.querySelector<HTMLElement>(`#${activity}-dispatch-status`);
    if (!list || !status) return;
    const view = this.views[activity];
    const live = view.phase === 'live';
    const cap = view.cap;
    const waitingIds = new Set(view.waiting.map((s) => s.id));
    list.replaceChildren();
    const roster = this.students.filter((s) => s.name && s.name !== '?');
    if (!roster.length) {
      list.appendChild(this.empty('尚無學生連線'));
    } else {
      for (const student of roster) {
        list.appendChild(this.row(activity, student, waitingIds.has(student.id), live, view));
      }
    }
    const waitingLabel = view.waiting.map((s) => `${s.emoji}${s.name}`).join('、');
    if (live) status.textContent = '比賽進行中，不能再派送。';
    else if (view.waiting.length) {
      status.textContent = waitingLabel
        ? `等待中 ${view.waiting.length}／${cap}：${waitingLabel}。按開始才進場。`
        : `等待中 ${view.waiting.length}／${cap}。按開始才進場。`;
    } else {
      const hint = activity === 'soccer' ? '（3v3）' : '';
      status.textContent = `尚未派送。上限 ${cap} 人${hint}。`;
    }
    const batch = this.button(activity, 'selected');
    const cancel = this.button(activity, 'cancel');
    if (batch) batch.disabled = live;
    if (cancel) cancel.disabled = live || view.waiting.length === 0;
  }

  private row(
    activity: DispatchActivity,
    student: StudentInfo,
    waiting: boolean,
    live: boolean,
    view: ActivityView,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'dispatch-row';
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.dataset.id = student.id;
    box.checked = view.selected.has(student.id);
    box.disabled = live || waiting || !student.connected;
    label.appendChild(box);
    const name = document.createElement('span');
    const offline = student.connected ? '' : '（離線）';
    name.textContent = `${student.emoji} ${student.name}${offline}`;
    label.appendChild(name);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ghost btn-sm';
    btn.dataset.id = student.id;
    if (waiting) {
      btn.dataset.act = 'cancel';
      btn.textContent = '取消';
      btn.disabled = live;
    } else {
      btn.dataset.act = 'add';
      btn.textContent = '派送';
      btn.disabled = live || !student.connected;
    }
    row.append(label, btn);
    return row;
  }

  private empty(text: string): HTMLElement {
    const el = document.createElement('p');
    el.className = 'empty';
    el.textContent = text;
    return el;
  }

  private list(activity: DispatchActivity): HTMLElement | null {
    return this.root.querySelector(`#${activity}-dispatch-list`);
  }

  private button(activity: DispatchActivity, which: 'selected' | 'cancel'): HTMLButtonElement | null {
    return this.root.querySelector(`#${activity}-dispatch-${which}`);
  }
}
