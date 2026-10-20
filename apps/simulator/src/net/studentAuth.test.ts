import { describe, expect, it } from 'vitest';
import { StudentAuthClient } from './studentAuth';

describe('StudentAuthClient', () => {
  it('從 FastAPI detail 取出字串或 code', () => {
    expect(StudentAuthClient.readDetail({ detail: '這個 email 已經註冊過' })).toBe(
      '這個 email 已經註冊過',
    );
    expect(StudentAuthClient.readDetail({ detail: { code: 'password_required' } })).toBe(
      'password_required',
    );
    expect(StudentAuthClient.readDetail(null)).toBe('');
    expect(StudentAuthClient.readDetail({ detail: 1 })).toBe('');
  });

  it('依狀態碼分類，401 password_required 單獨辨識', () => {
    expect(StudentAuthClient.classify(401, 'password_required')).toBe('password_required');
    expect(StudentAuthClient.classify(401, '登入資訊不正確')).toBe('unauthorized');
    expect(StudentAuthClient.classify(403, '帳號授權已到期')).toBe('forbidden');
    expect(StudentAuthClient.classify(404, '找不到')).toBe('not_found');
    expect(StudentAuthClient.classify(409, '這個 email 已經註冊過')).toBe('conflict');
    expect(StudentAuthClient.classify(422, '密碼至少 8 個字元')).toBe('validation');
    expect(StudentAuthClient.classify(429, '登入嘗試過於頻繁，請一分鐘後再試')).toBe('rate_limited');
    expect(StudentAuthClient.classify(0, '')).toBe('network');
    expect(StudentAuthClient.classify(500, '')).toBe('server');
  });
});
