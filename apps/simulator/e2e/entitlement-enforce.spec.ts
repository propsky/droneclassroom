import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('creafly_guide_done_v1', '1');
    sessionStorage.setItem('creafly_hint_shown', '1');
  });
});

/** enforce 模式訪客：未授權關卡灰化 + 點擊 toast */
test('enforce 訪客試玩關卡 gate', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('#login-modal')).toBeVisible();
  await page.fill('#login-name', '試玩生');
  await page.locator('.emoji-btn[data-emoji="🐯"]').click();
  await page.click('#login-start');

  await page.waitForFunction(() => {
    const raw = localStorage.getItem('creafly_entitlement');
    if (!raw) return false;
    const ent = JSON.parse(raw) as { mode?: string };
    return ent.mode === 'demo';
  });

  // 關卡說明 modal 會挡住 header 按鈕
  await page.locator('#level-intro-start').click();

  await page.waitForSelector('[data-level="2-1"]', { state: 'attached' });
  await page.click('#level-menu-toggle');

  const locked = page.locator('[data-level="2-1"]');
  await expect(locked).toBeVisible();
  await expect(locked).toHaveClass(/entitlement-locked/);

  await locked.click();
  await expect(page.locator('#toast')).toContainText('試玩版');
});
