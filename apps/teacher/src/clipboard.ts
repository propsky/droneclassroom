// 剪貼簿 — clipboard API 失敗時退回 execCommand（教室後台常跑在 http 區網位址 → 沒有安全來源）。
import { toast } from './toast';

/** 舊式複製後備（document.execCommand） */
function legacyCopy(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

/** 複製到剪貼簿並 toast 結果（成功顯示 okText） */
export function copyText(text: string, okText: string): void {
  void (async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      ok = legacyCopy(text);
    }
    toast(ok ? okText : '複製失敗，請手動抄寫', ok ? 'success' : 'error');
  })();
}
