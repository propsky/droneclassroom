// G-04 / J-02 共用：無人機狀態 FNV-1a 64 hash（Float64 位元級，跨引擎確定）。
import { droneState } from './droneState';

const FNV_PRIME = 0x100000001b3n;
export const FNV_OFFSET = 0xcbf29ce484222325n;
const MASK64 = 0xffffffffffffffffn;
const _hb = new ArrayBuffer(8);
const _hdv = new DataView(_hb);

export function hashF64(h: bigint, x: number): bigint {
  _hdv.setFloat64(0, x);
  for (let i = 0; i < 8; i++) {
    h = ((h ^ BigInt(_hdv.getUint8(i))) * FNV_PRIME) & MASK64;
  }
  return h;
}

/** 單 tick 結束後的無人機狀態混入 hash */
export function hashDroneTick(h: bigint): bigint {
  h = hashF64(h, droneState.position.x);
  h = hashF64(h, droneState.position.y);
  h = hashF64(h, droneState.position.z);
  h = hashF64(h, droneState.velocity.x);
  h = hashF64(h, droneState.velocity.y);
  h = hashF64(h, droneState.velocity.z);
  h = hashF64(h, droneState.yaw);
  return h;
}

export function hashToHex(h: bigint): string {
  return h.toString(16);
}
