// REST 呼叫（契約見 @creafly/shared 的 rest.ts）＋ session 保存（localStorage：ticket / 過期時間 / 老師身分）。
// 憑證：登入或註冊拿到 session token（欄位名沿用 ticket）；REST 以 Authorization: Bearer 帶上、WS 以 ?ticket= 帶上。
// 伺服器每次使用都滑動延長，前端在 /me 成功時跟著把本地 expiresAt 往後推。
import { API_BASE } from './backend';
import type {
  InfoResponse,
  LevelsResponse,
  ReinviteResponse,
  StudentsCreateRequest,
  StudentsCreateResponse,
  StudentsListResponse,
  TeacherChangePasswordRequest,
  TeacherLoginRequest,
  TeacherLoginResponse,
  TeacherMe,
  TeacherMeResponse,
  TeacherRegisterRequest,
} from '@creafly/shared';

const SESSION_KEY = 'creafly-teacher-session';

export interface StoredSession {
  ticket: string;
  /** epoch ms，過了就視同未登入 */
  expiresAt: number;
  /** 伺服器給的有效秒數（滑動延長時用同一個長度重算 expiresAt） */
  expiresIn: number;
  /** 登入當下的身分（topbar 顯示名稱；/me 成功後更新） */
  me: TeacherMe;
}

export function saveSession(res: TeacherLoginResponse): StoredSession {
  const stored: StoredSession = {
    ticket: res.ticket,
    expiresAt: Date.now() + res.expiresIn * 1000,
    expiresIn: res.expiresIn,
    me: res.me,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(stored));
  return stored;
}

/** 取出仍有效的 session；過期或不存在回 null（並順手清掉） */
export function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredSession;
    if (!stored.ticket || !stored.me || Date.now() >= stored.expiresAt) {
      clearSession();
      return null;
    }
    return stored;
  } catch {
    clearSession();
    return null;
  }
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

/** /me 成功 → 更新身分並滑動延長本地過期時間（伺服器端同時也延長了） */
export function touchSession(me: TeacherMe): void {
  const cur = loadSession();
  if (!cur) return;
  const next: StoredSession = { ...cur, me, expiresAt: Date.now() + cur.expiresIn * 1000 };
  localStorage.setItem(SESSION_KEY, JSON.stringify(next));
}

/** REST 失敗：status 給呼叫端決定訊息（0 = 連不上伺服器 / 網路錯誤） */
export class ApiError extends Error {
  constructor(public status: number, message?: string) {
    super(message ?? (status === 0 ? '無法連到伺服器' : `HTTP ${status}`));
    this.name = 'ApiError';
  }
  /** 網路層失敗（斷網 / 後端沒開 / CORS）—— 不代表憑證有問題 */
  get isNetwork(): boolean {
    return this.status === 0;
  }
}

/** 是否為「伺服器連不上或暫時不可用」：這類錯誤不該把人登出 */
export function isOfflineError(err: unknown): boolean {
  return err instanceof ApiError && (err.isNetwork || err.status === 503 || err.status >= 500);
}

/** 依狀態碼轉成給老師看的帳號訊息（登入 / 註冊共用；ctx 決定 401 文案） */
export function authErrorText(err: unknown, ctx: 'login' | 'register' | 'password' = 'login'): string {
  if (!(err instanceof ApiError)) return '發生未知錯誤，請再試一次';
  switch (err.status) {
    case 0:
      return '無法連到伺服器，請確認後端已啟動';
    case 400:
    case 422:
      return ctx === 'password' ? '新密碼格式不符（至少 8 碼）' : '資料格式不正確，請檢查後再試';
    case 401:
    case 403:
      return ctx === 'password' ? '目前密碼不正確' : '帳號或密碼錯誤';
    case 409:
      return '這個 email 已註冊過，直接登入';
    case 429:
      return '嘗試太多次，稍等一下';
    case 503:
      return '伺服器尚未啟用帳號功能';
    default:
      return `${ctx === 'register' ? '註冊' : ctx === 'password' ? '更新密碼' : '登入'}失敗（HTTP ${err.status}）`;
  }
}

// ---------- fetch 包裝 ----------

interface RequestOpts {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  /** 帶 Authorization: Bearer <ticket>；沒有 session 時直接丟 401 */
  auth?: boolean;
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.auth) {
    const session = loadSession();
    if (!session) throw new ApiError(401, '尚未登入');
    headers['Authorization'] = `Bearer ${session.ticket}`;
  }
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiError(0);
  }
  if (!res.ok) throw new ApiError(res.status);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// ---------- 老師帳號 ----------

/** POST /auth/teacher/register（201）→ 直接視同登入（回傳含 ticket） */
export function register(email: string, password: string, name: string): Promise<TeacherLoginResponse> {
  const body: TeacherRegisterRequest = { email, password, name };
  return request<TeacherLoginResponse>('/auth/teacher/register', { method: 'POST', body });
}

/** POST /auth/teacher/login */
export function login(email: string, password: string): Promise<TeacherLoginResponse> {
  const body: TeacherLoginRequest = { email, password };
  return request<TeacherLoginResponse>('/auth/teacher/login', { method: 'POST', body });
}

/** GET /auth/teacher/me（需 Bearer）—— 驗 token 是否仍有效 + 滑動延長 */
export function me(): Promise<TeacherMeResponse> {
  return request<TeacherMeResponse>('/auth/teacher/me', { auth: true });
}

/** POST /auth/teacher/logout（需 Bearer）—— 撤銷目前 session；失敗不丟（本地照樣清） */
export async function logout(): Promise<void> {
  try {
    await request<unknown>('/auth/teacher/logout', { method: 'POST', auth: true });
  } catch {
    /* 伺服器那邊撤銷失敗（斷網 / 已失效）無妨，本地清掉即可 */
  }
}

/** POST /auth/teacher/password（需 Bearer）—— 成功後其他裝置的 session 全部撤銷，目前這個保留 */
export function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const body: TeacherChangePasswordRequest = { currentPassword, newPassword };
  return request<void>('/auth/teacher/password', { method: 'POST', body, auth: true });
}

// ---------- 班級學生名單（老師建名單 + 邀請；契約見 rest.ts 學生段落） ----------

/** GET /api/teams/{teamId}/students（Bearer）— 班級 DB 名單（與 WS 即時名冊是兩回事） */
export function listStudents(teamId: number): Promise<StudentsListResponse> {
  return request<StudentsListResponse>(`/api/teams/${teamId}/students`, { auth: true });
}

/** POST /api/teams/{teamId}/students（Bearer）— 批次建學生；sendInvites = 有 email 的是否立刻寄邀請信 */
export function createStudents(
  teamId: number,
  students: StudentsCreateRequest['students'],
  sendInvites: boolean,
): Promise<StudentsCreateResponse> {
  const body: StudentsCreateRequest = { students, sendInvites };
  return request<StudentsCreateResponse>(`/api/teams/${teamId}/students`, { method: 'POST', body, auth: true });
}

/** POST /api/students/{id}/reinvite（Bearer）— 重寄邀請信 */
export function reinviteStudent(id: number): Promise<ReinviteResponse> {
  return request<ReinviteResponse>(`/api/students/${id}/reinvite`, { method: 'POST', auth: true });
}

/** DELETE /api/students/{id}（Bearer）— 移除（status=removed，進度保留） */
export function removeStudent(id: number): Promise<void> {
  return request<void>(`/api/students/${id}`, { method: 'DELETE', auth: true });
}

// ---------- 教室資訊 ----------

export function fetchLevels(): Promise<LevelsResponse> {
  return request<LevelsResponse>('/api/levels');
}

export function fetchInfo(): Promise<InfoResponse> {
  return request<InfoResponse>('/api/info');
}
