// 足球「飛行手感」找一個不壓到搖桿、活動入口、狀態卡的空位。
// 直式手機、橫式平板、桌機都用同一套，不靠寫死的 bottom: 168px。

export interface FeelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class SoccerFeelLayout {
  static readonly GAP_PX = 8;

  static overlaps(a: FeelBox, b: FeelBox): boolean {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  static hitsAny(box: FeelBox, obstacles: readonly FeelBox[]): boolean {
    return obstacles.some((item) => SoccerFeelLayout.overlaps(box, item));
  }

  static clamp(view: { w: number; h: number }, box: FeelBox, margin: number): FeelBox {
    const maxX = Math.max(margin, view.w - box.w - margin);
    const maxY = Math.max(margin, view.h - box.h - margin);
    return {
      x: Math.min(Math.max(margin, box.x), maxX),
      y: Math.min(Math.max(margin, box.y), maxY),
      w: Math.min(box.w, Math.max(80, view.w - margin * 2)),
      h: box.h,
    };
  }

  /** 由上到下試空位。沒有完全空的位置時，挑重疊面積最小、且不壓搖桿與活動入口的。 */
  static place(view: { w: number; h: number }, panel: { w: number; h: number }, obstacles: readonly FeelBox[]): FeelBox {
    const margin = 12;
    const header = 64;
    const padded = obstacles.map((item) => ({
      x: item.x - SoccerFeelLayout.GAP_PX,
      y: item.y - SoccerFeelLayout.GAP_PX,
      w: item.w + SoccerFeelLayout.GAP_PX * 2,
      h: item.h + SoccerFeelLayout.GAP_PX * 2,
    }));
    const widths = [panel.w, Math.min(panel.w, 220), 168, 148].filter((w, i, all) => all.indexOf(w) === i);
    let best: FeelBox | null = null;
    let bestPenalty = Number.POSITIVE_INFINITY;
    for (const w of widths) {
      const h = panel.h;
      const candidates: FeelBox[] = [
        { x: Math.round((view.w - w) / 2), y: header, w, h },
        { x: margin, y: header + 120, w, h },
        { x: margin, y: header, w, h },
        { x: view.w - margin - w, y: header + 120, w, h },
        { x: view.w - margin - w, y: header, w, h },
        { x: Math.round((view.w - w) / 2), y: Math.round(view.h * 0.42), w, h },
        { x: Math.round((view.w - w) / 2), y: view.h - margin - h, w, h },
        { x: margin, y: view.h - margin - h, w, h },
      ];
      for (const candidate of candidates) {
        const box = SoccerFeelLayout.clamp(view, candidate, margin);
        const penalty = SoccerFeelLayout.overlapArea(box, padded);
        if (penalty === 0) return box;
        if (penalty < bestPenalty) {
          bestPenalty = penalty;
          best = box;
        }
      }
    }
    return best ?? SoccerFeelLayout.clamp(view, { x: margin, y: header, w: panel.w, h: panel.h }, margin);
  }

  static overlapArea(box: FeelBox, obstacles: readonly FeelBox[]): number {
    let area = 0;
    for (const item of obstacles) {
      const w = Math.min(box.x + box.w, item.x + item.w) - Math.max(box.x, item.x);
      const h = Math.min(box.y + box.h, item.y + item.h) - Math.max(box.y, item.y);
      if (w > 0 && h > 0) area += w * h;
    }
    return area;
  }

  static apply(doc: Document): void {
    const el = doc.getElementById('soccer-feel');
    const view = doc.defaultView;
    if (!el || !view) return;
    if (view.getComputedStyle(el).display === 'none') return;

    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.transform = 'none';
    el.style.left = '12px';
    el.style.top = '64px';
    el.style.maxWidth = '';

    const measure = (): { w: number; h: number } => ({
      w: Math.max(168, el.offsetWidth),
      h: Math.max(72, el.offsetHeight),
    });
    const obstacles = SoccerFeelLayout.visibleBoxes(doc, el);
    let panel = measure();
    let box = SoccerFeelLayout.place({ w: view.innerWidth, h: view.innerHeight }, panel, obstacles);
    if (SoccerFeelLayout.hitsAny(box, obstacles) && panel.w > 180) {
      el.style.maxWidth = '180px';
      panel = measure();
      box = SoccerFeelLayout.place({ w: view.innerWidth, h: view.innerHeight }, panel, obstacles);
    }
    el.style.left = `${box.x}px`;
    el.style.top = `${box.y}px`;
  }

  static visibleBoxes(doc: Document, self: HTMLElement): FeelBox[] {
    const ids = [
      'header',
      'status-hud',
      'soccer-hud',
      'arena-hud',
      'help-hud',
      'entry-group',
      'joystick-left',
      'joystick-right',
    ];
    const boxes: FeelBox[] = [];
    for (const id of ids) {
      const node = doc.getElementById(id);
      if (!node || node === self) continue;
      const style = doc.defaultView?.getComputedStyle(node);
      if (!style || style.display === 'none' || style.visibility === 'hidden') continue;
      const rect = node.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      boxes.push({ x: rect.left, y: rect.top, w: rect.width, h: rect.height });
    }
    return boxes;
  }
}
