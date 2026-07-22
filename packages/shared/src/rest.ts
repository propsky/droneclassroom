// REST API 契約（教師後台 ⇄ apps/api）— WS 之外的 HTTP 端點型別。

/** POST /auth/teacher 請求 */
export interface TeacherLoginRequest {
  password: string;
}

/** POST /auth/teacher 回應（401 時無 body） */
export interface TeacherLoginResponse {
  /** HMAC 簽名短效 ticket，WS 連線用 /teacher?ticket=<...> */
  ticket: string;
  /** 有效秒數 */
  expiresIn: number;
}

/** GET /api/levels 回應：三章全部關卡（給後台下拉選單/廣播用） */
export interface LevelsResponse {
  chapters: {
    chapter: number;
    name: string;
    levels: { id: string; name: string }[];
  }[];
}

/** GET /api/info 回應：教室現場資訊 */
export interface InfoResponse {
  /** 伺服器綁定的區網 IPv4 位址（老師投影給學生抄的網址） */
  lanAddresses: string[];
  port: number;
  /** 學生人數上限（顯示用，來自設定） */
  maxStudents: number;
  version: string;
}

/** WS 升級被拒的 close codes */
export const WS_CLOSE_UNAUTHORIZED = 4401; // ticket 無效/過期
export const WS_CLOSE_BAD_ORIGIN = 4403; // Origin 不在白名單
