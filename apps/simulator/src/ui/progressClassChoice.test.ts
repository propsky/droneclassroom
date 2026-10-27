import { describe, expect, it } from 'vitest';
import { ProgressClassChoice } from './progressClassChoice';

const classes = [
  { teamCode: 'ABCD', teamId: 1 },
  { teamCode: 'WXYZ', teamId: 2 },
];

describe('選進度記在哪個班級', () => {
  it('按取消：什麼都不改', () => {
    expect(ProgressClassChoice.resolve(null, classes)).toEqual({ kind: 'cancel' });
  });

  it('留空：記在自己名下', () => {
    expect(ProgressClassChoice.resolve('  ', classes)).toEqual({ kind: 'personal' });
  });

  it('班級碼大小寫都認得', () => {
    expect(ProgressClassChoice.resolve(' wxyz ', classes)).toEqual({ kind: 'class', teamId: 2 });
  });

  it('打錯班級碼：回報找不到，不會改成自己名下', () => {
    expect(ProgressClassChoice.resolve('QQQQ', classes)).toEqual({ kind: 'unknown', code: 'QQQQ' });
  });
});
