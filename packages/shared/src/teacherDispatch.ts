// 教師派送的人數上限與「比賽是否進行中」。
// 名單本身在伺服器記憶體（apps/api/app/teacher_dispatch.py），這裡不碰連線、不碰資料庫。

export type DispatchActivity = 'soccer' | 'arena';

/** 足球與大亂鬥各一條等待名單。靜態方法，給老師端與測試共用同一組上限。 */
export class TeacherDispatch {
  /**
   * 足球對戰整場上限。#39 之後場地固定 F9A-B，每隊 3 人，3v3 共 6 人。
   */
  static readonly soccerCap = 6;

  /**
   * 大亂鬥上場上限。
   * 大亂鬥沒有場地人數上限；房間 maxStudents 是進房門檻，不是這一場能上幾個人。
   * 8 人夠一組分隊打完，又不會把整班一次送進同一場。
   */
  static readonly arenaCap = 8;

  static cap(activity: DispatchActivity): number {
    return activity === 'soccer' ? this.soccerCap : this.arenaCap;
  }

  static title(activity: DispatchActivity): string {
    return activity === 'soccer' ? '足球對戰' : '大亂鬥';
  }

  /** 倒數與進行中（足球含局間、黃金進球、PK）。這段不能再派人。 */
  static matchIsLive(activity: DispatchActivity, status: string): boolean {
    if (activity === 'soccer') {
      return (
        status === 'countdown' ||
        status === 'running' ||
        status === 'break' ||
        status === 'golden' ||
        status === 'pk'
      );
    }
    return status === 'countdown' || status === 'running';
  }
}
