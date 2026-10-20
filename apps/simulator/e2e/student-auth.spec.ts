// 學生帳號流程。REST / WebSocket 都在瀏覽器裡攔截，不打正式 API、也不寫正式資料庫。
import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { dismissLevelIntroIfNeeded, skipOnboarding } from './helpers';

interface FakeStudent {
  email: string;
  name: string;
  password: string;
  token: string;
  id: number;
}

interface LevelProgress {
  bestTimeMs: number | null;
  attempts: number;
}

interface MockOpts {
  /** GET /auth/student/progress 回的進度 */
  progress?: Record<string, LevelProgress>;
  /** WS progress_sync。null = 不送，用來確認 GET 自己也能畫勾勾 */
  wsProgress?: Record<string, LevelProgress> | null;
  /** 這些「班級碼:學生碼」第一次不帶密碼要回 password_required */
  needsPassword?: Set<string>;
}

function studentMe(s: { id: number; name: string }, team?: { teamId: number; teamName: string; teamCode: string; studentCode: string }) {
  return {
    id: s.id,
    name: s.name,
    emoji: '🙂',
    teamId: team?.teamId ?? null,
    teamName: team?.teamName ?? '',
    teamCode: team?.teamCode ?? '',
    studentCode: team?.studentCode ?? '',
    progressMode: 'personal' as const,
    classes: team
      ? [{ teamId: team.teamId, teamName: team.teamName, teamCode: team.teamCode, studentCode: team.studentCode }]
      : [],
  };
}

function json(routeBody: unknown, status = 200) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(routeBody),
  };
}

async function installStudentApi(page: Page, opts: MockOpts = {}) {
  const students: FakeStudent[] = [];
  let seq = 1;
  const hits = { register: 0, login: 0, progress: 0 };
  const progress = opts.progress ?? { '1-1': { bestTimeMs: 12000, attempts: 2 } };
  const wsProgress = opts.wsProgress === undefined ? progress : opts.wsProgress;

  await page.route('**/auth/student/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const body = (req.postDataJSON() ?? {}) as Record<string, string>;

    if (req.method() === 'POST' && path.endsWith('/auth/student/register')) {
      hits.register += 1;
      const email = String(body.email ?? '').trim().toLowerCase();
      if (students.some((s) => s.email === email)) {
        await route.fulfill(json({ detail: '這個 email 已經註冊過' }, 409));
        return;
      }
      if (String(body.password ?? '').length < 8) {
        await route.fulfill(json({ detail: '密碼至少 8 個字元' }, 422));
        return;
      }
      const student: FakeStudent = {
        email,
        name: String(body.name ?? ''),
        password: String(body.password ?? ''),
        token: `tok-${seq}`,
        id: seq,
      };
      seq += 1;
      students.push(student);
      await route.fulfill(json({ token: student.token, expiresIn: 7_776_000, me: studentMe(student) }, 201));
      return;
    }

    if (req.method() === 'POST' && path.endsWith('/auth/student/login')) {
      hits.login += 1;
      if (body.email) {
        const email = String(body.email).trim().toLowerCase();
        const found = students.find((s) => s.email === email && s.password === String(body.password ?? ''));
        if (!found) {
          await route.fulfill(json({ detail: '登入資訊不正確' }, 401));
          return;
        }
        await route.fulfill(json({ token: found.token, expiresIn: 7_776_000, me: studentMe(found) }));
        return;
      }
      const teamCode = String(body.teamCode ?? '').toUpperCase();
      const studentCode = String(body.studentCode ?? '').toUpperCase();
      const key = `${teamCode}:${studentCode}`;
      if (opts.needsPassword?.has(key) && !body.password) {
        await route.fulfill(json({ detail: 'password_required' }, 401));
        return;
      }
      if (opts.needsPassword?.has(key) && body.password !== 'class-pass') {
        await route.fulfill(json({ detail: '登入資訊不正確' }, 401));
        return;
      }
      if (teamCode === 'ABCD' && studentCode === '01') {
        await route.fulfill(
          json({
            token: 'tok-code',
            expiresIn: 7_776_000,
            me: studentMe(
              { id: 42, name: '小碼' },
              { teamId: 7, teamName: '五年一班', teamCode: 'ABCD', studentCode: '01' },
            ),
          }),
        );
        return;
      }
      await route.fulfill(json({ detail: '登入資訊不正確' }, 401));
      return;
    }

    if (req.method() === 'GET' && path.endsWith('/auth/student/progress')) {
      hits.progress += 1;
      const auth = req.headers().authorization ?? '';
      if (!auth.startsWith('Bearer ')) {
        await route.fulfill(json({ detail: '請先登入' }, 401));
        return;
      }
      await route.fulfill(json({ mode: 'personal', teamId: null, progress }));
      return;
    }

    if (req.method() === 'GET' && path.endsWith('/auth/student/me')) {
      const who = students[0];
      await route.fulfill(json(who ? studentMe(who) : studentMe({ id: 1, name: '小白' })));
      return;
    }

    if (req.method() === 'POST' && path.endsWith('/auth/student/logout')) {
      await route.fulfill(json({ ok: true }));
      return;
    }

    await route.fulfill(json({ detail: 'not mocked' }, 404));
  });

  await page.routeWebSocket(/\/ws\/?$/, (ws: WebSocketRoute) => {
    ws.onMessage((raw) => {
      const text = typeof raw === 'string' ? raw : raw.toString();
      let msg: { type?: string; t?: number; studentToken?: string };
      try {
        msg = JSON.parse(text) as { type?: string; t?: number; studentToken?: string };
      } catch {
        return;
      }
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', t: msg.t }));
        return;
      }
      if (msg.type !== 'register') return;
      ws.send(JSON.stringify({ type: 'welcome', id: 'stu-1' }));
      ws.send(
        JSON.stringify({
          type: 'room_joined',
          room: {
            code: 'MAIN',
            name: 'MAIN',
            hasPassword: false,
            maxStudents: 40,
            locked: false,
            studentCount: 1,
            arenaStatus: 'idle',
            soccerStatus: 'idle',
            createdAt: Date.now(),
          },
        }),
      );
      if (msg.studentToken && wsProgress) {
        ws.send(JSON.stringify({ type: 'progress_sync', progress: wsProgress }));
      }
    });
  });

  return { students, hits };
}

async function openAccount(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#login-modal')).toBeVisible();
  await page.click('#login-tab-account');
  await expect(page.locator('#login-pane-account')).toBeVisible();
  await expect(page.locator('#login-pane-guest')).toBeHidden();
}

test.beforeEach(async ({ page }) => {
  await skipOnboarding(page);
});

test.describe('學生帳號登入與註冊', () => {
  test('快速進場不用帳號也能進場', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#login-modal')).toBeVisible();
    await expect(page.locator('#login-pane-guest')).toBeVisible();
    await expect(page.locator('#login-start')).toHaveText('開始飛行');
    await page.fill('#login-name', '小飛');
    await page.locator('.emoji-btn[data-emoji="🐰"]').click();
    await page.click('#login-start');
    await expect(page.locator('#login-modal')).toBeHidden({ timeout: 15_000 });
    await expect(page.locator('#player-name-display')).toHaveText('小飛🐰');
  });

  test('三種模式只顯示自己的欄位與按鈕', async ({ page }) => {
    await installStudentApi(page);
    await openAccount(page);

    await expect(page.locator('#acct-code-fields')).toBeVisible();
    await expect(page.locator('#acct-email-fields')).toBeHidden();
    await expect(page.locator('#acct-register-fields')).toBeHidden();
    await expect(page.locator('#acct-mode-switch')).toHaveText('用 email 登入');
    await expect(page.locator('#acct-register-switch')).toHaveText('建立學生帳號');
    await expect(page.locator('#acct-login-btn')).toHaveText('登入');

    await page.click('#acct-mode-switch');
    await expect(page.locator('#acct-email-fields')).toBeVisible();
    await expect(page.locator('#acct-code-fields')).toBeHidden();
    await expect(page.locator('#acct-register-fields')).toBeHidden();
    await expect(page.locator('#acct-mode-switch')).toHaveText('用班級碼登入');
    await expect(page.locator('#acct-register-switch')).toHaveText('建立學生帳號');
    await expect(page.locator('#acct-login-btn')).toHaveText('登入');

    await page.click('#acct-register-switch');
    await expect(page.locator('#acct-register-fields')).toBeVisible();
    await expect(page.locator('#acct-email-fields')).toBeHidden();
    await expect(page.locator('#acct-code-fields')).toBeHidden();
    await expect(page.locator('#acct-login-btn')).toHaveText('建立帳號');
    await expect(page.locator('#acct-mode-switch')).toHaveText('用 email 登入');
    await expect(page.locator('#acct-register-switch')).toHaveText('用班級碼登入');

    await page.click('#acct-register-switch');
    await expect(page.locator('#acct-code-fields')).toBeVisible();
    await expect(page.locator('#acct-login-btn')).toHaveText('登入');
  });

  test('建立帳號讀註冊欄，不會被隱藏的 email 登入欄擋下', async ({ page }) => {
    const api = await installStudentApi(page);
    const bodies: { email?: string; name?: string }[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/auth/student/register')) {
        bodies.push(req.postDataJSON() as { email?: string; name?: string });
      }
    });
    await openAccount(page);
    await page.click('#acct-register-switch');
    // 隱藏的登入欄故意填別的信箱。修正前送出會讀這格，出現「請輸入 email」或拿錯帳號。
    await page.locator('#acct-email').evaluate((el) => {
      (el as HTMLInputElement).value = 'hidden@example.com';
    });
    await page.locator('#acct-email-pw').evaluate((el) => {
      (el as HTMLInputElement).value = 'hidden-pass';
    });
    await page.fill('#acct-reg-name', '小白');
    await page.fill('#acct-reg-email', 'xiaobai@example.com');
    await page.fill('#acct-reg-pw', 'password');
    await page.click('#acct-login-btn');

    await expect(page.locator('#acct-error')).toBeHidden();
    await expect(page.locator('#login-modal')).toBeHidden();
    await expect(page.locator('#player-name-display')).toHaveText('小白🙂');
    expect(api.hits.register).toBe(1);
    expect(api.hits.login).toBe(0);
    expect(bodies[0]).toMatchObject({ name: '小白', email: 'xiaobai@example.com', password: 'password' });
    await dismissLevelIntroIfNeeded(page);
    await page.click('#level-menu-toggle');
    await expect(page.locator('.level-btn[data-level="1-1"]')).toHaveClass(/completed/);
  });

  test('在註冊欄按 Enter 不會改走快速進場', async ({ page }) => {
    const api = await installStudentApi(page);
    await page.goto('/');
    await page.fill('#login-name', '訪客名');
    await page.locator('.emoji-btn[data-emoji="🐯"]').click();
    await page.click('#login-tab-account');
    await page.click('#acct-register-switch');
    await page.fill('#acct-reg-name', '小白');
    await page.fill('#acct-reg-email', 'enter@example.com');
    await page.fill('#acct-reg-pw', 'password');
    await page.evaluate(() => {
      const w = window as unknown as { __guestClicks?: number };
      w.__guestClicks = 0;
      document.getElementById('login-start')?.addEventListener('click', () => {
        w.__guestClicks = (w.__guestClicks ?? 0) + 1;
      });
    });
    await page.locator('#acct-reg-pw').press('Enter');
    await expect(page.locator('#player-name-display')).toHaveText('小白🙂');
    expect(await page.evaluate(() => (window as unknown as { __guestClicks?: number }).__guestClicks ?? 0)).toBe(0);
    expect(api.hits.register).toBe(1);
    expect(api.hits.login).toBe(0);
  });

  test('密碼太短與 email 重複有清楚的錯誤，按鈕仍是建立帳號', async ({ page }) => {
    const api = await installStudentApi(page);
    api.students.push({
      email: 'used@example.com',
      name: '舊生',
      password: 'password',
      token: 'tok-used',
      id: 99,
    });
    await openAccount(page);
    await page.click('#acct-register-switch');
    await page.fill('#acct-reg-name', '小白');
    await page.fill('#acct-reg-email', 'xiaobai@example.com');
    await page.fill('#acct-reg-pw', 'short');
    await page.click('#acct-login-btn');
    await expect(page.locator('#acct-error')).toHaveText('密碼至少 8 個字元');
    await expect(page.locator('#acct-login-btn')).toHaveText('建立帳號');
    expect(api.hits.register).toBe(0);

    await page.fill('#acct-reg-email', 'used@example.com');
    await page.fill('#acct-reg-pw', 'password');
    await page.click('#acct-login-btn');
    await expect(page.locator('#acct-error')).toHaveText('這個 email 已經註冊過');
    await expect(page.locator('#acct-login-btn')).toHaveText('建立帳號');
    await expect(page.locator('#acct-register-fields')).toBeVisible();
    expect(api.hits.register).toBe(1);
  });

  test('email 與密碼登入，密碼錯誤時留在登入頁', async ({ page }) => {
    const api = await installStudentApi(page, { progress: { '1-2': { bestTimeMs: 8000, attempts: 1 } } });
    api.students.push({
      email: 'xiaobai@example.com',
      name: '小白',
      password: 'password',
      token: 'tok-mail',
      id: 3,
    });
    await openAccount(page);
    await page.click('#acct-mode-switch');
    await page.fill('#acct-email', 'xiaobai@example.com');
    await page.fill('#acct-email-pw', 'wrong-pass');
    await page.click('#acct-login-btn');
    await expect(page.locator('#acct-error')).toHaveText('登入失敗：email 或密碼不對');
    await expect(page.locator('#login-modal')).toBeVisible();
    await expect(page.locator('#acct-login-btn')).toHaveText('登入');

    await page.fill('#acct-email-pw', 'password');
    await page.click('#acct-login-btn');
    await expect(page.locator('#login-modal')).toBeHidden();
    await expect(page.locator('#player-name-display')).toHaveText('小白🙂');
    expect(api.hits.progress).toBeGreaterThan(0);
    await dismissLevelIntroIfNeeded(page);
    await page.click('#level-menu-toggle');
    await expect(page.locator('.level-btn[data-level="1-2"]')).toHaveClass(/completed/);
  });

  test('沒有 progress_sync 時仍用 GET /auth/student/progress 畫勾勾', async ({ page }) => {
    await installStudentApi(page, {
      progress: { '1-1': { bestTimeMs: 15000, attempts: 3 } },
      wsProgress: null,
    });
    await openAccount(page);
    await page.click('#acct-register-switch');
    await page.fill('#acct-reg-name', '小白');
    await page.fill('#acct-reg-email', 'solo@example.com');
    await page.fill('#acct-reg-pw', 'password');
    await page.click('#acct-login-btn');
    await expect(page.locator('#login-modal')).toBeHidden();
    await dismissLevelIntroIfNeeded(page);
    await page.click('#level-menu-toggle');
    await expect(page.locator('.level-btn[data-level="1-1"]')).toHaveClass(/completed/);
  });

  test('班級碼登入、密碼欄與錯誤班級碼', async ({ page }) => {
    await installStudentApi(page, { needsPassword: new Set(['ABCD:01']) });
    await openAccount(page);
    await page.fill('#acct-team-code', 'zzzz');
    await page.fill('#acct-student-code', '01');
    await page.click('#acct-login-btn');
    await expect(page.locator('#acct-error')).toHaveText('登入失敗：班級碼、學生碼或密碼不對，請再檢查一次');

    await page.fill('#acct-team-code', 'abcd');
    await page.fill('#acct-student-code', '01');
    await page.click('#acct-login-btn');
    await expect(page.locator('#acct-code-pw-field')).toBeVisible();
    await expect(page.locator('#acct-error')).toHaveText('這個帳號有設定密碼，請輸入密碼後再按一次登入');

    await page.fill('#acct-code-pw', 'class-pass');
    await page.click('#acct-login-btn');
    await expect(page.locator('#login-modal')).toBeHidden();
    await expect(page.locator('#player-name-display')).toHaveText('小碼🙂');
  });
});
