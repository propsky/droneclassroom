// 新手引導卡片的位置。遮罩不吃點擊，卡片本身要避開關卡說明的「開始」。

export interface GuideRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export class GuidePlacement {
  static overlaps(a: GuideRect, b: GuideRect): boolean {
    return a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
  }

  static clamp(view: { width: number; height: number }, left: number, top: number, card: { width: number; height: number }): {
    left: number;
    top: number;
  } {
    const maxLeft = Math.max(12, view.width - card.width - 12);
    const maxTop = Math.max(12, view.height - card.height - 12);
    return {
      left: Math.min(Math.max(12, left), maxLeft),
      top: Math.min(Math.max(12, top), maxTop),
    };
  }

  /** 沒有高亮目標時放在視窗上緣，不要蓋住正中的開始鈕。 */
  static centered(
    view: { width: number; height: number },
    card: { width: number; height: number },
    start: GuideRect | null,
  ): { left: number; top: number } {
    const width = Math.min(card.width, Math.max(120, view.width - 24));
    const parked = GuidePlacement.clamp(view, (view.width - width) / 2, 72, { width, height: card.height });
    if (!start || !GuidePlacement.overlaps({ ...parked, width, height: card.height }, start)) {
      return parked;
    }
    return GuidePlacement.avoid(view, { ...parked, width, height: card.height }, start);
  }

  /** 已經排好的卡片若壓到開始鈕，改放到鈕的上方或下方。 */
  static avoid(
    view: { width: number; height: number },
    card: GuideRect,
    start: GuideRect,
  ): { left: number; top: number } {
    const candidates = [
      { left: card.left, top: start.top - card.height - 12 },
      { left: card.left, top: start.top + start.height + 12 },
      { left: start.left - card.width - 12, top: card.top },
      { left: start.left + start.width + 12, top: card.top },
      { left: 12, top: 72 },
    ];
    for (const candidate of candidates) {
      const next = GuidePlacement.clamp(view, candidate.left, candidate.top, card);
      if (!GuidePlacement.overlaps({ ...next, width: card.width, height: card.height }, start)) return next;
    }
    return GuidePlacement.clamp(view, 12, 12, card);
  }
}
