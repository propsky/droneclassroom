// REST API 契約（教師後台 ⇄ apps/api）— WS 之外的 HTTP 端點型別。

// ---------- 老師帳號（DB session；取代舊 PIN/HMAC ticket）----------
// 憑證語意：登入發 session token（隨機字串，DB 存 hash），REST 以 Authorization: Bearer <token>、
// WS 以 /teacher?ticket=<token> 帶上（欄位名沿用 ticket，前端改動最小）。
// 每次使用滑動延長 30 天（使用者無感續期）；只有登出 / 換密碼 / 停權 / 真過期才需重登。

export interface TeacherMe {
  id: number;
  email: string;
  name: string;
  role: 'teacher' | 'org_admin';
  orgId: number;
  orgName: string;
}

/** POST /auth/teacher/register — 老師自行註冊（掛預設 org；之後有邀請碼/多租戶再擴） */
export interface TeacherRegisterRequest {
  email: string;
  password: string;
  name: string;
}

/** POST /auth/teacher/login */
export interface TeacherLoginRequest {
  email: string;
  password: string;
}

/** 註冊 / 登入共同回應 */
export interface TeacherLoginResponse {
  /** session token（REST Bearer / WS ?ticket=）；欄位名沿用 ticket 以相容既有前端 */
  ticket: string;
  /** 有效秒數（滑動延長，每次使用重算） */
  expiresIn: number;
  me: TeacherMe;
}

/** GET /auth/teacher/me（需 Bearer）— 開頁驗 token 是否仍有效 + 取得身分；同時滑動延長 */
export type TeacherMeResponse = TeacherMe;

/** POST /auth/teacher/logout（需 Bearer）— 撤銷目前 session */
export interface TeacherLogoutResponse { ok: true }

/** POST /auth/teacher/password（需 Bearer）— 換密碼；成功後其他 session 全部撤銷 */
export interface TeacherChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

// ---------- 學生帳號（老師建名單 + 邀請；無 email 學生用 班級碼+學生碼 登入）----------

export interface StudentEntry {
  id: number;
  name: string;
  emoji: string;
  /** 班內學生碼（'01'…），與班級碼組成無密碼登入憑證 */
  studentCode: string;
  email: string | null;
  inviteStatus: 'none' | 'sent' | 'accepted';
  status: 'active' | 'removed';
  createdAt: number;
  lastSeenAt: number | null;
}

/** POST /api/teams/{teamId}/students（Bearer 老師）— 批次建學生 */
export interface StudentsCreateRequest {
  /** 每列一個學生；email 選填 */
  students: { name: string; email?: string; emoji?: string }[];
  /** 有 email 的是否立刻寄邀請信（預設 true；寄失敗不擋建立） */
  sendInvites?: boolean;
}
export interface StudentsCreateResponse {
  created: StudentEntry[];
  /** 邀請信寄送結果（email → true/false；停用寄信時全 false） */
  invitesSent: Record<string, boolean>;
}

/** GET /api/teams/{teamId}/students（Bearer 老師） */
export interface StudentsListResponse { students: StudentEntry[] }

/** POST /api/students/{id}/reinvite（Bearer 老師）— 重寄邀請信 */
export interface ReinviteResponse { sent: boolean }

/** DELETE /api/students/{id}（Bearer 老師）— 移除（status=removed，進度保留） */

export interface StudentMe {
  id: number;
  name: string;
  emoji: string;
  teamId: number;
  teamName: string;
  teamCode: string;
  studentCode: string;
}

/** POST /auth/student/login — 兩種擇一：{teamCode, studentCode} 或 {email, password} */
export interface StudentLoginRequest {
  teamCode?: string;
  studentCode?: string;
  email?: string;
  password?: string;
}
export interface StudentLoginResponse {
  /** 學生 session token（90 天滑動）；WS register 以 studentToken 帶上 */
  token: string;
  expiresIn: number;
  me: StudentMe;
}

/** POST /auth/student/invite/accept — 邀請連結設密碼（完成即登入） */
export interface InviteAcceptRequest { inviteToken: string; password: string }
/** GET /auth/student/invite/{token} — 設密碼頁載入時查邀請對象（無效 404） */
export interface InviteInfoResponse { name: string; teamName: string; email: string }

/** GET /auth/student/me（Bearer）— 驗 token + 滑動延長 */
export type StudentMeResponse = StudentMe;

/** GET /api/levels 回應：三章全部關卡（給後台下拉選單/廣播用） */
export interface LevelsResponse {
  chapters: {
    chapter: number;
    name: string;
    levels: { id: string; name: string }[];
  }[];
}

/** 班級關卡 curriculum 回應（GET /api/student/curriculum、/api/teams/{id}/curriculum） */
export interface CurriculumLevelBrief {
  levelId: string;
  title: string;
  kind: 'system' | 'teacher';
  visibleInMenu?: boolean;
  teacherBroadcastable?: boolean;
}

export interface CurriculumGroup {
  label: string;
  sort: number;
  levels: CurriculumLevelBrief[];
}

export interface CurriculumResponse {
  groups: CurriculumGroup[];
}

/** GET /api/levels/{levelId} 回應 */
export interface LevelDefinitionResponse {
  definition: Record<string, unknown>;
}

/** 老師作品庫項目 */
export interface TeacherLevelBrief {
  id: number;
  levelId: string;
  title: string;
  status: 'draft' | 'published' | 'archived';
  updatedAt: number;
}

export interface TeacherLevelsResponse {
  levels: TeacherLevelBrief[];
}

/** GET /api/teacher/levels/{id} */
export interface TeacherLevelDetail extends TeacherLevelBrief {
  definition: Record<string, unknown>;
}

/** 老師預覽 iframe：sessionStorage 鍵與虛擬關卡 id */
export const PREVIEW_LEVEL_STORAGE_KEY = 'creafly_preview_level';
export const PREVIEW_LEVEL_ID = '__preview__';

export interface CreateCustomLevelRequest {
  title: string;
  templateLevelId?: string;
}

/** 老師自訂關卡素材（GET /api/teacher/level-kits） */
export interface TeacherLevelKitBrief {
  id: number;
  name: string;
  desc: string;
  category: 'rings' | 'obstacles' | 'tasks' | 'scenes' | 'draw' | 'races';
  updatedAt: number;
  scope: 'mine' | 'org';
  ownerName?: string;
  sharedWithOrg?: boolean;
}

export interface TeacherLevelKitsResponse {
  mine: TeacherLevelKitBrief[];
  org: TeacherLevelKitBrief[];
}

export interface TeacherLevelKitDetail extends TeacherLevelKitBrief {
  patch: Record<string, unknown>;
}

export interface CreateTeacherLevelKitRequest {
  name: string;
  desc?: string;
  category: TeacherLevelKitBrief['category'];
  patch: Record<string, unknown>;
  sharedWithOrg?: boolean;
}

export interface PatchTeacherLevelKitRequest {
  name?: string;
  desc?: string;
  category?: TeacherLevelKitBrief['category'];
  patch?: Record<string, unknown>;
  sharedWithOrg?: boolean;
}

/** 班級目錄一列（GET /api/teams/{id}/catalog） */
export interface TeamCatalogEntry {
  levelId: string;
  title: string;
  kind: 'system' | 'teacher';
  groupLabel: string;
  sortOrder: number;
  visibleInMenu: boolean;
  teacherBroadcastable: boolean;
  enabled: boolean;
}

export interface TeamCatalogListResponse {
  entries: TeamCatalogEntry[];
}

export interface CatalogAssignRequest {
  levelId: string;
  groupLabel: string;
  visibleInMenu?: boolean;
  teacherBroadcastable?: boolean;
}

export interface CatalogPatchRequest {
  groupLabel?: string;
  sortOrder?: number;
  visibleInMenu?: boolean;
  teacherBroadcastable?: boolean;
  enabled?: boolean;
}

/** GET /api/info 回應：教室現場資訊 */
export interface InfoResponse {
  /** 伺服器綁定的區網 IPv4 位址（老師投影給學生抄的網址） */
  lanAddresses: string[];
  port: number;
  /** 學生人數上限（顯示用，來自設定） */
  maxStudents: number;
  version: string;
  /** 免登入模式（測試用）：true 時前端跳過登入畫面自動取票 */
  teacherAuthDisabled?: boolean;
}

/** WS 升級被拒的 close codes */
export const WS_CLOSE_UNAUTHORIZED = 4401; // ticket 無效/過期
export const WS_CLOSE_BAD_ORIGIN = 4403; // Origin 不在白名單
