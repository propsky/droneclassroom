import { describe, expect, it } from 'vitest';
import { CourseScale, DRONE_MODEL_SPAN_M, REAL_DRONE_SPAN_M } from './courseScale';
import { PilotView } from './pilotView';

const floor = { floorImage: '/api/levels/cl-1/floor' };

describe('場地底圖關卡用真實比例', () => {
  it('有底圖：機身縮到和碰撞球一樣大（約 1.2m）', () => {
    expect(REAL_DRONE_SPAN_M).toBeCloseTo(1.2);
    expect(CourseScale.droneScale(floor) * DRONE_MODEL_SPAN_M).toBeCloseTo(1.2);
  });

  it('沒有底圖（官方關卡、大亂鬥、足球）：維持卡通機身與原本鏡位', () => {
    expect(CourseScale.droneScale({})).toBe(1);
    expect(CourseScale.droneScale(null)).toBe(1);
    expect(CourseScale.follow(null)).toEqual({ distance: 12, height: 4 });
  });

  it('真實比例鏡頭拉近：機身在畫面上不會小到看不見', () => {
    const real = CourseScale.follow(floor);
    const cartoon = CourseScale.follow(null);
    // 畫面上機身大小 ≈ 寬度 / 距離；真實比例至少保留卡通時的一半
    const realSize = REAL_DRONE_SPAN_M / Math.hypot(real.distance, real.height);
    const cartoonSize = DRONE_MODEL_SPAN_M / Math.hypot(cartoon.distance, cartoon.height);
    expect(realSize / cartoonSize).toBeGreaterThan(0.5);
  });

  it('第三人稱鏡位照比例：在機身正後方', () => {
    const pose = PilotView.thirdPerson({ x: 0, y: 2, z: 0 }, 0, CourseScale.follow(floor));
    expect(pose.eye).toEqual({ x: 0, y: 5, z: 5 });
    expect(PilotView.thirdPerson({ x: 0, y: 2, z: 0 }, 0).eye).toEqual({ x: 0, y: 6, z: 12 });
  });
});
