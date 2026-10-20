// 進球公告：全班都看得到的大字，停約 3 秒再淡出。文案在 @creafly/shared。
import { GoalAnnounce, type GoalAnnounceInput } from '@creafly/shared';

export class GoalAnnounceOverlay {
  private static root: HTMLElement | null = null;
  private static fadeTimer = 0;
  private static hideTimer = 0;

  static ensure(): HTMLElement {
    if (GoalAnnounceOverlay.root) return GoalAnnounceOverlay.root;
    const el = document.createElement('div');
    el.id = 'goal-announce';
    el.className = 'goal-announce';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML =
      '<div class="goal-announce-card">' +
      '<p class="goal-announce-kicker"></p>' +
      '<h2 class="goal-announce-title"></h2>' +
      '<p class="goal-announce-who"></p>' +
      '<p class="goal-announce-score"></p>' +
      '</div>';
    document.body.appendChild(el);
    GoalAnnounceOverlay.root = el;
    return el;
  }

  static show(input: GoalAnnounceInput): void {
    const copy = GoalAnnounce.copy(input);
    const el = GoalAnnounceOverlay.ensure();
    const kicker = el.querySelector('.goal-announce-kicker');
    const title = el.querySelector('.goal-announce-title');
    const who = el.querySelector('.goal-announce-who');
    const score = el.querySelector('.goal-announce-score');
    if (kicker) kicker.textContent = copy.kicker;
    if (title) title.textContent = copy.title;
    if (who) {
      who.textContent = copy.who;
      (who as HTMLElement).hidden = copy.who === '';
    }
    if (score) score.textContent = copy.score;
    el.classList.toggle('is-own', copy.own);
    el.classList.remove('is-on');
    el.classList.add('is-live');
    window.clearTimeout(GoalAnnounceOverlay.fadeTimer);
    window.clearTimeout(GoalAnnounceOverlay.hideTimer);
    // 先回到透明再亮起，連進兩球也會重新淡入
    requestAnimationFrame(() => {
      el.classList.add('is-on');
    });
    GoalAnnounceOverlay.fadeTimer = window.setTimeout(() => {
      el.classList.remove('is-on');
    }, GoalAnnounce.HOLD_MS);
    GoalAnnounceOverlay.hideTimer = window.setTimeout(() => {
      el.classList.remove('is-live');
    }, GoalAnnounce.HOLD_MS + GoalAnnounce.FADE_MS);
  }
}
