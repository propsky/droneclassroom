import { expect, test } from '@playwright/test';
import { guestLogin, skipOnboarding } from './helpers';

test.beforeEach(async ({ page }) => {
  await skipOnboarding(page);
});

test.describe('L-04 / L-02 跨瀏覽器核心 smoke', () => {
  test('學生端 shell 載入、無致命 console error', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto('/');
    await expect(page.locator('#login-modal')).toBeVisible();
    await expect(page.locator('#scene-canvas')).toBeAttached();
    const fatal = errors.filter(
      (e) => !/favicon|Failed to load resource|404/.test(e),
    );
    expect(fatal).toEqual([]);
  });

  test('訪客登入後關卡選單可開啟', async ({ page }) => {
    await guestLogin(page);
    await page.click('#level-menu-toggle');
    await expect(page.locator('#level-selector-btns [data-level]').first()).toBeVisible();
  });

  test('手動 / 程式模式切換', async ({ page }) => {
    await guestLogin(page);
    const toggle = page.locator('#mode-mp-toggle');
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(page.locator('body')).toHaveClass(/mode-program/);
    await expect(page.locator('#blockly-panel')).toBeVisible();
    await toggle.click();
    await expect(page.locator('body')).toHaveClass(/mode-manual/);
  });

  test('WebGL canvas 可取得 context', async ({ page }) => {
    await guestLogin(page);
    const ok = await page.evaluate(() => {
      const canvas = document.getElementById('scene-canvas') as HTMLCanvasElement | null;
      if (!canvas) return false;
      return !!(canvas.getContext('webgl') || canvas.getContext('webgl2'));
    });
    expect(ok).toBe(true);
  });

  test('瀏覽器能力探測通過最低需求', async ({ page }) => {
    await page.goto('/');
    const caps = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      const webgl = !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
      const secureRandom =
        typeof crypto.randomUUID === 'function' ||
        (typeof crypto.getRandomValues === 'function' &&
          !!crypto.getRandomValues(new Uint8Array(1)));
      return { webgl, secureRandom };
    });
    expect(caps.webgl).toBe(true);
    expect(caps.secureRandom).toBe(true);
  });

  test('觸控裝置：模式切換可用 tap', async ({ page }) => {
    test.skip(test.info().project.name !== 'webkit-ipad', '僅 iPad WebKit 專案');
    await guestLogin(page);
    const toggle = page.locator('#mode-mp-toggle');
    await toggle.tap();
    await expect(page.locator('body')).toHaveClass(/mode-program/);
  });
});
