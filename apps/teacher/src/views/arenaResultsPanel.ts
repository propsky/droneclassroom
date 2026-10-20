// 老師端的大亂鬥結算蓋板。時間到才出現；再來一輪與前往關卡由儀表板接上。
import type { ArenaResultWinner, ArenaScoreEntry } from '@creafly/shared';
import { ArenaResultsCopy } from '@creafly/shared';

/** 把結算名次畫進 #arena-results。名字用 textContent，不吃使用者輸入的 HTML。 */
export class ArenaResultsPanel {
  static show(
    root: ParentNode,
    mode: 'balloon' | 'tag',
    winner: ArenaResultWinner,
    ranking: ArenaScoreEntry[],
  ): void {
    const overlay = root.querySelector<HTMLElement>('#arena-results');
    if (!overlay) return;
    ArenaResultsPanel.text(root, '#arena-results-kicker', ArenaResultsCopy.kicker());
    ArenaResultsPanel.text(root, '#arena-results-title', ArenaResultsCopy.title(mode, winner));
    ArenaResultsPanel.text(root, '#arena-results-detail', ArenaResultsCopy.detail(mode));
    ArenaResultsPanel.text(root, '#arena-results-wait', ArenaResultsCopy.waitHint());
    const list = root.querySelector<HTMLElement>('#arena-results-list');
    if (list) ArenaResultsPanel.fill(list, mode, ranking);
    overlay.hidden = false;
  }

  static hide(root: ParentNode): void {
    const overlay = root.querySelector<HTMLElement>('#arena-results');
    if (overlay) overlay.hidden = true;
  }

  static isOpen(root: ParentNode): boolean {
    const overlay = root.querySelector<HTMLElement>('#arena-results');
    return !!overlay && !overlay.hidden;
  }

  private static text(root: ParentNode, selector: string, value: string): void {
    const el = root.querySelector<HTMLElement>(selector);
    if (el) el.textContent = value;
  }

  private static fill(list: HTMLElement, mode: 'balloon' | 'tag', ranking: ArenaScoreEntry[]): void {
    list.textContent = '';
    if (!ranking.length) {
      const empty = document.createElement('li');
      empty.className = 'arena-results-empty';
      empty.textContent = '這場沒有玩家成績';
      list.appendChild(empty);
      return;
    }
    ranking.forEach((entry, index) => {
      const row = document.createElement('li');
      const rank = index + 1;
      row.className = 'arena-results-row' + (rank <= 3 ? ` rank-${rank}` : '');
      const place = document.createElement('span');
      place.className = 'mono arena-results-rank';
      place.textContent = String(rank);
      const who = document.createElement('span');
      who.className = 'arena-results-who';
      const chip = document.createElement('span');
      chip.className = 'avatar-chip';
      chip.textContent = entry.emoji || '';
      const name = document.createElement('span');
      name.className = 'student-name';
      const role = mode === 'tag' ? ArenaResultsCopy.roleLabel(entry.role) : '';
      name.textContent = role ? `${entry.name || '?'}　${role}` : entry.name || '?';
      who.append(chip, name);
      const stat = document.createElement('b');
      stat.className = 'mono';
      stat.textContent = ArenaResultsCopy.stat(mode, entry);
      row.append(place, who, stat);
      list.appendChild(row);
    });
  }
}
