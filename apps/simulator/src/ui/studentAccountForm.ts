// 學生帳號分頁的純邏輯：每個模式該顯示哪些欄位、送出時讀哪一組輸入、錯誤怎麼講。
// DOM 事件留在 ui/overlays.ts。這裡不碰 document，才能用單元測試鎖住
// 「建立帳號只讀註冊欄，不去讀隱藏的 email 登入欄」。
import type { StudentLoginRequest } from '@creafly/shared';
import type { AuthErrorCode } from '../net/studentAuth';

export type AccountMode = 'code' | 'email' | 'register';

export type AccountFocus =
  | 'team'
  | 'student'
  | 'codePw'
  | 'email'
  | 'emailPw'
  | 'regName'
  | 'regEmail'
  | 'regPw';

/** 三組欄位的原始字串。decide() 只採用目前模式那一組。 */
export interface AccountFieldValues {
  teamCode: string;
  studentCode: string;
  /** 班級碼登入的密碼欄有展開才要求填寫 */
  codePasswordShown: boolean;
  codePassword: string;
  email: string;
  emailPassword: string;
  regName: string;
  regEmail: string;
  regPassword: string;
}

export interface AccountLink {
  label: string;
  next: AccountMode;
}

export interface AccountChrome {
  showCode: boolean;
  showEmail: boolean;
  showRegister: boolean;
  submitLabel: string;
  pendingLabel: string;
  /** 左連結：email 登入 ↔ 班級碼登入 */
  modeLink: AccountLink;
  /** 右連結：去建立帳號，或註冊中改回另一種登入 */
  altLink: AccountLink;
}

export type AccountDecision =
  | { ok: true; kind: 'login'; body: StudentLoginRequest }
  | { ok: true; kind: 'register'; body: { name: string; email: string; password: string } }
  | { ok: false; message: string; focus: AccountFocus };

const PASSWORD_MIN = 8;

const FOCUS_ID: Record<AccountFocus, string> = {
  team: 'acct-team-code',
  student: 'acct-student-code',
  codePw: 'acct-code-pw',
  email: 'acct-email',
  emailPw: 'acct-email-pw',
  regName: 'acct-reg-name',
  regEmail: 'acct-reg-email',
  regPw: 'acct-reg-pw',
};

export class StudentAccountForm {
  static passwordMinLength(): number {
    return PASSWORD_MIN;
  }

  /** 班級碼：去空白、大寫、只留英數、最多 4 碼 */
  static normalizeTeamCode(raw: string): string {
    return raw.replace(/[^0-9a-zA-Z]/g, '').toUpperCase().slice(0, 4);
  }

  /** 學生碼：只留英數、大寫、最多 2 碼（保留前導零） */
  static normalizeStudentCode(raw: string): string {
    return raw.replace(/[^0-9a-zA-Z]/g, '').toUpperCase().slice(0, 2);
  }

  /** 有 @、網域有點、沒有空白。空字串不算。 */
  static looksLikeEmail(raw: string): boolean {
    const email = raw.trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
  }

  static focusId(focus: AccountFocus): string {
    return FOCUS_ID[focus];
  }

  /**
   * 每個模式只留自己的欄位與回去的連結。
   * 註冊中不再顯示「建立學生帳號」（人已經在建立），改成兩種登入的入口。
   */
  static chrome(mode: AccountMode): AccountChrome {
    if (mode === 'register') {
      return {
        showCode: false,
        showEmail: false,
        showRegister: true,
        submitLabel: '建立帳號',
        pendingLabel: '建立中…',
        modeLink: { label: '用 email 登入', next: 'email' },
        altLink: { label: '用班級碼登入', next: 'code' },
      };
    }
    if (mode === 'email') {
      return {
        showCode: false,
        showEmail: true,
        showRegister: false,
        submitLabel: '登入',
        pendingLabel: '登入中…',
        modeLink: { label: '用班級碼登入', next: 'code' },
        altLink: { label: '建立學生帳號', next: 'register' },
      };
    }
    return {
      showCode: true,
      showEmail: false,
      showRegister: false,
      submitLabel: '登入',
      pendingLabel: '登入中…',
      modeLink: { label: '用 email 登入', next: 'email' },
      altLink: { label: '建立學生帳號', next: 'register' },
    };
  }

  /** 依模式驗欄位並組出要送的 body。註冊絕不讀 email / emailPassword。 */
  static decide(mode: AccountMode, values: AccountFieldValues): AccountDecision {
    if (mode === 'register') return StudentAccountForm.decideRegister(values);
    if (mode === 'email') return StudentAccountForm.decideEmail(values);
    return StudentAccountForm.decideCode(values);
  }

  /** 伺服器錯誤 → 畫面上的繁體中文。不把未預期的 detail 原樣貼出。 */
  static failureMessage(
    kind: 'register' | 'code' | 'email',
    code: AuthErrorCode,
    detail: string,
  ): string {
    if (code === 'network') return '連不上伺服器，請確認網路後再試一次';
    if (code === 'rate_limited') return '嘗試太多次，請稍候再試';
    if (code === 'forbidden') return '帳號授權已到期，請老師協助';
    if (code === 'password_required') {
      return '這個帳號有設定密碼，請輸入密碼後再按一次登入';
    }
    if (kind === 'register') {
      if (code === 'conflict') return '這個 email 已經註冊過';
      if (code === 'validation') {
        if (detail.includes('密碼')) return '密碼至少 8 個字元';
        if (/email/i.test(detail)) return 'email 格式不正確';
        return '註冊資料不正確，請再檢查一次';
      }
      return '註冊失敗，請稍後再試';
    }
    if (kind === 'code') return '登入失敗：班級碼、學生碼或密碼不對，請再檢查一次';
    return '登入失敗：email 或密碼不對';
  }

  private static decideRegister(values: AccountFieldValues): AccountDecision {
    const name = values.regName.trim();
    const email = values.regEmail.trim();
    const password = values.regPassword;
    if (!name) return { ok: false, message: '請輸入名字', focus: 'regName' };
    if (!email) return { ok: false, message: '請輸入 email', focus: 'regEmail' };
    if (!StudentAccountForm.looksLikeEmail(email)) {
      return { ok: false, message: 'email 格式不正確', focus: 'regEmail' };
    }
    if (!password) return { ok: false, message: '請輸入密碼', focus: 'regPw' };
    if (password.length < PASSWORD_MIN) {
      return { ok: false, message: '密碼至少 8 個字元', focus: 'regPw' };
    }
    return { ok: true, kind: 'register', body: { name, email, password } };
  }

  private static decideEmail(values: AccountFieldValues): AccountDecision {
    const email = values.email.trim();
    const password = values.emailPassword;
    if (!email) return { ok: false, message: '請輸入 email', focus: 'email' };
    if (!StudentAccountForm.looksLikeEmail(email)) {
      return { ok: false, message: 'email 格式不正確', focus: 'email' };
    }
    if (!password) return { ok: false, message: '請輸入密碼', focus: 'emailPw' };
    return { ok: true, kind: 'login', body: { email, password } };
  }

  private static decideCode(values: AccountFieldValues): AccountDecision {
    const teamCode = StudentAccountForm.normalizeTeamCode(values.teamCode);
    const studentCode = StudentAccountForm.normalizeStudentCode(values.studentCode);
    if (teamCode.length < 4) {
      return { ok: false, message: '班級碼是 4 碼英數，在老師發的小卡上', focus: 'team' };
    }
    if (studentCode.length < 2) {
      return { ok: false, message: '學生碼是 2 碼，例如 01', focus: 'student' };
    }
    const body: StudentLoginRequest = { teamCode, studentCode };
    if (values.codePasswordShown) {
      const password = values.codePassword;
      if (!password) return { ok: false, message: '請輸入密碼', focus: 'codePw' };
      body.password = password;
    }
    return { ok: true, kind: 'login', body };
  }
}
