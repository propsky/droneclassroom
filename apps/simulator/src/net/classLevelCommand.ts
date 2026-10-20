// 學生端處理老師的 load_level／活動傳送。
// 一般關卡：先退出大亂鬥／足球再載入（關卡不在記憶體時也要退出，再由 loadLevel 跟伺服器要定義）。
// 活動 id：切到對應場次。宿主由 main 注入，避免這裡 import 多人模組造成與 ws 的循環。
import { ClassLevelSend, type ArenaFieldId, type ArenaPlayMode } from '@creafly/shared';

export interface LevelCommandHost {
  exitTransient(): void;
  loadChapter(levelId: string): void;
  enterSoccerPractice(): void;
  enterSoccerMatch(): void;
  enterArena(mode: ArenaPlayMode, field: ArenaFieldId): void;
  chapterTitle(levelId: string): string | null;
}

/** 老師廣播要全班去的地方。靜態方法，場次切換交給宿主。 */
export class ClassLevelCommand {
  private static host: LevelCommandHost | null = null;

  static bind(host: LevelCommandHost): void {
    this.host = host;
  }

  static unbind(): void {
    this.host = null;
  }

  /**
   * 套用一則全班傳送。回傳要顯示的提示（不含圖示）；宿主未綁定時回空字串。
   */
  static apply(levelId: string): string {
    const host = this.host;
    if (!host) {
      console.warn('[class-level] 尚未綁定場次宿主，略過傳送', levelId);
      return '';
    }
    const activity = ClassLevelSend.find(levelId);
    if (activity) {
      if (activity.session === 'soccer-practice') host.enterSoccerPractice();
      else if (activity.session === 'soccer-match') host.enterSoccerMatch();
      else host.enterArena(activity.arenaMode ?? 'balloon', activity.arenaField ?? 'grid');
      return `老師切換到：${activity.title}`;
    }
    const id = levelId.trim();
    host.exitTransient();
    host.loadChapter(id);
    const title = host.chapterTitle(id);
    return title ? `老師切換到：${title}` : `老師切換到：${id}`;
  }
}
