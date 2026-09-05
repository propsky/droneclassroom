import { describe, expect, it } from 'vitest';
import { decodeFrame, norm } from './bleDecode';

describe('norm', () => {
  it('中點 127 → 0', () => {
    expect(norm(127)).toBe(0);
  });

  it('端點 clamp 到 ±1', () => {
    expect(norm(0)).toBe(-1);
    expect(norm(255)).toBe(1);
  });
});

describe('decodeFrame', () => {
  it('解析 7-byte Mode 2 搖桿封包', () => {
    const buf = new ArrayBuffer(7);
    const dv = new DataView(buf);
    dv.setUint8(0, 0xaa);
    dv.setUint8(1, 127); // lx 中
    dv.setUint8(2, 255); // ly 推上 → throttle +1
    dv.setUint8(3, 255); // rx 全右
    dv.setUint8(4, 127); // ry 中
    dv.setUint8(5, 0x40); // A 按下 (bit 6)
    dv.setUint8(6, 0);

    const pad = decodeFrame(dv);
    expect(pad).not.toBeNull();
    expect(pad!.throttle).toBeCloseTo(1);
    expect(pad!.yaw).toBeCloseTo(0, 1);
    expect(pad!.roll).toBeCloseTo(1);
    expect(pad!.buttons.A).toBe(true);
    expect(pad!.buttons.B).toBe(false);
  });

  it('封包太短回傳 null', () => {
    const dv = new DataView(new ArrayBuffer(3));
    expect(decodeFrame(dv)).toBeNull();
  });
});
