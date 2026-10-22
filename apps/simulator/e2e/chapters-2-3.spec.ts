import { expect, test, type Page } from '@playwright/test';

/**
 * 第二、三章補測。
 * 頁面裡的 WebSocket 換成不會連線的假插座，所以不會向任何資料庫註冊或寫進度。
 * 關卡 JSON 由 Vite 靜態檔提供；沒收到授權包時客戶端視為全開。
 */
const LEVELS = ['2-1', '2-2', '2-3', '2-4', '2-5', '3-1', '3-2', '3-3', '3-4'] as const;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('creafly_hint_shown', '1');
    const Socket = function (this: { readyState: number; url: string }, url: string) {
      this.url = String(url);
      this.readyState = 0;
    } as unknown as typeof WebSocket;
    Socket.CONNECTING = 0;
    Socket.OPEN = 1;
    Socket.CLOSING = 2;
    Socket.CLOSED = 3;
    Socket.prototype.send = function send() {};
    Socket.prototype.close = function close(this: { readyState: number }) {
      this.readyState = 3;
    };
    Socket.prototype.addEventListener = function addEventListener() {};
    Socket.prototype.removeEventListener = function removeEventListener() {};
    Socket.prototype.dispatchEvent = function dispatchEvent() {
      return false;
    };
    window.WebSocket = Socket;
  });
});

async function guest(page: Page, name: string): Promise<void> {
  const modal = page.locator('#login-modal');
  if (!(await modal.isVisible().catch(() => false))) return;
  await page.fill('#login-name', name);
  await page.locator('.emoji-btn[data-emoji="🐯"]').click();
  const start = page.locator('#login-start');
  if (await start.isVisible()) await start.click();
  else await start.tap();
  // 假 WebSocket 不會回 room_joined，開放模式約 6 秒後才放行離線進場。
  await expect(modal).toBeHidden({ timeout: 12_000 });
}

async function startIsClickable(page: Page): Promise<string> {
  const start = page.locator('#level-intro-start');
  await start.scrollIntoViewIfNeeded();
  return start.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const x = Math.min(window.innerWidth - 2, Math.max(2, r.left + r.width / 2));
    const y = Math.min(window.innerHeight - 2, Math.max(2, r.top + r.height / 2));
    const top = document.elementFromPoint(x, y);
    const ok = top === el || (!!top && el.contains(top));
    if (ok) return '';
    const node = top as HTMLElement | null;
    return `${node?.tagName ?? 'null'}#${node?.id ?? ''}.${node?.className ?? ''} y=${Math.round(r.top)}`;
  });
}

test.describe('第二、三章', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('creafly_guide_done_v1', '1');
    });
  });

  test('九關都能載入，導覽不擋開始，HUD 有高度', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.goto('/?level=2-1');
    await guest(page, '二三章');

    for (const id of LEVELS) {
      await page.evaluate((levelId) => {
        const api = (window as unknown as { CREAFLY: { loadLevel: (id: string) => void } }).CREAFLY;
        api.loadLevel(levelId);
      }, id);
      const intro = page.locator('#level-intro');
      await expect(intro).toBeVisible();
      await expect(intro.locator('.level-intro-title')).toContainText(id);
      const start = page.locator('#level-intro-start');
      await expect(start).toBeVisible();
      expect(await startIsClickable(page), `${id} 的開始鈕應可點`).toBe('');
      await start.click();
      await expect(intro).toBeHidden();
      await expect(page.locator('#hud-alt')).toHaveText(/\d+\.\d/);
      if (id === '3-1') {
        await expect(page.locator('#hud-state')).toContainText('3.5–5.5m');
        await expect(page.locator('#hud-state')).toContainText('8.5–10.5m');
        await expect(page.locator('#hud-state')).toContainText('10.5m');
      }
      if (id === '3-2') {
        await expect(page.locator('#hud-state')).toContainText('4.1–6.1m');
        await expect(page.locator('#hud-state')).toContainText('8.9–10.9m');
      }
    }
  });

  test('程式模式速度與極速不是 0，距離與回顧卡一致', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.goto('/?level=2-5&mode=program');
    await guest(page, '程式速度');
    await page.locator('#level-intro-start').click();
    await expect(page.locator('body')).toHaveClass(/mode-program/, { timeout: 10_000 });
    await page.evaluate(() => {
      const api = (window as unknown as { CREAFLY: { runProgram: (code: string) => void } }).CREAFLY;
      api.runProgram('await CREAFLY.takeoff(3);\nawait CREAFLY.forward(12);');
    });
    await expect.poll(async () => page.locator('#hud-spd').innerText(), { timeout: 8_000 }).not.toBe('0.0');
    await expect.poll(async () => page.locator('#hud-top').innerText(), { timeout: 8_000 }).not.toBe('0.0');
    await expect(page.locator('#flight-review')).toBeVisible({ timeout: 20_000 });
    const live = (await page.locator('#hud-dist').innerText()).replaceAll(' ', '');
    expect(live).not.toBe('0.0m');
    const card = (await page.locator('#flight-review-grid').innerText()).replaceAll(/\s+/g, '');
    expect(card).toContain(live);
  });

  test('背景可以從按鈕切換，不只靠網址', async ({ page }) => {
    await page.goto('/?level=2-5');
    await guest(page, '背景');
    await page.locator('#level-intro-start').click();
    const btn = page.locator('#scene-env-btn');
    await expect(btn).toBeVisible();
    await expect(btn).toContainText('教室');
    await expect(page.locator('body')).toHaveAttribute('data-scene-env', 'default');
    await btn.click();
    await expect(btn).toContainText('展場');
    await expect(page.locator('body')).toHaveAttribute('data-scene-env', 'exhibition');
    await expect(page).toHaveURL(/scene=exhibition/);
    await page.reload();
    await guest(page, '背景');
    const intro = page.locator('#level-intro-start');
    if (await intro.isVisible().catch(() => false)) await intro.click();
    await expect(page.locator('#scene-env-btn')).toContainText('展場');
    await expect(page.locator('body')).toHaveAttribute('data-scene-env', 'exhibition');
  });
});

test('首次導覽不擋住開始鈕', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.addInitScript(() => {
    localStorage.removeItem('creafly_guide_done_v1');
  });
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto('/?level=2-1&guide=1');
  await guest(page, '導覽');
  await expect(page.locator('#level-intro')).toBeVisible();
  const guide = page.locator('#guide-root');
  await expect(guide, errors.join('\n') || '導覽沒有出現').toBeVisible({ timeout: 10_000 });
  await expect(guide.locator('.guide-skip')).toBeVisible();
  expect(await startIsClickable(page), '導覽擋住開始鈕').toBe('');
  await page.locator('#level-intro-start').click();
  await expect(page.locator('#level-intro')).toBeHidden();
  await expect(guide).toBeVisible();
});

test.describe('足球練習飛行手感不擋操作', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('creafly_guide_done_v1', '1');
    });
  });

  for (const viewport of [
    { width: 1280, height: 800, name: '桌機' },
    { width: 1024, height: 768, name: '平板橫式' },
    { width: 820, height: 1180, name: '平板直式' },
    { width: 844, height: 390, name: '手機橫式' },
    { width: 390, height: 844, name: '手機直式' },
  ]) {
    test(`${viewport.name} ${viewport.width}×${viewport.height}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/?soccer=1');
      await guest(page, '手感');
      const feel = page.locator('#soccer-feel');
      await expect(feel).toBeVisible({ timeout: 15_000 });
      const toggle = page.locator('#touch-joystick-btn');
      if (await toggle.isVisible()) {
        const on = await toggle.getAttribute('aria-pressed');
        if (on !== 'true') await toggle.click();
      }
      await page.waitForTimeout(200);
      const feelBox = await feel.boundingBox();
      expect(feelBox).toBeTruthy();

      const targets = ['#arena-btn', '#soccer-btn', '#joystick-right', '#joystick-left', '#entry-drawer-toggle'];
      for (const sel of targets) {
        const loc = page.locator(sel);
        if (!(await loc.isVisible())) continue;
        const box = await loc.boundingBox();
        if (!box || !feelBox) continue;
        const hits =
          feelBox.x < box.x + box.width &&
          feelBox.x + feelBox.width > box.x &&
          feelBox.y < box.y + box.height &&
          feelBox.y + feelBox.height > box.y;
        expect(hits, `${viewport.name} 飛行手感蓋到 ${sel}`).toBe(false);
      }

      if (viewport.width <= 520 && viewport.height > viewport.width) {
        const drawer = page.locator('#entry-drawer-toggle');
        if (await drawer.isVisible()) await drawer.click();
        await expect(page.locator('#arena-btn')).toBeVisible();
        const arena = await page.locator('#arena-btn').boundingBox();
        const feelNow = await feel.boundingBox();
        if (arena && feelNow) {
          const hits =
            feelNow.x < arena.x + arena.width &&
            feelNow.x + feelNow.width > arena.x &&
            feelNow.y < arena.y + arena.height &&
            feelNow.y + feelNow.height > arena.y;
          expect(hits, '直式打開活動後仍不蓋住大亂鬥').toBe(false);
        }
      }
    });
  }
});
