// 老師「全班載入此關卡」下拉：課程關卡（或 /api/levels 三章）加上活動（足球／大亂鬥）。
import type { CurriculumResponse, LevelsResponse } from '@creafly/shared';
import { ClassLevelSend } from '@creafly/shared';

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

function chapterOptions(levels: LevelsResponse | null): string {
  if (!levels || levels.chapters.length === 0) {
    return '<option value="" disabled selected>（讀不到關卡清單）</option>';
  }
  return levels.chapters
    .map(
      (ch) =>
        `<optgroup label="第 ${ch.chapter} 章 ${esc(ch.name)}">` +
        ch.levels.map((l) => `<option value="${esc(l.id)}">${esc(l.id)} ${esc(l.name)}</option>`).join('') +
        `</optgroup>`,
    )
    .join('');
}

function activityOptions(): string {
  const items = ClassLevelSend.activities();
  if (items.length === 0) return '';
  return (
    `<optgroup label="${esc(ClassLevelSend.groupLabel)}">` +
    items.map((a) => `<option value="${esc(a.id)}">${esc(a.title)}</option>`).join('') +
    `</optgroup>`
  );
}

/** 關卡下拉：班級 curriculum 優先，否則退回 /api/levels 三章；活動永遠附在最後。 */
export function levelSelectHtml(
  curriculum: CurriculumResponse | null,
  levels: LevelsResponse | null,
): string {
  const activities = activityOptions();
  if (curriculum && curriculum.groups.length > 0) {
    const groups = curriculum.groups
      .map(
        (g) =>
          `<optgroup label="${esc(g.label)}">` +
          g.levels
            .map(
              (l) =>
                `<option value="${esc(l.levelId)}">${esc(l.levelId)} ${esc(l.title)}</option>`,
            )
            .join('') +
          `</optgroup>`,
      )
      .join('');
    return groups + activities;
  }
  return chapterOptions(levels) + activities;
}
