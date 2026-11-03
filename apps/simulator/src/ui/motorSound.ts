// MIT License
//
// Copyright (c) 2026 Andrii Shramko
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//
// 音色與音效圖取自 ShramkoGSFPV（MIT）：
// https://github.com/AndriiShramko/ShramkoGSFPV
//   apps/fly/src/audio/motor-sound.ts 的 voiceHarmonics、MotorSound（四顆馬達的諧波振盪器 + 帶通噪音）
// 我們沒有馬達模型：四顆馬達的負載改由這裡用飛機實際的移動推出來（MotorSound.loads）。

// 馬達聲：照飛機的移動發出四顆馬達的嗡嗡聲。只讀 droneState，不寫，物理、判定、重播都不受影響。
// 預設關（一間教室三十台平板一起嗡嗡叫太吵），工具列「馬達聲」打開；音效靜音時也不響。
import { droneState, flags, forwardVec, rightVec } from '../core/droneState';
import { audioContext, sfxMuted } from './audio';
import { iconHtml } from './icons';
import { toast } from '../core/events';
import { MotorSound, type Motion, type MotorMix, type MotorMixInput } from './motorMix';

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** 參數滑到新目標的時間常數（秒）：平順，停下來一兩張畫面內聽得出來。 */
const GLIDE_S = 0.03;

/** 四顆馬達 + 槳流噪音 → 總音量，接在共用的 AudioContext 上，建一次。 */
class MotorVoices {
  private readonly master: GainNode;
  private readonly oscs: OscillatorNode[] = [];
  private readonly gains: GainNode[] = [];
  private readonly wash: GainNode;
  private readonly band: BiquadFilterNode;

  constructor(private readonly ac: AudioContext) {
    this.master = ac.createGain();
    this.master.gain.value = 0;
    this.master.connect(ac.destination);
    const h = MotorSound.harmonics(MotorSound.BLADES);
    const wave = ac.createPeriodicWave(new Float32Array(h.length), h, { disableNormalization: false });
    for (let k = 0; k < 4; k++) {
      const o = ac.createOscillator();
      o.setPeriodicWave(wave);
      o.frequency.value = MotorSound.ROTOR_MIN_HZ;
      const g = ac.createGain();
      g.gain.value = 0;
      o.connect(g).connect(this.master);
      o.start();
      this.oscs.push(o);
      this.gains.push(g);
    }
    // 兩秒白噪音循環，過帶通當槳流聲
    const len = Math.max(1, Math.round(ac.sampleRate * 2));
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const noise = ac.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    this.band = ac.createBiquadFilter();
    this.band.type = 'bandpass';
    this.band.Q.value = 0.9;
    this.wash = ac.createGain();
    this.wash.gain.value = 0;
    noise.connect(this.band).connect(this.wash).connect(this.master);
    noise.start();
  }

  apply(m: MotorMix): void {
    const t = this.ac.currentTime;
    this.master.gain.setTargetAtTime(m.master, t, GLIDE_S);
    m.voices.forEach((v, k) => {
      this.oscs[k]?.frequency.setTargetAtTime(v.freq, t, GLIDE_S);
      this.gains[k]?.gain.setTargetAtTime(v.gain, t, GLIDE_S);
    });
    this.wash.gain.setTargetAtTime(m.wash.gain, t, GLIDE_S);
    this.band.frequency.setTargetAtTime(m.wash.freq, t, GLIDE_S);
  }

  /** 切走分頁時畫面迴圈停了，直接歸零，不等下一張畫面 */
  silence(): void {
    this.master.gain.cancelScheduledValues(this.ac.currentTime);
    this.master.gain.setValueAtTime(0, this.ac.currentTime);
  }
}

const LS_MOTOR = 'creafly_motor_sound';

const state = {
  enabled: false,
  voices: null as MotorVoices | null,
  prev: null as { x: number; y: number; z: number; yaw: number; t: number } | null,
  motion: { forward: 0, right: 0, climb: 0, turn: 0 } as Motion,
};

function readEnabled(): boolean {
  try {
    return localStorage.getItem(LS_MOTOR) === '1';
  } catch {
    return false;
  }
}

function writeEnabled(on: boolean): void {
  try {
    localStorage.setItem(LS_MOTOR, on ? '1' : '0');
  } catch {
    /* 私密視窗：只在這次有效 */
  }
}

/** 要出聲才建音效圖（AudioContext 要等使用者互動後才能跑）。 */
function ensureVoices(): MotorVoices | null {
  if (state.voices) return state.voices;
  const ac = audioContext();
  if (!ac) return null;
  state.voices = new MotorVoices(ac);
  return state.voices;
}

/** 每張畫面：用位移推出飛機怎麼動，平滑後混成四顆馬達。 */
export function tickMotorSound(nowMs: number): void {
  if (!state.enabled) return;
  const p = droneState.position;
  const prev = state.prev;
  state.prev = { x: p.x, y: p.y, z: p.z, yaw: droneState.yaw, t: nowMs };
  if (prev && nowMs > prev.t && nowMs - prev.t < 200) {
    const dt = (nowMs - prev.t) / 1000;
    const dx = (p.x - prev.x) / dt;
    const dz = (p.z - prev.z) / dt;
    const f = forwardVec(droneState.yaw);
    const r = rightVec(droneState.yaw);
    const target: Motion = {
      forward: clamp((dx * f.x + dz * f.z) / MotorSound.REF_SPEED, -1, 1),
      right: clamp((dx * r.x + dz * r.z) / MotorSound.REF_SPEED, -1, 1),
      climb: clamp((p.y - prev.y) / dt / MotorSound.REF_SPEED, -1, 1),
      turn: clamp((droneState.yaw - prev.yaw) / dt / MotorSound.REF_TURN, -1, 1),
    };
    const k = 0.25;
    const m = state.motion;
    m.forward += (target.forward - m.forward) * k;
    m.right += (target.right - m.right) * k;
    m.climb += (target.climb - m.climb) * k;
    m.turn += (target.turn - m.turn) * k;
  }
  const flying = droneState.isFlying && !droneState.frozen && !droneState.hardLanding;
  const input: MotorMixInput = {
    motion: state.motion,
    flying,
    enabled: !sfxMuted(),
    paused: flags.paused,
    hidden: document.hidden,
  };
  // 沒出聲又還沒建圖：不為了靜音去建
  if (!state.voices && !MotorSound.audible(input)) return;
  ensureVoices()?.apply(MotorSound.mix(input));
}

export function initMotorSound(): void {
  state.enabled = readEnabled();
  const btn = document.getElementById('motor-btn');
  const sync = (): void => {
    if (!btn) return;
    btn.innerHTML = `${iconHtml('fan')}<span>馬達聲：${state.enabled ? '開' : '關'}</span>`;
    btn.classList.toggle('active', state.enabled);
    btn.setAttribute('aria-pressed', state.enabled ? 'true' : 'false');
  };
  sync();
  btn?.addEventListener('click', () => {
    state.enabled = !state.enabled;
    writeEnabled(state.enabled);
    sync();
    if (!state.enabled) state.voices?.silence();
    else ensureVoices(); // 這次點擊就是使用者互動，趁現在把 AudioContext 叫醒
    toast(state.enabled ? (sfxMuted() ? '馬達聲開啟（音效目前靜音）' : '馬達聲開啟') : '馬達聲關閉');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) state.voices?.silence();
  });
}
