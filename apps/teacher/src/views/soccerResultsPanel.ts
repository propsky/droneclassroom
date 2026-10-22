// 足球結算蓋板。跟大亂鬥的 #arena-results 分開，避免「再來一輪」開錯比賽。
import type { SoccerResultInput } from '@creafly/shared';
import { SoccerResultCopy } from '@creafly/shared';

export class SoccerResultsPanel {
  static show(root: ParentNode, input: SoccerResultInput): void {
    const overlay = root.querySelector<HTMLElement>('#soccer-results');
    if (!overlay) return;
    SoccerResultsPanel.text(root, '#soccer-results-kicker', SoccerResultCopy.kicker(input));
    SoccerResultsPanel.text(root, '#soccer-results-title', SoccerResultCopy.title(input));
    SoccerResultsPanel.text(root, '#soccer-results-detail', SoccerResultCopy.detail(input));
    const list = root.querySelector<HTMLElement>('#soccer-results-list');
    if (list) {
      list.textContent = '';
      for (const line of SoccerResultCopy.rows(input)) {
        const row = document.createElement('li');
        row.textContent = line;
        list.appendChild(row);
      }
    }
    overlay.hidden = false;
  }

  static hide(root: ParentNode): void {
    const overlay = root.querySelector<HTMLElement>('#soccer-results');
    if (overlay) overlay.hidden = true;
  }

  private static text(root: ParentNode, selector: string, value: string): void {
    const el = root.querySelector<HTMLElement>(selector);
    if (el) el.textContent = value;
  }
}
