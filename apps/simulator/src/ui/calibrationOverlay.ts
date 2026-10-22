// 通道對應表面板。狀態機在 input/channelMap.ts，這裡只畫表與接線。
import { bus, type CoreEventMap } from '../core/events';
import {
  startCalibration,
  endCalibration,
  setMapDetail,
  listenMapRow,
  toggleMapReverse,
  applyMapMode2,
  startMapGuide,
  clearMapArm,
  setMapDeadzone,
  beginMapEndpoints,
  finishMapEndpoints,
  type ChannelRowId,
} from '../input/calibration';
import { YawExpoPreference } from '../input/yawExpoPref';

type MapView = CoreEventMap['calib-map'];

const $ = (id: string): HTMLElement | null => document.getElementById(id);

function setText(id: string, text: string): void {
  const el = $(id);
  if (el) el.textContent = text;
}

let rowSig = '';

function renderRows(view: MapView): void {
  const host = $('map-table');
  if (!host) return;
  const sig = view.rows.map((row) => row.id).join(',');
  if (sig !== rowSig) {
    rowSig = sig;
    host.replaceChildren();
    let group = '';
    for (const row of view.rows) {
      if (row.group === 'switch' && group !== 'switch') {
        const caption = document.createElement('div');
        caption.className = 'map-caption';
        caption.textContent = '其他開關';
        host.appendChild(caption);
      }
      group = row.group;
      host.appendChild(buildRow(row.id));
    }
  }
  for (const row of view.rows) {
    const el = host.querySelector<HTMLElement>(`[data-row="${row.id}"]`);
    if (!el) continue;
    const device = el.querySelector('.map-device');
    const radio = el.querySelector<HTMLElement>('.map-radio');
    if (device) device.textContent = row.deviceLabel;
    if (radio) {
      radio.textContent = row.radioLabel;
      radio.hidden = !row.radioLabel;
    }
    const fill = el.querySelector<HTMLElement>('.map-fill');
    if (fill) fill.style.width = `${row.bar}%`;
    const raw = el.querySelector('.map-raw');
    if (raw) raw.textContent = row.rawText;
    const ends = el.querySelector('.map-ends-text');
    if (ends) ends.textContent = `中心 ${row.centerText}　行程 ${row.rangeText}`;
    el.classList.toggle('is-listening', row.listening);
    const assign = el.querySelector<HTMLButtonElement>('.map-assign');
    if (assign) assign.textContent = row.listening ? '在聽…' : '指定';
    const rev = el.querySelector<HTMLButtonElement>('.map-rev');
    if (rev) {
      rev.textContent = row.reversed ? '反向 開' : '反向';
      rev.classList.toggle('on', row.reversed);
      rev.setAttribute('aria-pressed', row.reversed ? 'true' : 'false');
    }
    const endBtn = el.querySelector<HTMLButtonElement>('.map-ends');
    if (endBtn) {
      endBtn.hidden = !row.canEndpoint && !row.endpointOn;
      endBtn.textContent = row.endpointOn ? '完成' : '量行程';
    }
    const clear = el.querySelector<HTMLButtonElement>('.map-clear');
    if (clear) clear.hidden = !row.optional;
  }
}

function buildRow(id: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'map-row';
  row.dataset.row = id;
  const name = document.createElement('span');
  name.className = 'map-name';
  name.textContent = labelOf(id);
  const source = document.createElement('span');
  source.className = 'map-source';
  const device = document.createElement('b');
  device.className = 'map-device';
  const radio = document.createElement('b');
  radio.className = 'map-radio';
  source.append(device, radio);
  const bar = document.createElement('span');
  bar.className = 'map-bar';
  const fill = document.createElement('i');
  fill.className = 'map-fill';
  bar.append(fill);
  const raw = document.createElement('span');
  raw.className = 'map-raw';
  const ends = document.createElement('span');
  ends.className = 'map-ends-text';
  const assign = document.createElement('button');
  assign.type = 'button';
  assign.className = 'map-assign';
  assign.textContent = '指定';
  assign.addEventListener('click', () => listenMapRow(id as ChannelRowId));
  const rev = document.createElement('button');
  rev.type = 'button';
  rev.className = 'map-rev';
  rev.textContent = '反向';
  rev.addEventListener('click', () => toggleMapReverse(id as ChannelRowId));
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'map-clear';
  clear.textContent = '清除';
  clear.hidden = true;
  clear.addEventListener('click', () => clearMapArm());
  const endBtn = document.createElement('button');
  endBtn.type = 'button';
  endBtn.className = 'map-ends';
  endBtn.textContent = '量行程';
  endBtn.hidden = true;
  endBtn.addEventListener('click', () => {
    const on = endBtn.textContent === '完成';
    if (on) finishMapEndpoints();
    else beginMapEndpoints(id as ChannelRowId);
  });
  row.append(name, source, bar, raw, ends, assign, rev, endBtn, clear);
  return row;
}

function labelOf(id: string): string {
  const names: Record<string, string> = {
    throttle: '油門',
    yaw: '偏航',
    pitch: '俯仰',
    roll: '橫滾',
    arm: '解鎖',
    takeoff: '起飛',
    land: '降落',
    reset: '重置',
  };
  return names[id] ?? id;
}

function renderRaw(view: MapView): void {
  const host = $('map-raw');
  if (!host) return;
  host.replaceChildren();
  if (view.rawAxes.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = '這條連線沒有回報任何軸。';
    host.appendChild(empty);
    return;
  }
  for (const axis of view.rawAxes) {
    const line = document.createElement('div');
    const raw = Number.isFinite(axis.raw) ? axis.raw.toFixed(2) : '—';
    const sign = axis.delta > 0 || Object.is(axis.delta, 0) ? '+' : '';
    line.textContent = `${axis.deviceLabel}　${axis.radioLabel}　${raw}　差 ${sign}${axis.delta.toFixed(2)}`;
    host.appendChild(line);
  }
}

function render(view: MapView): void {
  const card = document.querySelector('#calib-overlay .calib-card');
  card?.classList.toggle('is-pro', view.detail === 'pro');
  $('map-simple')?.classList.toggle('on', view.detail === 'simple');
  $('map-pro')?.classList.toggle('on', view.detail === 'pro');
  setText('map-status', view.status);
  const missing = $('map-missing');
  if (missing) {
    missing.hidden = !view.missingAxesNote;
    missing.textContent = view.missingAxesNote ?? '';
  }
  setText('map-hat', view.hatNote);
  renderRows(view);
  if (view.detail === 'pro') renderRaw(view);
  const dz = $('map-dz') as HTMLInputElement | null;
  if (dz && document.activeElement !== dz) dz.value = String(view.deadzone);
  setText('map-dz-val', view.deadzone.toFixed(2));
  const expo = $('map-expo') as HTMLInputElement | null;
  if (expo && document.activeElement !== expo) expo.value = String(view.expo);
  setText('map-expo-val', YawExpoPreference.label(view.expo));
}

export function initCalibrationOverlay(): void {
  bus.on('calib-show', ({ show }) => {
    $('calib-overlay')?.classList.toggle('show', show);
    if (show) rowSig = '';
  });
  bus.on('calib-map', (view) => render(view));

  $('map-simple')?.addEventListener('click', () => setMapDetail('simple'));
  $('map-pro')?.addEventListener('click', () => setMapDetail('pro'));
  $('map-mode2')?.addEventListener('click', () => applyMapMode2());
  $('map-guide')?.addEventListener('click', () => startMapGuide());
  $('calib-cancel')?.addEventListener('click', () => endCalibration(false));
  $('calib-save')?.addEventListener('click', () => endCalibration(true));
  $('map-dz')?.addEventListener('input', (event) => {
    const value = parseFloat((event.target as HTMLInputElement).value);
    setMapDeadzone(value);
  });
  $('map-expo')?.addEventListener('input', (event) => {
    const value = parseFloat((event.target as HTMLInputElement).value);
    YawExpoPreference.apply(value);
    YawExpoPreference.persist(YawExpoPreference.browserStore());
    setText('map-expo-val', YawExpoPreference.label(YawExpoPreference.get()));
  });

  if (new URLSearchParams(location.search).has('calib')) {
    setTimeout(() => startCalibration(), 1500);
  }
}
