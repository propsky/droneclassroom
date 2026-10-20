import { describe, expect, it } from 'vitest';
import { StudentAccountForm, type AccountFieldValues } from './studentAccountForm';

function fields(over: Partial<AccountFieldValues> = {}): AccountFieldValues {
  return {
    teamCode: '',
    studentCode: '',
    codePasswordShown: false,
    codePassword: '',
    email: '',
    emailPassword: '',
    regName: '',
    regEmail: '',
    regPassword: '',
    ...over,
  };
}

describe('StudentAccountForm', () => {
  it('註冊只讀註冊欄，隱藏的 email 登入欄是空的也不擋', () => {
    const decision = StudentAccountForm.decide(
      'register',
      fields({
        email: '',
        emailPassword: '',
        regName: '小白',
        regEmail: 'xiaobai@example.com',
        regPassword: 'password',
      }),
    );
    expect(decision).toEqual({
      ok: true,
      kind: 'register',
      body: { name: '小白', email: 'xiaobai@example.com', password: 'password' },
    });
  });

  it('註冊不會誤用隱藏登入欄的 email', () => {
    const decision = StudentAccountForm.decide(
      'register',
      fields({
        email: 'hidden@example.com',
        emailPassword: 'other-pass',
        regName: '小白',
        regEmail: 'xiaobai@example.com',
        regPassword: 'password',
      }),
    );
    expect(decision.ok).toBe(true);
    if (decision.ok && decision.kind === 'register') {
      expect(decision.body.email).toBe('xiaobai@example.com');
    }
  });

  it('註冊欄位錯誤用台灣繁體中文', () => {
    const missingName = StudentAccountForm.decide('register', fields());
    expect(missingName.ok).toBe(false);
    if (!missingName.ok) expect(missingName.message).toBe('請輸入名字');
    expect(
      StudentAccountForm.decide('register', fields({ regName: '小白' })),
    ).toMatchObject({ message: '請輸入 email', focus: 'regEmail' });
    expect(
      StudentAccountForm.decide('register', fields({ regName: '小白', regEmail: '不是email' })),
    ).toMatchObject({ message: 'email 格式不正確', focus: 'regEmail' });
    expect(
      StudentAccountForm.decide(
        'register',
        fields({ regName: '小白', regEmail: 'a@b.co', regPassword: 'short' }),
      ),
    ).toMatchObject({ message: '密碼至少 8 個字元', focus: 'regPw' });
  });

  it('email 登入讀 email 欄，不讀註冊欄', () => {
    const decision = StudentAccountForm.decide(
      'email',
      fields({
        email: 'xiaobai@example.com',
        emailPassword: 'password',
        regEmail: 'other@example.com',
        regPassword: 'not-this',
      }),
    );
    expect(decision).toEqual({
      ok: true,
      kind: 'login',
      body: { email: 'xiaobai@example.com', password: 'password' },
    });
  });

  it('班級碼登入正規化，密碼欄展開後才要求密碼', () => {
    expect(
      StudentAccountForm.decide('code', fields({ teamCode: 'ab12', studentCode: '1' })),
    ).toMatchObject({ message: '學生碼是 2 碼，例如 01' });
    const open = StudentAccountForm.decide(
      'code',
      fields({ teamCode: 'ab12', studentCode: '01' }),
    );
    expect(open).toEqual({
      ok: true,
      kind: 'login',
      body: { teamCode: 'AB12', studentCode: '01' },
    });
    expect(
      StudentAccountForm.decide(
        'code',
        fields({
          teamCode: 'ab12',
          studentCode: '01',
          codePasswordShown: true,
          codePassword: '',
        }),
      ),
    ).toMatchObject({ message: '請輸入密碼', focus: 'codePw' });
  });

  it('註冊模式不顯示「建立學生帳號」，按鈕是建立帳號', () => {
    const chrome = StudentAccountForm.chrome('register');
    expect(chrome.showRegister).toBe(true);
    expect(chrome.showEmail).toBe(false);
    expect(chrome.showCode).toBe(false);
    expect(chrome.submitLabel).toBe('建立帳號');
    expect(chrome.pendingLabel).toBe('建立中…');
    expect(chrome.modeLink.label).toBe('用 email 登入');
    expect(chrome.altLink.label).toBe('用班級碼登入');
    expect([chrome.modeLink.label, chrome.altLink.label]).not.toContain('建立學生帳號');
  });

  it('登入模式只顯示對應欄位與建立帳號入口', () => {
    const code = StudentAccountForm.chrome('code');
    expect(code.showCode).toBe(true);
    expect(code.submitLabel).toBe('登入');
    expect(code.modeLink).toEqual({ label: '用 email 登入', next: 'email' });
    expect(code.altLink).toEqual({ label: '建立學生帳號', next: 'register' });
    const email = StudentAccountForm.chrome('email');
    expect(email.showEmail).toBe(true);
    expect(email.showRegister).toBe(false);
    expect(email.modeLink.next).toBe('code');
    expect(email.altLink.next).toBe('register');
  });

  it('註冊與登入的伺服器錯誤文案分開', () => {
    expect(StudentAccountForm.failureMessage('register', 'conflict', '這個 email 已經註冊過')).toBe(
      '這個 email 已經註冊過',
    );
    expect(StudentAccountForm.failureMessage('register', 'validation', '密碼至少 8 個字元')).toBe(
      '密碼至少 8 個字元',
    );
    expect(StudentAccountForm.failureMessage('register', 'network', '')).toBe(
      '連不上伺服器，請確認網路後再試一次',
    );
    expect(StudentAccountForm.failureMessage('email', 'unauthorized', '登入資訊不正確')).toBe(
      '登入失敗：email 或密碼不對',
    );
    expect(StudentAccountForm.failureMessage('code', 'password_required', 'password_required')).toBe(
      '這個帳號有設定密碼，請輸入密碼後再按一次登入',
    );
    expect(StudentAccountForm.failureMessage('code', 'rate_limited', '')).toBe(
      '嘗試太多次，請稍候再試',
    );
    expect(StudentAccountForm.failureMessage('email', 'forbidden', '帳號授權已到期')).toBe(
      '帳號授權已到期，請老師協助',
    );
  });
});
