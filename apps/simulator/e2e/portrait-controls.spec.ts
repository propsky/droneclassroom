import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './helpers';

test.beforeEach(async ({ page }) => {
  await skipOnboarding(page);
});

/** 圓形搖桿的內緣取樣（方框四角在圓外，不拿來判斷被擋住）。 */
async function stickHits(page: Page, id: string): Promise<Array<{ inside: boolean; hit: string }>> {
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
      return { inside, hit: hit ? hit.id || hit.className?.toString?.() || hit.tagName : '' };
    });
  }, id);
}

async function enterFlight(page: Page): Promise<void> {
  await page.goto('/?joystick=1');
  await page.waitForFunction(() => {
    const login = document.getElementById('login-modal');
    const intro = document.getElementById('level-intro');
    return login?.classList.contains('show') || intro?.classList.contains('show');
  });
  const needLogin = await page.evaluate(() => document.getElementById('login-modal')?.classList.contains('show') ?? false);
  if (needLogin) {
    await page.evaluate(() => {
      const name = document.getElementById('login-name') as HTMLInputElement | null;
      if (name) name.value = '直式';
      document.querySelector<HTMLButtonElement>('.emoji-btn[data-emoji="🐯"]')?.click();
      document.getElementById('login-start')?.click();
    });
    await page.waitForFunction(
      () => !document.getElementById('login-modal')?.classList.contains('show'),
      null,
      { timeout: 15_000 },
    );
  }
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const intro = document.getElementById('level-intro');
    if (intro?.classList.contains('show')) document.getElementById('level-intro-start')?.click();
    document.getElementById('pad-hint-dismiss')?.click();
  });
  await expect(page.locator('#joystick-left')).toBeVisible();
}

async function expectSticksClear(page: Page): Promise<void> {
  for (const id of ['joystick-left', 'joystick-right']) {
    const hits = await stickHits(page, id);
    expect(hits.length).toBe(5);
    for (const hit of hits) expect(hit.inside, `${id} ← ${hit.hit}`).toBe(true);
  }
}

test.describe('直式虛擬搖桿不被浮層蓋住', () => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 360, height: 780 },
  ]) {
    test(`${viewport.width}×${viewport.height} 搖桿可點，選單與活動關卡仍可打開`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await enterFlight(page);
      await expect(page.locator('body')).toHaveClass(/portrait-phone/);
      await expect(page.locator('#portrait-menu-btn')).toBeVisible();
      await expect(page.locator('#entry-drawer-toggle')).toBeVisible();
      await expect(page.locator('#soccer-mp-btn')).toBeHidden();
      await expect(page.locator('#header-tools')).toBeHidden();

      await expectSticksClear(page);

      await page.locator('#entry-drawer-toggle').click();
      await expect(page.locator('#soccer-mp-btn')).toBeVisible();
      await expect(page.locator('#arena-btn')).toBeVisible();
      await expectSticksClear(page);

      await page.locator('#portrait-menu-btn').click();
      await expect(page.locator('#header-tools')).toBeVisible();
      await expect(page.locator('#level-menu-toggle')).toBeVisible();
      await page.locator('#level-menu-toggle').click();
      await expect(page.locator('#level-selector-btns .level-btn').first()).toBeVisible();
      await expectSticksClear(page);

      await enterFlight(page);
      await expect(page.locator('#soccer-mp-btn')).toBeVisible();
    });
  }

  test('橫式與桌機維持原工具列與活動入口', async ({ page }) => {
    for (const viewport of [
      { width: 844, height: 390 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(viewport);
      await enterFlight(page);
      await expect(page.locator('body')).not.toHaveClass(/portrait-phone/);
      await expect(page.locator('#portrait-menu-btn')).toBeHidden();
      await expect(page.locator('#entry-drawer-toggle')).toBeHidden();
      await expect(page.locator('#header-tools')).toBeVisible();
      await expect(page.locator('#soccer-mp-btn')).toBeVisible();
      await expect(page.locator('#soccer-btn')).toBeVisible();
      await expect(page.locator('#arena-btn')).toBeVisible();
      const width = await page.locator('#joystick-left').evaluate((el) => el.getBoundingClientRect().width);
      expect(width).toBeGreaterThan(160);
    }
  });
});
