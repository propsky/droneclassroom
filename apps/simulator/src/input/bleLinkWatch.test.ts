import { describe, expect, it } from 'vitest';
import { BleLinkWatch } from './bleLinkWatch';

/** 每 50ms 送一筆同樣內容，送到 `until` */
function periodic(w: BleLinkWatch, from: number, until: number, key = 'a'): void {
  for (let t = from; t <= until; t += 50) w.packet(t, key);
}

describe('藍牙搖桿斷訊保護', () => {
  it('固定週期送：封包持續到就正常', () => {
    const w = new BleLinkWatch();
    periodic(w, 0, 1000);
    expect(w.check(1040)).toBe('fresh');
  });

  it('超過 500ms 沒封包：斷訊（只報一次），之後持續 stale', () => {
    const w = new BleLinkWatch();
    periodic(w, 0, 1000);
    expect(w.check(1400)).toBe('fresh');
    expect(w.check(1501)).toBe('went-stale');
    expect(w.check(1600)).toBe('stale');
    expect(w.check(3000)).toBe('stale');
  });

  it('封包回來：恢復，並告知剛恢復', () => {
    const w = new BleLinkWatch();
    periodic(w, 0, 1000);
    w.check(2000);
    expect(w.packet(2100, 'a')).toBe(true);
    expect(w.check(2120)).toBe('fresh');
    expect(w.packet(2150, 'a')).toBe(false);
  });

  it('只在有變化才送的搖桿（從沒收過重複內容）：不啟用，穩穩推著也不會被歸零', () => {
    const w = new BleLinkWatch();
    w.packet(0, 'a');
    w.packet(30, 'b');
    w.packet(60, 'c');
    expect(w.check(5000)).toBe('fresh');
  });

  it('斷線重置後要重新證明是週期送', () => {
    const w = new BleLinkWatch();
    periodic(w, 0, 200);
    w.reset();
    w.packet(1000, 'x');
    expect(w.check(9000)).toBe('fresh');
  });
});
