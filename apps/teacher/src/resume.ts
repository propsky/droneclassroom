// 失效保留狀態 — 儀表板把「目前選定房碼 + 目前分頁」隨時寫進 sessionStorage；
// session 失效（WS 4401 / /me 401）回登入後，重新登入會讀回來自動恢復（選該房、開該分頁）。
// 只有老師自己按「登出」才清掉；分頁關閉也跟著 sessionStorage 一起消失。

const RESUME_KEY = 'creafly-teacher-resume';

export interface ResumeState {
  roomCode: string | null;
  tab: string;
}

export function saveResume(state: ResumeState): void {
  try {
    sessionStorage.setItem(RESUME_KEY, JSON.stringify(state));
  } catch {
    /* 隱私模式等存不進去就算了，不影響主流程 */
  }
}

export function loadResume(): ResumeState | null {
  try {
    const raw = sessionStorage.getItem(RESUME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ResumeState>;
    return { roomCode: typeof parsed.roomCode === 'string' ? parsed.roomCode : null, tab: parsed.tab || 'levels' };
  } catch {
    return null;
  }
}

export function clearResume(): void {
  sessionStorage.removeItem(RESUME_KEY);
}
