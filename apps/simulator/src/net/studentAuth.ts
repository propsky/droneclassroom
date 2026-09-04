// 學生帳號 REST client + session 存取（localStorage `creafly_student`）。
// 契約：packages/shared/src/rest.ts 學生段落 —
//   POST /auth/student/login（班級碼+學生碼 或 email+密碼）
//   GET  /auth/student/me（Bearer；驗 token + 伺服器端滑動延長 90 天）
//   GET  /auth/student/invite/{token}（設密碼頁載入；無效 404）
//   POST /auth/student/invite/accept（設密碼，完成即登入）
// 走 API_BASE（前後分離部署同 net/backend.ts）；離線 / 連不上時回 'network'，不丟例外。
import type {
  InviteAcceptRequest,
  InviteInfoResponse,
  StudentLoginRequest,
  StudentLoginResponse,
  StudentMe,
  StudentMeResponse,
} from '@creafly/shared';
import { API_BASE } from './backend';

const LS_STUDENT = 'creafly_student';

/** 本地保存的學生 session（90 天自動登入用） */
export interface StudentSession {
  token: string;
  me: StudentMe;
  /** 有效秒數（login 回的 expiresIn；每次 me 成功後重算 expiresAt = 本地滑動） */
  expiresInSec: number;
  /** 本地過期時間（ms epoch）：只擋「明顯過期」少打一次必失敗的請求；真相在伺服器 */
  expiresAt: number;
}

export function loadStudentSession(): StudentSession | null {
  try {
    const raw = localStorage.getItem(LS_STUDENT);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<StudentSession>;
    if (!s.token || !s.me?.name || !s.me.emoji) return null;
    if (s.expiresAt && Date.now() > s.expiresAt) {
      clearStudentSession();
      return null;
    }
    return s as StudentSession;
  } catch {
    return null;
  }
}

export function saveStudentSession(token: string, me: StudentMe, expiresInSec: number): void {
  try {
    const session: StudentSession = {
      token,
      me,
      expiresInSec,
      expiresAt: Date.now() + expiresInSec * 1000,
    };
    localStorage.setItem(LS_STUDENT, JSON.stringify(session));
  } catch {
    /* 隱私模式等寫不進去 → 本次仍可用（記憶體內），只是重整後要重登 */
  }
}

/** me 驗證成功後呼叫：更新快取身分 + 本地滑動延長（伺服器端同時也延長了） */
export function touchStudentSession(me: StudentMe): void {
  const s = loadStudentSession();
  if (!s) return;
  saveStudentSession(s.token, me, s.expiresInSec);
}

export function clearStudentSession(): void {
  try {
    localStorage.removeItem(LS_STUDENT);
  } catch {
    /* ignore */
  }
}

/** WS register 組裝用：有有效 session 才回 token（net/ws.ts 每次連線時讀） */
export function getStudentToken(): string | null {
  return loadStudentSession()?.token ?? null;
}

// ---------------------------------------------------------------------------
// REST 呼叫（統一回 AuthResult，不丟例外 — 登入 UI 依 code 顯示對應文案）
// ---------------------------------------------------------------------------

export type AuthErrorCode =
  /** 401 且伺服器指明此帳號需要密碼（碼登入未帶密碼）→ UI 展開密碼欄 */
  | 'password_required'
  /** 401：憑證不對 / token 失效 */
  | 'unauthorized'
  /** 404：邀請連結無效 / 已使用 */
  | 'not_found'
  /** 連不上伺服器（離線 / 網路錯誤） */
  | 'network'
  /** 其他伺服器錯誤（5xx / 422 / 非 JSON 回應） */
  | 'server';

export type AuthResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: AuthErrorCode; status: number };

async function request<T>(path: string, init?: RequestInit): Promise<AuthResult<T>> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, init);
  } catch {
    return { ok: false, code: 'network', status: 0 };
  }
  if (res.ok) {
    try {
      return { ok: true, data: (await res.json()) as T };
    } catch {
      return { ok: false, code: 'server', status: res.status };
    }
  }
  let code: AuthErrorCode =
    res.status === 404 ? 'not_found' : res.status === 401 ? 'unauthorized' : 'server';
  // FastAPI 慣例錯誤體 {detail: string | {code: string}} → 辨識「這個帳號需要密碼」
  try {
    const body = (await res.json()) as { detail?: string | { code?: string } };
    const detail = typeof body.detail === 'string' ? body.detail : (body.detail?.code ?? '');
    if (res.status === 401 && /password[_ -]?required/i.test(detail)) code = 'password_required';
  } catch {
    /* 非 JSON 錯誤體（proxy 502 等）→ 維持狀態碼推斷 */
  }
  return { ok: false, code, status: res.status };
}

const postJson = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/** 登入 — 兩種擇一：{teamCode, studentCode(, password)} 或 {email, password} */
export function studentLogin(req: StudentLoginRequest): Promise<AuthResult<StudentLoginResponse>> {
  return request<StudentLoginResponse>('/auth/student/login', postJson(req));
}

/** 驗 token 是否仍有效 + 取最新身分（伺服器同時滑動延長） */
export function fetchStudentMe(token: string): Promise<AuthResult<StudentMeResponse>> {
  return request<StudentMeResponse>('/auth/student/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

/** 邀請設密碼頁載入：查邀請對象（無效 404 → 'not_found'） */
export function fetchInviteInfo(inviteToken: string): Promise<AuthResult<InviteInfoResponse>> {
  return request<InviteInfoResponse>(`/auth/student/invite/${encodeURIComponent(inviteToken)}`);
}

/** 邀請連結設密碼：完成即登入（回應與 login 同形） */
export function acceptInvite(req: InviteAcceptRequest): Promise<AuthResult<StudentLoginResponse>> {
  return request<StudentLoginResponse>('/auth/student/invite/accept', postJson(req));
}

/** POST /auth/student/logout — 撤銷伺服器 session */
export function studentLogout(token: string): Promise<AuthResult<{ ok: true }>> {
  return request<{ ok: true }>('/auth/student/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}
