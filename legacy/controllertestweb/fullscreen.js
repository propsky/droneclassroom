/*
 * 跨瀏覽器全螢幕小工具 (含 iPad/iOS 處理)
 *
 * - iPad Safari：支援 webkitRequestFullscreen，按鈕即可全螢幕。
 * - iPhone Safari：不支援元素全螢幕，請用「加到主畫面」(PWA) 達成全螢幕，
 *   需要 index.html <head> 內的 apple-mobile-web-app-capable meta。
 *
 * 用法：
 *   <button id="fs">全螢幕</button>
 *   Fullscreen.wireButton(document.getElementById('fs'));   // 自動切換 + 更新文字
 *   // 或自行呼叫：Fullscreen.toggle(document.documentElement)
 */
const Fullscreen = (function () {
  function element() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function isActive() {
    return !!element();
  }

  function isSupported() {
    const el = document.documentElement;
    return !!(el.requestFullscreen || el.webkitRequestFullscreen);
  }

  // 是否為 iOS 裝置 (iPhone 沒有元素全螢幕)
  function isIPhone() {
    return /iPhone|iPod/.test(navigator.userAgent);
  }

  // 已用「加到主畫面」以獨立模式開啟 (PWA standalone)
  function isStandalone() {
    return window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }

  function enter(el) {
    el = el || document.documentElement;
    if (el.requestFullscreen) return el.requestFullscreen();
    if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen(); // Safari (含 iPad)
    return Promise.reject(new Error('Fullscreen API not supported'));
  }

  function exit() {
    if (document.exitFullscreen) return document.exitFullscreen();
    if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
    return Promise.resolve();
  }

  function toggle(el) {
    return isActive() ? exit() : enter(el);
  }

  // 把一顆按鈕接成全螢幕切換；不支援時給提示
  function wireButton(btn, target) {
    target = target || document.documentElement;

    function refresh() {
      btn.textContent = isActive() ? '結束全螢幕' : '全螢幕';
    }

    btn.addEventListener('click', function () {
      if (!isSupported()) {
        if (isIPhone() && !isStandalone()) {
          alert('iPhone 請用 Safari 的「分享 → 加入主畫面」，再從主畫面圖示開啟即為全螢幕。');
        } else {
          alert('此瀏覽器不支援全螢幕。可改用「加入主畫面」。');
        }
        return;
      }
      Promise.resolve(toggle(target)).catch(function (e) {
        console.warn('Fullscreen failed:', e);
      });
    });

    document.addEventListener('fullscreenchange', refresh);
    document.addEventListener('webkitfullscreenchange', refresh);
    refresh();
  }

  return { element, isActive, isSupported, isIPhone, isStandalone, enter, exit, toggle, wireButton };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Fullscreen };
}
if (typeof window !== 'undefined') {
  window.Fullscreen = Fullscreen;
}
