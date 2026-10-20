import { describe, expect, it } from 'vitest';
import { levelSelectHtml } from './levelSelect';

describe('全班傳送關卡下拉', () => {
  it('班級課程之外仍列出足球、大亂鬥', () => {
    const html = levelSelectHtml(
      {
        groups: [
          {
            label: '本班',
            sort: 0,
            levels: [{ levelId: '1-1', title: '垂直起降', kind: 'system' }],
          },
        ],
      },
      null,
    );
    expect(html).toContain('value="1-1"');
    expect(html).toContain('value="activity:soccer-practice"');
    expect(html).toContain('value="activity:soccer-match"');
    expect(html).toContain('value="activity:arena:balloon:grid"');
    expect(html).toContain('value="activity:arena:balloon:playground"');
    expect(html).toContain('value="activity:arena:tag:grid"');
    expect(html).toContain('value="activity:arena:tag:playground"');
    expect(html).toContain('足球練習');
    expect(html).toContain('大亂鬥・鬼抓人（遊樂場）');
  });

  it('沒有班級目錄時三章與活動都在', () => {
    const html = levelSelectHtml(null, {
      chapters: [{ chapter: 1, name: '新手村', levels: [{ id: '1-0', name: '搖桿熱身' }] }],
    });
    expect(html).toContain('value="1-0"');
    expect(html).toContain('value="activity:soccer-match"');
  });

  it('讀不到課程關卡時仍可傳送活動', () => {
    const html = levelSelectHtml(null, null);
    expect(html).toContain('讀不到關卡清單');
    expect(html).toContain('value="activity:arena:tag:grid"');
  });
});
