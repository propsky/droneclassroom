import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/** 跳過 onboarding / 觸控提示，專注核心流程 */
export async function skipOnboarding(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('creafly_guide_done_v1', '1');
    sessionStorage.setItem('creafly_hint_shown', '1');
  });
}

/** 訪客快速進場（不測帳號雲端進度） */
export async function guestLogin(page: Page, name = '相容測試'): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#login-modal')).toBeVisible();
  await page.fill('#login-name', name);
  await page.locator('.emoji-btn[data-emoji="🐯"]').click();
  const start = page.locator('#login-start');
  if (await start.isVisible()) {
    await start.click();
  } else {
    await start.tap();
  }
  await page.locator('#level-intro-start').click();
}

export async function dismissLevelIntroIfNeeded(page: Page): Promise<void> {
  const btn = page.locator('#level-intro-start');
  if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await btn.click();
  }
}
