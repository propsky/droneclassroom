/** 瀏覽器能力探測 — 展場最低規格（Chrome / Edge / Safari 現行版 + iPad Safari） */

export interface BrowserCapabilities {
  webgl: boolean;
  localStorage: boolean;
  secureRandom: boolean;
  touch: boolean;
  ios: boolean;
}

function hasWebGL(win: Window): boolean {
  try {
    const canvas = win.document.createElement('canvas');
    return !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
  } catch {
    return false;
  }
}

function hasLocalStorage(win: Window): boolean {
  try {
    const k = '__creafly_ls_probe__';
    win.localStorage.setItem(k, '1');
    win.localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

function hasSecureRandom(win: Window): boolean {
  const c = win.crypto;
  if (!c) return false;
  if (typeof c.randomUUID === 'function') return true;
  try {
    return !!c.getRandomValues(new Uint8Array(1));
  } catch {
    return false;
  }
}

function isIOS(win: Window): boolean {
  const ua = win.navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (win.navigator.platform === 'MacIntel' && win.navigator.maxTouchPoints > 1);
}

function isTouch(win: Window): boolean {
  return win.navigator.maxTouchPoints > 0 || 'ontouchstart' in win;
}

/** 探測目前環境能力；Node 測試可注入 mock Window */
export function probeBrowserCapabilities(win: Window = globalThis as unknown as Window): BrowserCapabilities {
  return {
    webgl: hasWebGL(win),
    localStorage: hasLocalStorage(win),
    secureRandom: hasSecureRandom(win),
    touch: isTouch(win),
    ios: isIOS(win),
  };
}

/** 學生端最低可玩條件（WebGL + 亂數；localStorage 缺失時進度佇列降級但仍可玩） */
export function meetsMinimumPlayRequirements(caps: BrowserCapabilities): boolean {
  return caps.webgl && caps.secureRandom;
}
