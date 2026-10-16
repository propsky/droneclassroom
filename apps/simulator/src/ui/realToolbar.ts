// 學生積木頁的模擬器／真機工具列。
// 切換要不要出現只問 isRealDroneSwitchVisible（PR-C 改班級設定時不用動這支）。
// 預設模擬器。上次選擇、橋接位址、距離比例記在 localStorage。切到真機不會自動連線。
import { flags } from '../core/droneState';
import { bus, toast } from '../core/events';
import { getExecutionMode, setExecutionMode } from '../core/execution/mode';
import { isRealDroneSwitchVisible, resolveInitialExecutionMode } from '../core/execution/realModeAccess';
import {
  SCALE_CHOICES,
  getBridgeUrl,
  getCmPerMeter,
  hydrateRealPrefs,
  normalizeBridgeUrl,
  saveStoredExecutionMode,
  saveStoredLinkPrefs,
  scaleOptionLabel,
  setBridgeUrl,
  setCmPerMeter,
  type PrefStore,
} from '../core/execution/realPrefs';
import { STATUS_TEXT, realMotionRuntime } from '../core/execution/realRuntime';
import { describeRealToolbar, type RealToolbarView } from '../core/execution/realUiState';
import { runProgram, stopProgram } from '../core/program';
import { mountIcons } from './icons';

const $ = (id: string): HTMLElement | null => document.getElementById(id);

function browserStore(): PrefStore | null {
  try {
    const probe = '__creafly_exec_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

function codeFromEditor(): string {
  const provider = (window as unknown as Record<string, unknown>)['__creaflyGetCode'];
  if (typeof provider !== 'function') return '';
  const code = (provider as () => string)();
  return typeof code === 'string' ? code : '';
}

function rememberMode(mode: 'sim' | 'real'): void {
  const store = browserStore();
  if (store) saveStoredExecutionMode(store, mode);
}

export function initRealToolbar(): void {
  const switchEl = $('exec-switch');
  const controls = $('real-controls');
  const settings = $('real-settings');
  const runBtn = $('btn-run') as HTMLButtonElement | null;
  const runLabel = $('btn-run-label');
  if (!switchEl || !controls || !settings || !runBtn || !runLabel) return;

  const store = browserStore();
  const stored = store ? hydrateRealPrefs(store) : null;
  const visible = isRealDroneSwitchVisible();
  const initial = resolveInitialExecutionMode(stored?.mode ?? 'sim', visible);
  if (initial === 'real') setExecutionMode('real');

  const scaleSelect = $('real-scale') as HTMLSelectElement | null;
  if (scaleSelect && scaleSelect.options.length === 0) {
    for (const cm of SCALE_CHOICES) {
      const option = document.createElement('option');
      option.value = String(cm);
      option.textContent = scaleOptionLabel(cm);
      scaleSelect.appendChild(option);
    }
  }

  let connecting = false;
  let pinnedError: string | null = null;
  let settingsOpen = false;
  let announced: string | null = null;
  let runGate = false;
  /** 學生按了中斷或切回模擬器時，不要再播一次「斷線」提示 */
  let closing = false;

  const fillSettings = (): void => {
    const urlInput = $('real-url') as HTMLInputElement | null;
    if (urlInput) urlInput.value = getBridgeUrl();
    if (scaleSelect) scaleSelect.value = String(getCmPerMeter());
  };

  const render = (): void => {
    const snap = realMotionRuntime.snapshot();
    const view = describeRealToolbar({
      switchVisible: visible,
      mode: getExecutionMode(),
      connecting,
      link: snap.status,
      ...(snap.heightCm !== undefined ? { heightCm: snap.heightCm } : {}),
      ...(snap.voltageV !== undefined ? { voltageV: snap.voltageV } : {}),
      pinnedError,
      programRunning: flags.programRunning,
    });
    applyView(view, settingsOpen);
    if (view.realSelected) {
      const key = connecting ? 'connecting' : snap.status;
      const prev = announced;
      const changed = !closing && prev !== null && prev !== key && !connecting;
      if (!closing) announced = key;
      if (changed && snap.status === 'ready') toast('🚁 飛機已連通，可以執行了', 'success');
      else if (changed && prev === 'ready') toast(`🚁 ${STATUS_TEXT[snap.status]}`, 'error');
    } else {
      announced = null;
    }
  };

  const applyView = (view: RealToolbarView, panelOpen: boolean): void => {
    switchEl.hidden = !view.showSwitch;
    $('exec-sim')?.setAttribute('aria-pressed', String(view.simSelected));
    $('exec-real')?.setAttribute('aria-pressed', String(view.realSelected));
    switchEl.classList.toggle('is-locked', flags.programRunning);
    controls.hidden = !view.showRealControls;
    if (!view.showRealControls) settingsOpen = false;
    settings.hidden = !(view.showRealControls && panelOpen);
    const lamp = $('real-lamp');
    if (lamp) {
      lamp.className = `real-lamp ${view.lamp}`;
      lamp.setAttribute('aria-label', `連線狀態：${view.lampLabel}`);
    }
    const status = $('real-status-text');
    if (status) status.textContent = view.statusText;
    const connect = $('real-connect') as HTMLButtonElement | null;
    if (connect) {
      connect.disabled = view.connectDisabled;
      const label = connect.querySelector('span:last-child');
      if (label) label.textContent = view.connectLabel;
      connect.title = view.connectLabel === '中斷' ? '中斷連線（先硬停）' : '連上橋接程式';
    }
    runLabel.textContent = view.runLabel;
    document.body.classList.toggle('real-exec', view.runIsDanger);
    runBtn.title = view.runIsDanger ? '綠燈才能執行，真的無人機會飛' : '執行積木程式';
  };

  const releaseLink = async (): Promise<void> => {
    closing = true;
    if (flags.programRunning) stopProgram();
    await realMotionRuntime.disconnect();
    pinnedError = null;
    announced = 'bridge-down';
    closing = false;
  };

  const choose = async (mode: 'sim' | 'real'): Promise<void> => {
    if (!visible) return;
    if (flags.programRunning) {
      toast('⏳ 程式執行中，不能切換模式', 'error');
      return;
    }
    if (getExecutionMode() === mode) return;
    settingsOpen = false;
    pinnedError = null;
    if (mode === 'sim') {
      await releaseLink();
      setExecutionMode('sim');
      rememberMode('sim');
      toast('模擬器模式：積木只會移動畫面上的飛機', '');
    } else {
      setExecutionMode('real');
      if (getExecutionMode() !== 'real') return;
      rememberMode('real');
      toast('真機模式：請按「連線」，綠燈之後積木才會讓真的飛機起飛', '');
    }
    render();
  };

  $('exec-sim')?.addEventListener('click', () => void choose('sim'));
  $('exec-real')?.addEventListener('click', () => void choose('real'));

  $('real-connect')?.addEventListener('click', () => {
    if (connecting) return;
    const linked = getExecutionMode() === 'real' && realMotionRuntime.linkStatus() !== 'bridge-down';
    if (linked) {
      void releaseLink().then(render);
      return;
    }
    if (flags.programRunning) return;
    connecting = true;
    pinnedError = null;
    render();
    void realMotionRuntime
      .connect(getBridgeUrl())
      .catch(() => {
        toast(`🚁 連不上橋接程式（${getBridgeUrl()}）`, 'error');
      })
      .finally(() => {
        connecting = false;
        render();
      });
  });

  $('real-estop')?.addEventListener('click', () => {
    const linked = realMotionRuntime.linkStatus() !== 'bridge-down';
    pinnedError = null;
    if (flags.programRunning) stopProgram();
    void realMotionRuntime.emergencyStop().then(() => {
      toast(
        linked ? '緊急停止：已送出硬停，真機會停下並降落' : '還沒連上橋接，沒有飛機可以停',
        linked ? 'warning' : 'error',
      );
      render();
    });
  });

  $('real-settings-btn')?.addEventListener('click', () => {
    settingsOpen = !settingsOpen;
    if (settingsOpen) fillSettings();
    render();
  });

  $('real-settings-apply')?.addEventListener('click', () => {
    if (flags.programRunning) {
      toast('⏳ 程式執行中，設定下次再生效', 'error');
      return;
    }
    const urlInput = $('real-url') as HTMLInputElement | null;
    const nextUrl = normalizeBridgeUrl(urlInput?.value ?? '');
    if (!nextUrl) {
      toast('橋接位址要是 ws:// 或 wss:// 開頭', 'error');
      return;
    }
    const nextScale = Number(scaleSelect?.value);
    if (!setCmPerMeter(nextScale)) {
      toast('請選一個距離比例', 'error');
      return;
    }
    const urlChanged = nextUrl !== getBridgeUrl();
    setBridgeUrl(nextUrl);
    const prefs = browserStore();
    if (prefs) saveStoredLinkPrefs(prefs, nextUrl, nextScale);
    settingsOpen = false;
    if (urlChanged && realMotionRuntime.linkStatus() !== 'bridge-down') {
      void releaseLink().then(() => {
        toast('位址已更新。請重新按「連線」', '');
        render();
      });
      return;
    }
    toast('已套用真機設定', 'success');
    render();
  });

  runBtn.addEventListener(
    'click',
    (ev) => {
      if (getExecutionMode() !== 'real' || !visible) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (runGate || flags.programRunning) return;
      const code = codeFromEditor();
      if (!code.trim()) {
        toast('🧩 積木編輯器還沒有程式', 'warning');
        return;
      }
      runGate = true;
      pinnedError = null;
      render();
      void realMotionRuntime.preflight().then((res) => {
        runGate = false;
        if (!res.ok) {
          pinnedError = `不能執行：${res.text}`;
          toast(`🚁 不能執行：${res.text}`, 'error');
          render();
          return;
        }
        runProgram(code);
        render();
      });
    },
    true,
  );

  bus.on('execution-mode-changed', () => render());
  bus.on('program-running', ({ running }) => {
    if (running) pinnedError = null;
    render();
  });
  bus.on('toast', ({ text, kind }) => {
    if (getExecutionMode() !== 'real' || kind !== 'error') return;
    if (text.includes('不能切換')) return;
    pinnedError = text.replace(/^🚁\s*/, '').replace(/^執行錯誤：/, '');
    render();
  });

  window.addEventListener('pagehide', () => {
    if (getExecutionMode() !== 'real') return;
    void realMotionRuntime.disconnect();
  });

  const toolbar = $('blockly-toolbar');
  if (toolbar) mountIcons(toolbar);
  window.setInterval(render, 500);
  fillSettings();
  render();
}
