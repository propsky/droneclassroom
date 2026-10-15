import { describe, expect, it } from 'vitest';
import { accountStatusText } from './students';

describe('學生名單帳號狀態', () => {
  it('既有帳號與新帳號用台灣用語', () => {
    expect(accountStatusText('linked')).toBe('既有帳號已加入');
    expect(accountStatusText('pending_password')).toBe('新帳號待設密碼');
    expect(accountStatusText('password_set')).toBe('已設密碼');
    expect(accountStatusText('code')).toBe('班級碼登入');
  });
});
