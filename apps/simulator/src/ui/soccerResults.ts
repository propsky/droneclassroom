// 學生端足球結算。沿用大亂鬥的蓋板，沒有「再來一輪」按鈕。
import type { SoccerResultInput } from '@creafly/shared';
import { SoccerResultCopy } from '@creafly/shared';

const $ = (id: string): HTMLElement | null => document.getElementById(id);

export function showSoccerResults(input: SoccerResultInput): void {
  const root = $('arena-results');
  if (!root) return;
  const kicker = $('arena-results-kicker');
  const title = $('arena-results-title');
  const detail = $('arena-results-detail');
  const wait = $('arena-results-wait');
  const list = $('arena-results-list');
  if (kicker) kicker.textContent = SoccerResultCopy.kicker(input);
  if (title) title.textContent = SoccerResultCopy.title(input);
  if (detail) detail.textContent = SoccerResultCopy.detail(input);
  if (wait) wait.textContent = '等老師開始下一場';
  if (list) {
    list.textContent = '';
    for (const line of SoccerResultCopy.rows(input)) {
      const row = document.createElement('li');
      row.className = 'arena-results-row';
      row.textContent = line;
      list.appendChild(row);
    }
  }
  root.hidden = false;
}

export function hideSoccerResults(): void {
  const root = $('arena-results');
  if (root) root.hidden = true;
}
