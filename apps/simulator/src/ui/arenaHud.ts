// 大亂鬥 HUD：右上計分板（倒數計時 + 場地標示 + 即時排行）＋右下進出場按鈕。
// 純 DOM，由 multiplayer/arena.ts 呼叫；名字用 textContent 寫入（不吃使用者輸入的 HTML）。
import type { ArenaPlayerState, ArenaScoreEntry } from '@creafly/shared';

const $ = (id: string): HTMLElement | null => document.getElementById(id);

/** 綁定右下角「大亂鬥」入口按鈕（進場 ↔ 離場切換） */
export function initArenaHud(onToggle: () => void): void {
  $('arena-btn')?.addEventListener('click', onToggle);
}

export function showArenaHud(on: boolean): void {
  const hud = $('arena-hud');
  if (hud) hud.style.display = on ? 'block' : 'none';
  $('arena-btn')?.classList.toggle('active', on);
  // header 關卡列：計時字樣切成大亂鬥（離場還原；一般關卡由 hud.ts 每幀覆寫）
  const lt = $('level-timer');
  if (lt) lt.textContent = on ? '大亂鬥' : '--';
  if (on) {
    document.querySelectorAll('.level-btn').forEach((b) => b.classList.remove('active'));
    // 進場重置計分板
    const sb = $('arena-scoreboard');
    if (sb) {
      sb.textContent = '';
      sb.appendChild(emptyRow());
    }
  }
}

let timerCache = '';

export function setArenaTimer(text: string): void {
  if (text === timerCache) return;
  timerCache = text;
  const el = $('arena-timer');
  if (el) el.textContent = text;
}

export function setArenaFieldLabel(field: 'grid' | 'playground'): void {
  const el = $('arena-field-label');
  if (!el) return;
  el.textContent =
    field === 'playground'
      ? '場地：遊樂場（有掩體、不可穿）'
      : '場地：格線空場';
}

function emptyRow(): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'arena-row';
  row.textContent = '等待玩家加入…';
  return row;
}

/**
 * 更新即時排行。
 * balloon：名次 + 分數（前 8）；tag：鬼比抓捕數、跑者比被抓次數（前 10）— 對齊 legacy。
 */
export function updateArenaScoreboard(
  scores: (ArenaPlayerState | ArenaScoreEntry)[],
  mode: 'balloon' | 'tag',
  myId: string,
): void {
  const el = $('arena-scoreboard');
  if (!el) return;
  el.textContent = '';
  if (!scores.length) {
    el.appendChild(emptyRow());
    return;
  }
  // 名次以左側 3px 色條表達（金/銀/銅），不整列上色（設計系統 §3）
  const addRow = (label: string, stat: string, isMe: boolean, rank = 0): void => {
    const row = document.createElement('div');
    row.className =
      'arena-row' + (isMe ? ' me' : '') + (rank >= 1 && rank <= 3 ? ` rank-${rank}` : '');
    const name = document.createElement('span');
    name.textContent = label;
    const val = document.createElement('b');
    val.textContent = stat;
    row.append(name, val);
    el.appendChild(row);
  };
  if (mode === 'tag') {
    scores.slice(0, 10).forEach((s) => {
      const tag = s.role === 'ghost' ? '👻' : s.stunned ? '😵' : '🏃';
      const stat = s.role === 'ghost' ? `抓到 ${s.score || 0}` : `被抓 ${s.caughtCount || 0}`;
      addRow(`${tag} ${s.emoji || ''}${s.name || '?'}`, stat, s.id === myId);
    });
  } else {
    scores.slice(0, 8).forEach((s, i) => {
      addRow(
        `${i + 1}. ${s.emoji || ''}${s.name || '?'}`,
        String(s.score || 0),
        s.id === myId,
        i + 1,
      );
    });
  }
}
