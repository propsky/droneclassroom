import { expect, test, type Page } from '@playwright/test';
import { guestLogin, skipOnboarding, waitForFlightReady } from './helpers';

test.beforeEach(async ({ page }) => {
  await skipOnboarding(page);
});

/** 圓形搖桿的內緣取樣（方框四角在圓外，不拿來判斷被擋住）。 */
async function stickHits(page: Page, id: string): Promise<Array<{ inside: boolean; hit: string; off: boolean }>> {
  return page.evaluate((stickId) => {
    const el = document.getElementById(stickId);
    if (!el) return [];
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const rad = (r.width / 2) * 0.35;
    const points = [
      [cx, cy],
      [cx, cy - rad],
      [cx, cy + rad],
      [cx - rad, cy],
      [cx + rad, cy],
    ];
    return points.map(([x, y]) => {
      const hit = document.elementFromPoint(x!, y!);
      const inside = !!(hit && (hit === el || el.contains(hit)));
      const off = x! < 0 || y! < 0 || x! > window.innerWidth || y! > window.innerHeight;
      const name = hit ? hit.id || hit.className?.toString?.() || hit.tagName : '';
      return { inside, hit: name, off };
    });
  }, id);
}

async function expectSticksClear(page: Page): Promise<void> {
  for (const id of ['joystick-left', 'joystick-right']) {
    const box = await page.locator(`#${id}`).boundingBox();
    expect(box, id).toBeTruthy();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(56);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
    const hits = await stickHits(page, id);
    expect(hits.length).toBe(5);
    for (const hit of hits) {
      expect(hit.off, `${id} 超出畫面`).toBe(false);
      expect(hit.inside, `${id} ← ${hit.hit}`).toBe(true);
    }
  }
}

/** 在圓盤中心按住並往上推。Playwright 的 touchscreen 只有 tap，拖曳用 CDP 的真實觸控。 */
async function pushStickUp(page: Page, id: string): Promise<{ y: number; z: number }> {
  const box = await page.locator(`#${id}`).boundingBox();
  expect(box).toBeTruthy();
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y, id: 1 }],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x, y: y - 70, id: 1 }],
  });
  await page.waitForTimeout(700);
  const pos = await page.evaluate(() => {
    const p = window.CREAFLY.droneState.position;
    return { y: p.y, z: p.z };
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
  return pos;
}

async function entryButtonIsClickable(page: Page): Promise<void> {
  const btn = page.locator('#soccer-mp-btn');
  await expect(btn).toBeVisible();
  const hit = await btn.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const node = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!(node && (node === el || el.contains(node)));
  });
  expect(hit).toBe(true);
}

test.describe('觸控筆電：虛擬搖桿不被蓋住', () => {
  test.use({
    hasTouch: true,
    isMobile: false,
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
  });

  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
    { width: 1280, height: 800 },
  ]) {
    test(`${viewport.width}×${viewport.height} 搖桿可點，活動入口與關卡選單仍可打開`, async ({ page, browserName }) => {
      await page.setViewportSize(viewport);
      await guestLogin(page, '筆電');
      const signals = await page.evaluate(() => ({
        coarse: window.matchMedia('(pointer: coarse)').matches,
        anyCoarse: window.matchMedia('(any-pointer: coarse)').matches,
        touch: document.body.classList.contains('touch-joysticks'),
      }));
      if (browserName === 'chromium') {
        expect(signals.coarse || signals.anyCoarse).toBe(true);
        expect(signals.touch).toBe(true);
      }
      await expect(page.locator('#joystick-left')).toBeVisible();
      await expect(page.locator('#joystick-right')).toBeVisible();
      await expect(page.locator('#header-tools')).toBeVisible();
      await expect(page.locator('#portrait-menu-btn')).toBeHidden();
      await expectSticksClear(page);
      await entryButtonIsClickable(page);

      await page.locator('#level-menu-toggle').click();
      await expect(page.locator('#level-selector-btns .level-btn').first()).toBeVisible();
      await expectSticksClear(page);
      await entryButtonIsClickable(page);

      if (browserName === 'chromium') {
        const before = await page.evaluate(() => {
          const p = window.CREAFLY.droneState.position;
          return { y: p.y, z: p.z };
        });
        await waitForFlightReady(page); // 倒數中手動操控鎖住，推了也不會動
      const lifted = await pushStickUp(page, 'joystick-left');
        expect(lifted.y).toBeGreaterThan(before.y + 0.2);
        const pitched = await pushStickUp(page, 'joystick-right');
        expect(Math.abs(pitched.z - lifted.z)).toBeGreaterThan(0.15);
      }
    });
  }
});

test.describe('觸控筆電 1280×800 @1.25', () => {
  test.use({
    hasTouch: true,
    isMobile: false,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1.25,
  });

  test('搖桿在畫面內且可點', async ({ page }) => {
    await guestLogin(page, '筆電');
    await expect(page.locator('#joystick-right')).toBeVisible();
    await expectSticksClear(page);
    await entryButtonIsClickable(page);
  });
});

test.describe('橫式手機維持工具列', () => {
  test.use({
    hasTouch: true,
    isMobile: false,
    viewport: { width: 844, height: 390 },
  });

  test('844×390 三顆活動鈕留在右下，搖桿內縮後仍可點', async ({ page }) => {
    await guestLogin(page, '橫式');
    await expect(page.locator('body')).not.toHaveClass(/portrait-phone/);
    await expect(page.locator('#portrait-menu-btn')).toBeHidden();
    await expect(page.locator('#header-tools')).toBeVisible();
    await expect(page.locator('#soccer-mp-btn')).toBeVisible();
    await expect(page.locator('#soccer-btn')).toBeVisible();
    await expect(page.locator('#arena-btn')).toBeVisible();
    const stickWidth = await page.locator('#joystick-left').evaluate((el) => el.getBoundingClientRect().width);
    expect(stickWidth).toBeGreaterThan(160);
    const entry = await page.locator('#entry-group').boundingBox();
    expect(entry).toBeTruthy();
    expect(entry!.y + entry!.height).toBeGreaterThan(300);
    await expectSticksClear(page);
    await entryButtonIsClickable(page);
  });
});

test.describe('觸控筆電 1366×768 @1.5', () => {
  test.use({
    hasTouch: true,
    isMobile: false,
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1.5,
  });

  test('搖桿在畫面內且可點', async ({ page, browserName }) => {
    await guestLogin(page, '筆電');
    await expect(page.locator('#joystick-left')).toBeVisible();
    await expectSticksClear(page);
    await entryButtonIsClickable(page);
    if (browserName === 'chromium') {
      const before = await page.evaluate(() => window.CREAFLY.droneState.position.y);
      await waitForFlightReady(page); // 倒數中手動操控鎖住，推了也不會動
      const lifted = await pushStickUp(page, 'joystick-left');
      expect(lifted.y).toBeGreaterThan(before + 0.2);
    }
  });
});
