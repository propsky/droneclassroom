// 學生在「我的班級」選進度要記在哪：按取消或打錯班級碼都不能改掉原本的設定。

export type ProgressClassResult =
  | { kind: 'cancel' }
  | { kind: 'personal' }
  | { kind: 'class'; teamId: number }
  | { kind: 'unknown'; code: string };

export class ProgressClassChoice {
  /** prompt 的回傳：null＝按取消；空字串＝記在自己名下；其餘要對到已加入的班級碼。 */
  static resolve(
    input: string | null,
    classes: readonly { teamCode: string; teamId: number }[],
  ): ProgressClassResult {
    if (input === null) return { kind: 'cancel' };
    const code = input.trim().toUpperCase();
    if (code === '') return { kind: 'personal' };
    const found = classes.find((c) => c.teamCode.toUpperCase() === code);
    return found ? { kind: 'class', teamId: found.teamId } : { kind: 'unknown', code };
  }
}
