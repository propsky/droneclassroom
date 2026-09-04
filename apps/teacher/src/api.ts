// REST 呼叫（契約見 @creafly/shared 的 rest.ts）＋ session 保存（localStorage：ticket / 過期時間 / 老師身分）。
// 憑證：登入或註冊拿到 session token（欄位名沿用 ticket）；REST 以 Authorization: Bearer 帶上、WS 以 ?ticket= 帶上。
// 伺服器每次使用都滑動延長，前端在 /me 成功時跟著把本地 expiresAt 往後推。
import { API_BASE } from './backend';
import type {
  CatalogAssignRequest,
  CatalogPatchRequest,
  CurriculumResponse,
  CreateCustomLevelRequest,
  CreateTeacherLevelKitRequest,
  InfoResponse,
  PatchTeacherLevelKitRequest,
  LevelsResponse,
  ReinviteResponse,
  StudentsCreateRequest,
  StudentsCreateResponse,
  StudentsListResponse,
  TeacherChangePasswordRequest,
  TeacherLevelBrief,
  TeacherLevelDetail,
  TeacherLevelKitDetail,
  TeacherLevelKitsResponse,
  TeacherLevelsResponse,
  TeacherLoginRequest,
  TeacherLoginResponse,
  TeacherMe,
  TeacherMeResponse,
  TeacherPasswordResetConfirm,
  TeacherPasswordResetRequest,
  TeacherRegisterRequest,
  TeamCatalogListResponse,
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
export function authErrorText(
  err: unknown,
  ctx: 'login' | 'register' | 'password' | 'reset' | 'forgot' = 'login',
): string {
  if (!(err instanceof ApiError)) return '發生未知錯誤，請再試一次';
  switch (err.status) {
    case 0:
      return '無法連到伺服器，請確認後端已啟動';
    case 400:
    case 422:
      return ctx === 'password' || ctx === 'reset'
        ? '新密碼格式不符（至少 8 碼）'
        : '資料格式不正確，請檢查後再試';
    case 403:
      return ctx === 'register' ? '註冊邀請碼不正確' : '帳號或密碼錯誤';
    case 401:
      return ctx === 'password' ? '目前密碼不正確' : '帳號或密碼錯誤';
    case 404:
      return ctx === 'reset' ? '重設連結無效或已過期，請重新申請' : '找不到資源';
    case 409:
      return '這個 email 已註冊過，直接登入';
    case 429:
      return '嘗試太多次，稍等一下';
    case 503:
      return '伺服器尚未啟用帳號功能';
    default:
      return `${ctx === 'register' ? '註冊' : ctx === 'password' ? '更新密碼' : ctx === 'reset' ? '重設密碼' : ctx === 'forgot' ? '寄送重設信' : '登入'}失敗（HTTP ${err.status}）`;
  }
}

// ---------- fetch 包裝 ----------

interface RequestOpts {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
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
  const text = await res.text();
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    let msg: string | undefined;
    try {
      const errBody = JSON.parse(text) as { detail?: unknown };
      if (typeof errBody.detail === 'string') msg = errBody.detail;
    } catch {
      /* 非 JSON */
    }
    throw new ApiError(res.status, msg);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

// ---------- 老師帳號 ----------

/** POST /auth/teacher/register（201）→ 直接視同登入（回傳含 ticket） */
export function register(
  email: string,
  password: string,
  name: string,
  registerCode?: string,
): Promise<TeacherLoginResponse> {
  const body: TeacherRegisterRequest = { email, password, name, registerCode };
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

/** POST /auth/teacher/password-reset/request — 寄重設密碼連結 */
export function requestPasswordReset(email: string): Promise<{ ok: true }> {
  const body: TeacherPasswordResetRequest = { email };
  return request<{ ok: true }>('/auth/teacher/password-reset/request', { method: 'POST', body });
}

/** POST /auth/teacher/password-reset/confirm — 重設密碼並登入 */
export function confirmPasswordReset(
  resetToken: string,
  newPassword: string,
): Promise<TeacherLoginResponse> {
  const body: TeacherPasswordResetConfirm = { resetToken, newPassword };
  return request<TeacherLoginResponse>('/auth/teacher/password-reset/confirm', {
    method: 'POST',
    body,
  });
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

/** GET /api/teams/{teamId}/curriculum — 老師廣播下拉用分組清單 */
export function fetchTeamCurriculum(teamId: number): Promise<CurriculumResponse> {
  return request<CurriculumResponse>(`/api/teams/${teamId}/curriculum`, { auth: true });
}

/** GET /api/teams/{teamId}/catalog — 班級目錄管理全列 */
export function fetchTeamCatalog(teamId: number): Promise<TeamCatalogListResponse> {
  return request<TeamCatalogListResponse>(`/api/teams/${teamId}/catalog`, { auth: true });
}

/** POST /api/teams/{teamId}/catalog — 將已發布關卡加入班級 */
export function assignToCatalog(teamId: number, body: CatalogAssignRequest): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/api/teams/${teamId}/catalog`, {
    method: 'POST',
    body,
    auth: true,
  });
}

/** PATCH /api/teams/{teamId}/catalog/{levelId} — 更新目錄項 */
export function patchCatalogEntry(
  teamId: number,
  levelId: string,
  body: CatalogPatchRequest,
): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/api/teams/${teamId}/catalog/${encodeURIComponent(levelId)}`, {
    method: 'PATCH',
    body,
    auth: true,
  });
}

/** GET /api/teacher/levels — 作品庫 */
export function fetchTeacherLevels(): Promise<TeacherLevelsResponse> {
  return request<TeacherLevelsResponse>('/api/teacher/levels', { auth: true });
}

/** POST /api/teacher/levels — 建立草稿 */
export function createTeacherLevel(body: CreateCustomLevelRequest): Promise<TeacherLevelBrief> {
  return request<TeacherLevelBrief>('/api/teacher/levels', { method: 'POST', body, auth: true });
}

/** POST /api/teacher/levels/{id}/publish — 發布 */
export function publishTeacherLevel(id: number): Promise<TeacherLevelBrief> {
  return request<TeacherLevelBrief>(`/api/teacher/levels/${id}/publish`, {
    method: 'POST',
    auth: true,
  });
}

/** GET /api/teacher/levels/{id} — 含 definition */
export function fetchTeacherLevel(id: number): Promise<TeacherLevelDetail> {
  return request<TeacherLevelDetail>(`/api/teacher/levels/${id}`, { auth: true });
}

/** PATCH /api/teacher/levels/{id} — 自動儲存草稿 */
export function patchTeacherLevel(
  id: number,
  body: { title?: string; definition?: Record<string, unknown> },
): Promise<TeacherLevelBrief> {
  return request<TeacherLevelBrief>(`/api/teacher/levels/${id}`, {
    method: 'PATCH',
    body,
    auth: true,
  });
}

/** GET /api/teacher/level-kits — 老師自訂素材 */
export function fetchTeacherLevelKits(): Promise<TeacherLevelKitsResponse> {
  return request<TeacherLevelKitsResponse>('/api/teacher/level-kits', { auth: true });
}

/** GET /api/teacher/level-kits/{id} */
export function fetchTeacherLevelKit(id: number): Promise<TeacherLevelKitDetail> {
  return request<TeacherLevelKitDetail>(`/api/teacher/level-kits/${id}`, { auth: true });
}

/** POST /api/teacher/level-kits — 儲存素材 */
export function createTeacherLevelKit(
  body: CreateTeacherLevelKitRequest,
): Promise<TeacherLevelKitDetail> {
  return request<TeacherLevelKitDetail>('/api/teacher/level-kits', {
    method: 'POST',
    body,
    auth: true,
  });
}

/** DELETE /api/teacher/level-kits/{id} */
export function deleteTeacherLevelKit(id: number): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/api/teacher/level-kits/${id}`, {
    method: 'DELETE',
    auth: true,
  });
}

/** PATCH /api/teacher/level-kits/{id} — 更新素材或分享設定 */
export function patchTeacherLevelKit(
  id: number,
  body: PatchTeacherLevelKitRequest,
): Promise<TeacherLevelKitDetail> {
  return request<TeacherLevelKitDetail>(`/api/teacher/level-kits/${id}`, {
    method: 'PATCH',
    body,
    auth: true,
  });
}

export function fetchInfo(): Promise<InfoResponse> {
  return request<InfoResponse>('/api/info');
}
