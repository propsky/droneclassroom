// 程式執行後端介面（M-01）：cf_* 動作的最小契約。
// Sim 實作走 motion plan；Real 實作走 BLE（v2.0 對接，目前為 stub）。

export interface MotionRuntime {
  isConnected(): boolean;
  takeoff(height?: number): Promise<void>;
  land(): Promise<void>;
  hover(seconds?: number): Promise<void>;
  wait(seconds?: number): Promise<void>;
  forward(distance?: number): Promise<void>;
  backward(distance?: number): Promise<void>;
  left(distance?: number): Promise<void>;
  right(distance?: number): Promise<void>;
  up(distance?: number): Promise<void>;
  down(distance?: number): Promise<void>;
  rotateClockwise(degrees?: number): Promise<void>;
  rotateCounterClockwise(degrees?: number): Promise<void>;
}
