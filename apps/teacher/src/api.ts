// REST 呼叫（契約見 @creafly/shared 的 rest.ts）＋ ticket 保存（sessionStorage，含過期時間）。
import { API_BASE } from './backend';
import type {
  TeacherLoginRequest,
  TeacherLoginResponse,
  LevelsResponse,
  InfoResponse,
} from '@creafly/shared';

const TICKET_KEY = 'creafly-teacher-ticket';

export interface StoredTicket {
  ticket: string;
  /** epoch ms，過了就視同未登入 */
  expiresAt: number;
}

export function saveTicket(res: TeacherLoginResponse): void {
  const stored: StoredTicket = {
    ticket: res.ticket,
    expiresAt: Date.now() + res.expiresIn * 1000,
  };
  sessionStorage.setItem(TICKET_KEY, JSON.stringify(stored));
}

/** 取出仍有效的 ticket；過期或不存在回 null（並順手清掉） */
export function loadTicket(): StoredTicket | null {
  try {
    const raw = sessionStorage.getItem(TICKET_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredTicket;
    if (!stored.ticket || Date.now() >= stored.expiresAt) {
      clearTicket();
      return null;
    }
    return stored;
  } catch {
    clearTicket();
    return null;
  }
}

export function clearTicket(): void {
  sessionStorage.removeItem(TICKET_KEY);
}

/** 登入失敗（4xx/5xx），status 給呼叫端決定訊息（401=PIN 錯、429=太多次） */
export class LoginError extends Error {
  constructor(public status: number) {
    super(`登入失敗（HTTP ${status}）`);
    this.name = 'LoginError';
  }
}

export async function teacherLogin(pin: string): Promise<TeacherLoginResponse> {
  const body: TeacherLoginRequest = { password: pin };
  const res = await fetch(API_BASE + '/auth/teacher', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new LoginError(res.status);
  return (await res.json()) as TeacherLoginResponse;
}

export async function fetchLevels(): Promise<LevelsResponse> {
  const res = await fetch(API_BASE + '/api/levels');
  if (!res.ok) throw new Error(`GET /api/levels 失敗（HTTP ${res.status}）`);
  return (await res.json()) as LevelsResponse;
}

export async function fetchInfo(): Promise<InfoResponse> {
  const res = await fetch(API_BASE + '/api/info');
  if (!res.ok) throw new Error(`GET /api/info 失敗（HTTP ${res.status}）`);
  return (await res.json()) as InfoResponse;
}
