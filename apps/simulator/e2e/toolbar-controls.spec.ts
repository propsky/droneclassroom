import { expect, test } from '@playwright/test';
import { guestLogin, skipOnboarding } from './helpers';

test.beforeEach(async ({ page }) => {
  await skipOnboarding(page);
});

async function openToolsIfPortrait(page: import('@playwright/test').Page): Promise<void> {
  const menu = page.locator('#portrait-menu-btn');
  if (await menu.isVisible()) {
    await menu.click();
  }
}

test.describe('頂部工具列：模擬器／真機與觸控搖桿', () => {
  test('手動模式就能看到模擬器／真機，切到程式也還在', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await guestLogin(page, '工具列');
    await expect(page.locator('body')).toHaveClass(/mode-manual/);
    await openToolsIfPortrait(page);
    const sim = page.locator('#header #exec-sim');
    const real = page.locator('#header #exec-real');
    await expect(sim).toBeVisible();
    await expect(real).toBeVisible();
    await expect(sim).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#blockly-toolbar #exec-switch')).toHaveCount(0);

    await real.click();
    await expect(real).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('body')).toHaveClass(/mode-manual/);
    const stored = await page.evaluate(() => localStorage.getItem('creafly.exec.mode'));
    expect(stored).toBe('real');

    await page.locator('#mode-mp-toggle').click();
    await expect(page.locator('body')).toHaveClass(/mode-program/);
    await openToolsIfPortrait(page);
    await expect(page.locator('#header #exec-real')).toBeVisible();
    await expect(page.locator('#header #exec-real')).toHaveAttribute('aria-pressed', 'true');
  });

  test('非觸控預設隱藏虛擬搖桿，手動選擇會記住並蓋過預設', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await guestLogin(page, '搖桿');
    const showByDevice = await page.evaluate(
      () => window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(any-pointer: coarse)').matches,
    );
    const stick = page.locator('#joystick-left');
    if (showByDevice) await expect(stick).toBeVisible();
    else await expect(stick).toBeHidden();

    await openToolsIfPortrait(page);
    const toggle = page.locator('#touch-joystick-btn');
    await expect(toggle).toBeVisible();
    await toggle.click();
    const afterClick = await page.evaluate(() => document.body.classList.contains('touch-joysticks'));
    expect(afterClick).toBe(!showByDevice);
    const saved = await page.evaluate(() => localStorage.getItem('creafly_touch_joysticks'));
    expect(saved).toBe(showByDevice ? '0' : '1');
    if (showByDevice) await expect(stick).toBeHidden();
    else await expect(stick).toBeVisible();

    await page.reload();
    await page.locator('#level-intro-start').click({ timeout: 15_000 }).catch(() => undefined);
    await openToolsIfPortrait(page);
    if (showByDevice) await expect(stick).toBeHidden();
    else await expect(stick).toBeVisible();
    await expect(page.locator('#touch-joystick-btn')).toHaveAttribute('aria-pressed', showByDevice ? 'false' : 'true');
  });
});
