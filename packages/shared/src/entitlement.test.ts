import { describe, expect, it } from 'vitest';
import type { Entitlement } from './entitlement';
import {
  canLoadLevelWithEntitlement,
  firstAllowedLevelId,
  isInLevelGrace,
  isOnlineOnlyEntitlement,
  withOfflineGrace,
} from './entitlement';

const demoEnt = (levelIds: string[]): Entitlement => ({
  mode: 'demo',
  levelIds,
  canSaveProgress: false,
  canOfflineComplete: false,
  issuedAt: 1,
});

describe('canLoadLevelWithEntitlement', () => {
  it('null / open 全開', () => {
    expect(canLoadLevelWithEntitlement(null, '9-9')).toBe(true);
    expect(canLoadLevelWithEntitlement({ ...demoEnt(['1-0']), mode: 'open' }, '9-9')).toBe(true);
  });

  it('demo 只允許清單內', () => {
    const ent = demoEnt(['1-0', '1-1', '1-2']);
    expect(canLoadLevelWithEntitlement(ent, '1-1')).toBe(true);
    expect(canLoadLevelWithEntitlement(ent, '2-1')).toBe(false);
  });

  it('grace 允許指定關卡', () => {
    const ent: Entitlement = {
      ...demoEnt(['1-0']),
      graceUntil: 10_000,
      graceLevelId: '2-1',
    };
    expect(canLoadLevelWithEntitlement(ent, '2-1', 5_000)).toBe(true);
    expect(canLoadLevelWithEntitlement(ent, '2-1', 10_001)).toBe(false);
    expect(canLoadLevelWithEntitlement(ent, '1-1', 5_000)).toBe(false);
  });

  it('grace 未指定 levelId 不生效', () => {
    const ent: Entitlement = {
      ...demoEnt(['1-0']),
      graceUntil: 10_000,
    };
    expect(canLoadLevelWithEntitlement(ent, '3-1', 5_000)).toBe(false);
  });
});

describe('isOnlineOnlyEntitlement', () => {
  it('demo / licensed 為 true', () => {
    expect(isOnlineOnlyEntitlement(demoEnt(['1-0']))).toBe(true);
    expect(
      isOnlineOnlyEntitlement({ ...demoEnt(['1-0']), mode: 'licensed', canSaveProgress: true }),
    ).toBe(true);
    expect(isOnlineOnlyEntitlement(null)).toBe(false);
    expect(isOnlineOnlyEntitlement({ ...demoEnt(['1-0']), mode: 'open' })).toBe(false);
  });
});

describe('isInLevelGrace', () => {
  it('僅匹配 graceLevelId', () => {
    const ent: Entitlement = {
      ...demoEnt(['1-0']),
      graceUntil: 10_000,
      graceLevelId: '2-1',
    };
    expect(isInLevelGrace(ent, '2-1', 5_000)).toBe(true);
    expect(isInLevelGrace(ent, '1-0', 5_000)).toBe(false);
  });
});

describe('firstAllowedLevelId', () => {
  it('挑第一個可玩的', () => {
    const all = ['1-0', '1-1', '2-1'];
    expect(firstAllowedLevelId(all, demoEnt(['1-1', '2-1']))).toBe('1-1');
    expect(firstAllowedLevelId(all, demoEnt(['2-1']))).toBe('2-1');
  });

  it('全鎖時退回第一關或 fallback', () => {
    expect(firstAllowedLevelId(['1-0', '2-1'], demoEnt([]))).toBe('1-0');
    expect(firstAllowedLevelId([], demoEnt([]), '9-9')).toBe('9-9');
  });
});

describe('withOfflineGrace', () => {
  it('設定 grace 欄位', () => {
    const ent = demoEnt(['1-0']);
    const out = withOfflineGrace(ent, '2-1', 30_000, 1_000);
    expect(out.graceLevelId).toBe('2-1');
    expect(out.graceUntil).toBe(31_000);
    expect(out.mode).toBe('demo');
  });
});
