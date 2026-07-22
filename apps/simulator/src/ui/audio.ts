// 音訊：Web Audio 程式生成音效（照抄 legacy §5.6 振盪器參數）+ BGM <audio> 元素。
// 音效 / 音樂各自開關，設定存 localStorage。
import { bus, toast, type SoundName } from '../core/events';
import { iconHtml } from './icons';

const LS_MUTED = 'creafly_sfx_muted';
const LS_MUSIC = 'creafly_music_on';

const audioState = {
  ctx: null as AudioContext | null,
  muted: localStorage.getItem(LS_MUTED) === '1',
  bgmPlaying: false,
};

function ensureAudio(): AudioContext | null {
  if (!audioState.ctx) {
    try {
      audioState.ctx = new AudioContext();
    } catch (e) {
      console.warn('Web Audio API 不可用', e);
      return null;
    }
  }
  if (audioState.ctx.state === 'suspended') void audioState.ctx.resume();
  return audioState.ctx;
}

// 過圈音效：3 個上升音（C5-E5-G5）
function playRingSound(): void {
  const ctx = ensureAudio();
  if (!ctx || audioState.muted) return;
  const now = ctx.currentTime;
  [523.25, 659.25, 783.99].forEach((f, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0, now + i * 0.08);
    gain.gain.linearRampToValueAtTime(0.08, now + i * 0.08 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + i * 0.08);
    osc.stop(now + i * 0.08 + 0.22);
  });
}

// 撞牆 / 撞地音效：低頻方波短暫下滑
function playBumpSound(): void {
  const ctx = ensureAudio();
  if (!ctx || audioState.muted) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(120, now);
  osc.frequency.exponentialRampToValueAtTime(40, now + 0.15);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.12, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.2);
}

// 緊急停止音效：白噪音衰減（高通）
function playStopSound(): void {
  const ctx = ensureAudio();
  if (!ctx || audioState.muted) return;
  const now = ctx.currentTime;
  const buf = ctx.createBuffer(1, ctx.sampleRate * 0.25, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.15, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 1000;
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start(now);
  src.stop(now + 0.26);
}

// 過關完成：上行琶音（C5 E5 G5 C6，triangle）
function playCompleteSound(): void {
  const ctx = ensureAudio();
  if (!ctx || audioState.muted) return;
  const now = ctx.currentTime;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0, now + i * 0.1);
    gain.gain.linearRampToValueAtTime(0.1, now + i * 0.1 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + i * 0.1);
    osc.stop(now + i * 0.1 + 0.32);
  });
}

// 倒數提示音（短嗶；GO 較高音較長）
function playCountBeep(isGo: boolean): void {
  const ctx = ensureAudio();
  if (!ctx || audioState.muted) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.value = isGo ? 880 : 440;
  const t = ctx.currentTime;
  const dur = isGo ? 0.45 : 0.18;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

// 賽局結束倒數滴聲（§5.3）：短促 sine 一滴，比照既有振盪器風格；
// 由 ui/endCountdown.ts 於剩 ≤3 秒時每秒呼叫一次。尊重音效開關。
export function playTickSound(): void {
  const ctx = ensureAudio();
  if (!ctx || audioState.muted) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.value = 1320;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.2, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + 0.1);
}

const SOUND_FNS: Record<SoundName, () => void> = {
  ring: playRingSound,
  pop: playRingSound, // 氣球沿用過圈音（legacy 同）
  bump: playBumpSound,
  stop: playStopSound,
  complete: playCompleteSound,
  beep: () => playCountBeep(false),
  go: () => playCountBeep(true),
};

export function initAudio(): void {
  bus.on('sound', ({ name }) => SOUND_FNS[name]?.());

  // 第一次互動後解鎖 Web Audio（瀏覽器 autoplay 政策）
  window.addEventListener('pointerdown', () => ensureAudio());
  window.addEventListener('keydown', () => ensureAudio());

  // ---- 音效開關 ----
  const muteBtn = document.getElementById('mute-btn');
  const syncMuteBtn = (): void => {
    if (!muteBtn) return;
    muteBtn.innerHTML = audioState.muted
      ? `${iconHtml('volume-x')}<span>靜音中</span>`
      : `${iconHtml('volume')}<span>音效</span>`;
    muteBtn.classList.toggle('active', !audioState.muted);
  };
  syncMuteBtn();
  muteBtn?.addEventListener('click', () => {
    audioState.muted = !audioState.muted;
    localStorage.setItem(LS_MUTED, audioState.muted ? '1' : '0');
    syncMuteBtn();
    toast(audioState.muted ? '🔇 音效關閉' : '🔊 音效開啟');
  });

  // ---- 背景音樂開關（<audio> 串流；預設關，需使用者互動）----
  const bgm = document.getElementById('bg-music') as HTMLAudioElement | null;
  const musicBtn = document.getElementById('music-btn');
  const syncMusicBtn = (): void => {
    if (!musicBtn) return;
    musicBtn.innerHTML = `${iconHtml('music')}<span>音樂：${audioState.bgmPlaying ? '開' : '關'}</span>`;
    musicBtn.classList.toggle('active', audioState.bgmPlaying);
  };
  const startBGM = (): void => {
    if (!bgm) return;
    bgm.volume = 0.15;
    const p = bgm.play();
    p?.catch((err) => console.warn('背景音樂播放被瀏覽器阻擋（需使用者互動）：', err));
    audioState.bgmPlaying = true;
    localStorage.setItem(LS_MUSIC, '1');
    syncMusicBtn();
  };
  const stopBGM = (): void => {
    bgm?.pause();
    audioState.bgmPlaying = false;
    localStorage.setItem(LS_MUSIC, '0');
    syncMusicBtn();
  };
  syncMusicBtn();
  musicBtn?.addEventListener('click', () => {
    if (audioState.bgmPlaying) {
      stopBGM();
      toast('🎵 背景音樂關閉');
    } else {
      startBGM();
      toast('🎵 背景音樂開啟');
    }
  });
  // 上次開著音樂 → 第一次互動時自動續播
  if (localStorage.getItem(LS_MUSIC) === '1') {
    window.addEventListener('pointerdown', () => startBGM(), { once: true });
  }
}
