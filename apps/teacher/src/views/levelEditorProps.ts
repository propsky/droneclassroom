// 關卡編輯器 — 右側檢視器參數面板（同步 / 套用 / 事件綁定）。
import type {
  AltitudeZone,
  BalloonDef,
  HeadingZone,
  LevelDef,
  ObstacleDef,
  PassZoneDef,
  PositionZone,
  RingDef,
  SimPhysicsDef,
} from '@creafly/shared';
import {
  DEFAULT_BALLOON_DIAMETER,
  DEFAULT_RING_BOB_AMP,
  DEFAULT_RING_COLOR,
  DEFAULT_RING_SPIN,
  DEFAULT_ZONE_MARKER_DIAMETER,
  DEFAULT_ZONE_TRIGGER_RADIUS,
  OBSTACLE_PHYSICS_SOLID,
  PHYSICS_DEFAULTS,
  balloonDiameter,
  compactPhysics,
  obstacleDefaultColor,
  parseLevelColor,
  ringBobAmp,
  ringDiameter,
  ringSpin,
  ringThickness,
  snapClampXZ,
  zoneMarkerDiameter,
  zoneTriggerRadius,
} from '@creafly/shared';

export type ObjKind = 'ring' | 'obstacle' | 'balloon' | 'zone';

export interface EditorSelection {
  kind: ObjKind;
  index: number;
}

export interface PropsController {
  sync(): void;
  apply(): void;
  bind(): void;
}

export interface PropsHost {
  root: HTMLElement;
  getLevel: () => LevelDef;
  setLevel: (level: LevelDef) => void;
  getSelection: () => EditorSelection | null;
  setSelection: (sel: EditorSelection | null) => void;
  getSnapStep: () => number;
  syncPyControls: (y: number) => void;
  redraw: () => void;
  scheduleSave: () => void;
  isSyncing: () => boolean;
  setSyncing: (v: boolean) => void;
}

const KIND_LABEL: Record<ObjKind, string> = {
  ring: '穿圈',
  obstacle: '障礙',
  balloon: '氣球',
  zone: '任務點',
};

function q<T extends HTMLElement>(root: HTMLElement, sel: string): T {
  return root.querySelector<T>(sel)!;
}

function physicsDefaultsFor(kind: ObjKind, solid = false): SimPhysicsDef {
  if (kind === 'obstacle' && solid) return { ...OBSTACLE_PHYSICS_SOLID };
  return { ...PHYSICS_DEFAULTS };
}

function syncColorInputs(root: HTMLElement, color: string): void {
  q<HTMLInputElement>(root, '#le-color').value = color;
  q<HTMLInputElement>(root, '#le-color-hex').value = color;
}

function readColor(root: HTMLElement): string {
  const hex = q<HTMLInputElement>(root, '#le-color-hex').value.trim();
  return parseLevelColor(hex || q<HTMLInputElement>(root, '#le-color').value, DEFAULT_RING_COLOR);
}

function syncPhysicsInputs(root: HTMLElement, physics: SimPhysicsDef | undefined, kind: ObjKind, solid: boolean): void {
  const defs = physicsDefaultsFor(kind, solid);
  const p = { ...defs, ...physics };
  q<HTMLInputElement>(root, '#le-phys-collidable').checked = p.collidable ?? false;
  q<HTMLInputElement>(root, '#le-phys-mass').value = p.massKg != null ? String(p.massKg) : '';
  q<HTMLInputElement>(root, '#le-phys-restitution').value = String(p.restitution ?? defs.restitution ?? 0.05);
  q<HTMLInputElement>(root, '#le-phys-friction').value = String(p.friction ?? defs.friction ?? 0.55);
  q<HTMLInputElement>(root, '#le-phys-gravity').checked = !!p.gravity;
  q<HTMLElement>(root, '#le-phys-rest-readout').textContent = ` ${Number(q<HTMLInputElement>(root, '#le-phys-restitution').value).toFixed(2)}`;
  q<HTMLElement>(root, '#le-phys-fric-readout').textContent = ` ${Number(q<HTMLInputElement>(root, '#le-phys-friction').value).toFixed(2)}`;
}

function readPhysics(root: HTMLElement, kind: ObjKind, solid: boolean): SimPhysicsDef | undefined {
  const defs = physicsDefaultsFor(kind, solid);
  const massRaw = q<HTMLInputElement>(root, '#le-phys-mass').value.trim();
  const raw: SimPhysicsDef = {
    collidable: q<HTMLInputElement>(root, '#le-phys-collidable').checked,
    massKg: massRaw === '' ? undefined : Number(massRaw),
    restitution: Number(q<HTMLInputElement>(root, '#le-phys-restitution').value),
    friction: Number(q<HTMLInputElement>(root, '#le-phys-friction').value),
    gravity: q<HTMLInputElement>(root, '#le-phys-gravity').checked,
  };
  return compactPhysics(raw, defs);
}

function setSection(root: HTMLElement, id: string, show: boolean): void {
  q<HTMLElement>(root, id).hidden = !show;
}

export function propsPanelHtml(): string {
  return `
            <div class="lvl-props" id="le-props" hidden>
              <h3 class="lvl-props-title" id="le-props-title">選取物件</h3>

              <section class="le-props-section" id="le-sec-transform">
                <h4 class="le-props-section-title">位置</h4>
                <div class="lvl-props-grid">
                  <div class="field"><label class="field-label" for="le-px">X（左右）</label><input id="le-px" type="number" step="0.5" class="mono"></div>
                  <div class="field"><label class="field-label" for="le-pz">Z（前後）</label><input id="le-pz" type="number" step="0.5" class="mono"></div>
                </div>
                <div class="field" id="le-py-wrap">
                  <label class="field-label" for="le-py">Y（高度）<span id="le-py-readout" class="mono le-py-readout"></span></label>
                  <input id="le-py-range" type="range" min="0" max="8" step="0.5" class="le-height-range" aria-label="高度滑桿">
                  <input id="le-py" type="number" step="0.5" min="0" max="8" class="mono">
                  <div class="le-height-presets" id="le-height-presets">
                    <button type="button" class="btn btn-ghost btn-xs" data-y="0.5">地面</button>
                    <button type="button" class="btn btn-ghost btn-xs" data-y="1.5">低空</button>
                    <button type="button" class="btn btn-ghost btn-xs" data-y="2">穿圈</button>
                    <button type="button" class="btn btn-ghost btn-xs" data-y="3.5">中高</button>
                    <button type="button" class="btn btn-ghost btn-xs" data-y="5">高空</button>
                  </div>
                  <p class="note">PgUp / PgDn 微調高度</p>
                </div>
              </section>

              <section class="le-props-section" id="le-sec-appearance" hidden>
                <h4 class="le-props-section-title">外觀</h4>
                <div class="field" id="le-label-wrap">
                  <label class="field-label" for="le-label">標籤</label>
                  <input id="le-label" type="text" maxlength="40">
                </div>
                <div class="field" id="le-color-wrap">
                  <label class="field-label" for="le-color">顏色</label>
                  <div class="le-color-row">
                    <input id="le-color" type="color" value="#38bdf8">
                    <input id="le-color-hex" type="text" class="mono" maxlength="7" placeholder="#38bdf8">
                  </div>
                </div>
              </section>

              <section class="le-props-section" id="le-sec-size" hidden>
                <h4 class="le-props-section-title">尺寸</h4>
                <div class="field" id="le-ring-diam-wrap" hidden>
                  <label class="field-label" for="le-ring-diam">圈徑（m）<span id="le-ring-diam-readout" class="mono le-py-readout"></span></label>
                  <input id="le-ring-diam" type="range" min="2" max="5" step="0.5" class="le-height-range">
                  <div class="le-height-presets" id="le-ring-diam-presets">
                    <button type="button" class="btn btn-ghost btn-xs" data-diam="2">小</button>
                    <button type="button" class="btn btn-ghost btn-xs" data-diam="3">標準</button>
                    <button type="button" class="btn btn-ghost btn-xs" data-diam="4">大</button>
                  </div>
                </div>
                <div class="field" id="le-ring-thick-wrap" hidden>
                  <label class="field-label" for="le-ring-thick">管粗（m）<span id="le-ring-thick-readout" class="mono le-py-readout"></span></label>
                  <input id="le-ring-thick" type="range" min="0.12" max="0.48" step="0.04" class="le-height-range">
                </div>
                <div class="field" id="le-size-wrap" hidden>
                  <label class="field-label" for="le-size">邊長（m）</label>
                  <input id="le-size" type="number" step="0.5" min="0.5" max="6" class="mono">
                </div>
                <div class="field" id="le-balloon-diam-wrap" hidden>
                  <label class="field-label" for="le-balloon-diam">球徑（m）<span id="le-balloon-diam-readout" class="mono le-py-readout"></span></label>
                  <input id="le-balloon-diam" type="range" min="0.8" max="2.4" step="0.2" class="le-height-range">
                </div>
                <div class="field" id="le-zone-marker-wrap" hidden>
                  <label class="field-label" for="le-zone-marker">地面標記圈（m）</label>
                  <input id="le-zone-marker" type="number" step="0.2" min="0.8" max="4" class="mono">
                </div>
                <div class="field" id="le-zone-trigger-wrap" hidden>
                  <label class="field-label" for="le-zone-trigger">觸發半徑（m）</label>
                  <input id="le-zone-trigger" type="number" step="0.2" min="0.5" max="4" class="mono">
                </div>
              </section>

              <section class="le-props-section" id="le-sec-gameplay" hidden>
                <h4 class="le-props-section-title">遊戲邏輯</h4>
                <div class="field" id="le-solid-wrap" hidden>
                  <label class="check-row"><input type="checkbox" id="le-solid">實心碰撞（會擋住無人機）</label>
                </div>
                <div class="field" id="le-face-wrap" hidden>
                  <label class="field-label" for="le-face-yaw">機頭朝向 yaw（度，空=不限）</label>
                  <input id="le-face-yaw" type="number" step="15" min="-180" max="180" class="mono" placeholder="不限">
                  <label class="field-label" for="le-face-tol">朝向容差（度）</label>
                  <input id="le-face-tol" type="number" step="5" min="5" max="90" value="35" class="mono">
                </div>
                <div id="le-zone-wrap" hidden>
                  <div class="field">
                    <label class="field-label" for="le-zone-type">任務類型</label>
                    <select id="le-zone-type" class="field-input">
                      <option value="position">位置區域</option>
                      <option value="altitude">高度</option>
                      <option value="heading">朝向</option>
                    </select>
                  </div>
                  <div class="lvl-props-grid" id="le-zone-position">
                    <div class="field"><label class="field-label" for="le-zone-minx">minX</label><input id="le-zone-minx" type="number" step="0.5" class="mono"></div>
                    <div class="field"><label class="field-label" for="le-zone-maxx">maxX</label><input id="le-zone-maxx" type="number" step="0.5" class="mono"></div>
                    <div class="field"><label class="field-label" for="le-zone-minz">minZ</label><input id="le-zone-minz" type="number" step="0.5" class="mono"></div>
                    <div class="field"><label class="field-label" for="le-zone-maxz">maxZ</label><input id="le-zone-maxz" type="number" step="0.5" class="mono"></div>
                    <div class="field"><label class="field-label" for="le-zone-pos-miny">minY</label><input id="le-zone-pos-miny" type="number" step="0.5" min="0" class="mono"></div>
                    <div class="field"><label class="field-label" for="le-zone-pos-maxy">maxY</label><input id="le-zone-pos-maxy" type="number" step="0.5" min="0" class="mono"></div>
                  </div>
                  <div class="lvl-props-grid" id="le-zone-altitude" hidden>
                    <div class="field"><label class="field-label" for="le-zone-miny">minY</label><input id="le-zone-miny" type="number" step="0.5" min="0" class="mono"></div>
                    <div class="field"><label class="field-label" for="le-zone-maxy">maxY</label><input id="le-zone-maxy" type="number" step="0.5" min="0" class="mono"></div>
                  </div>
                  <div class="lvl-props-grid" id="le-zone-heading" hidden>
                    <div class="field"><label class="field-label" for="le-zone-yaw">目標 yaw</label><input id="le-zone-yaw" type="number" step="15" class="mono"></div>
                    <div class="field"><label class="field-label" for="le-zone-tol">容差</label><input id="le-zone-tol" type="number" step="5" min="5" class="mono"></div>
                  </div>
                </div>
              </section>

              <section class="le-props-section" id="le-sec-motion" hidden>
                <h4 class="le-props-section-title">動態</h4>
                <div class="field" id="le-ring-spin-wrap" hidden>
                  <label class="field-label" for="le-ring-spin">自轉速度</label>
                  <input id="le-ring-spin" type="number" step="0.005" min="0" max="0.06" class="mono">
                </div>
                <div class="field" id="le-ring-bob-wrap" hidden>
                  <label class="field-label" for="le-ring-bob">漂浮幅度（m）<span id="le-ring-bob-readout" class="mono le-py-readout"></span></label>
                  <input id="le-ring-bob" type="range" min="0" max="0.5" step="0.05" class="le-height-range">
                  <p class="note">0 = 關閉上下漂浮</p>
                </div>
              </section>

              <section class="le-props-section" id="le-sec-physics" hidden>
                <h4 class="le-props-section-title">物理屬性</h4>
                <p class="note le-physics-hint">預留 Havok 實體化；目前模擬器主要使用「碰撞」。</p>
                <div class="field">
                  <label class="check-row"><input type="checkbox" id="le-phys-collidable">參與碰撞</label>
                </div>
                <div class="field">
                  <label class="field-label" for="le-phys-mass">質量（kg，空=靜態）</label>
                  <input id="le-phys-mass" type="number" step="0.1" min="0" class="mono" placeholder="靜態">
                </div>
                <div class="field">
                  <label class="field-label" for="le-phys-restitution">恢復係數<span id="le-phys-rest-readout" class="mono le-py-readout"></span></label>
                  <input id="le-phys-restitution" type="range" min="0" max="1" step="0.05" class="le-height-range">
                </div>
                <div class="field">
                  <label class="field-label" for="le-phys-friction">摩擦係數<span id="le-phys-fric-readout" class="mono le-py-readout"></span></label>
                  <input id="le-phys-friction" type="range" min="0" max="1" step="0.05" class="le-height-range">
                </div>
                <label class="check-row"><input type="checkbox" id="le-phys-gravity">受重力影響</label>
              </section>

              <button type="button" class="btn btn-ghost btn-sm" id="le-del-sel">刪除選取</button>
            </div>`;
}

export function createPropsController(host: PropsHost): PropsController {
  const { root } = host;

  const sync = (): void => {
    const selection = host.getSelection();
    const propsPanel = q<HTMLElement>(root, '#le-props');
    const inspectorIdle = q<HTMLElement>(root, '#le-inspector-idle');
    const hasSel = !!selection;
    propsPanel.hidden = !hasSel;
    inspectorIdle.hidden = hasSel;
    if (!selection) return;

    const level = host.getLevel();
    const { kind, index } = selection;
    q<HTMLElement>(root, '#le-props-title').textContent = `${KIND_LABEL[kind]} #${index + 1}`;

    host.setSyncing(true);

    setSection(root, '#le-sec-transform', kind !== 'zone');
    setSection(root, '#le-sec-appearance', kind === 'ring' || kind === 'obstacle' || kind === 'balloon' || kind === 'zone');
    setSection(root, '#le-sec-size', true);
    setSection(root, '#le-sec-gameplay', true);
    setSection(root, '#le-sec-motion', kind === 'ring');
    setSection(root, '#le-sec-physics', kind !== 'zone');

    q<HTMLElement>(root, '#le-py-wrap').hidden = kind === 'zone';
    q<HTMLElement>(root, '#le-color-wrap').hidden = kind === 'zone';
    q<HTMLElement>(root, '#le-label-wrap').hidden = kind === 'obstacle';
    q<HTMLElement>(root, '#le-ring-diam-wrap').hidden = kind !== 'ring';
    q<HTMLElement>(root, '#le-ring-thick-wrap').hidden = kind !== 'ring';
    q<HTMLElement>(root, '#le-size-wrap').hidden = kind !== 'obstacle';
    q<HTMLElement>(root, '#le-balloon-diam-wrap').hidden = kind !== 'balloon';
    q<HTMLElement>(root, '#le-zone-marker-wrap').hidden = kind !== 'zone';
    q<HTMLElement>(root, '#le-zone-trigger-wrap').hidden = kind !== 'zone';
    q<HTMLElement>(root, '#le-solid-wrap').hidden = kind !== 'obstacle';
    q<HTMLElement>(root, '#le-face-wrap').hidden = kind !== 'ring';
    q<HTMLElement>(root, '#le-zone-wrap').hidden = kind !== 'zone';
    q<HTMLElement>(root, '#le-ring-spin-wrap').hidden = kind !== 'ring';
    q<HTMLElement>(root, '#le-ring-bob-wrap').hidden = kind !== 'ring';

    if (kind === 'ring') {
      const r = level.rings![index];
      if (!r) return host.setSelection(null);
      q<HTMLInputElement>(root, '#le-px').value = String(r.x);
      q<HTMLInputElement>(root, '#le-pz').value = String(r.z);
      host.syncPyControls(r.y);
      const diam = ringDiameter(r);
      const thick = ringThickness(r);
      q<HTMLInputElement>(root, '#le-ring-diam').value = String(diam);
      q<HTMLElement>(root, '#le-ring-diam-readout').textContent = ` ${diam.toFixed(1)} m`;
      q<HTMLInputElement>(root, '#le-ring-thick').value = String(thick);
      q<HTMLElement>(root, '#le-ring-thick-readout').textContent = ` ${thick.toFixed(2)} m`;
      q<HTMLInputElement>(root, '#le-ring-spin').value = String(ringSpin(r));
      const bob = ringBobAmp(r);
      q<HTMLInputElement>(root, '#le-ring-bob').value = String(bob);
      q<HTMLElement>(root, '#le-ring-bob-readout').textContent = ` ${bob.toFixed(2)} m`;
      syncColorInputs(root, parseLevelColor(r.color, DEFAULT_RING_COLOR));
      q<HTMLInputElement>(root, '#le-label').value = r.label ?? '';
      q<HTMLInputElement>(root, '#le-face-yaw').value = r.faceYaw != null ? String(r.faceYaw) : '';
      q<HTMLInputElement>(root, '#le-face-tol').value = String(r.faceTol ?? 35);
      syncPhysicsInputs(root, r.physics, 'ring', false);
    } else if (kind === 'obstacle') {
      const o = level.obstacles![index];
      if (!o) return host.setSelection(null);
      q<HTMLInputElement>(root, '#le-px').value = String(o.x);
      q<HTMLInputElement>(root, '#le-pz').value = String(o.z);
      host.syncPyControls(o.y);
      q<HTMLInputElement>(root, '#le-size').value = String(o.size ?? 1);
      const solid = !!o.solid;
      q<HTMLInputElement>(root, '#le-solid').checked = solid;
      syncColorInputs(root, parseLevelColor(o.color, obstacleDefaultColor(solid)));
      syncPhysicsInputs(root, o.physics, 'obstacle', solid);
    } else if (kind === 'balloon') {
      const b = level.balloons![index];
      if (!b) return host.setSelection(null);
      q<HTMLInputElement>(root, '#le-px').value = String(b.x);
      q<HTMLInputElement>(root, '#le-pz').value = String(b.z);
      host.syncPyControls(b.y);
      const diam = balloonDiameter(b);
      q<HTMLInputElement>(root, '#le-balloon-diam').value = String(diam);
      q<HTMLElement>(root, '#le-balloon-diam-readout').textContent = ` ${diam.toFixed(1)} m`;
      syncColorInputs(root, parseLevelColor(b.color, '#f472b6'));
      q<HTMLInputElement>(root, '#le-label').value = b.label ?? '';
      syncPhysicsInputs(root, b.physics, 'balloon', false);
    } else {
      const z = level.passZones![index];
      if (!z) return host.setSelection(null);
      q<HTMLInputElement>(root, '#le-px').value = String(z.x);
      q<HTMLInputElement>(root, '#le-pz').value = String(z.z);
      q<HTMLInputElement>(root, '#le-label').value = z.label;
      q<HTMLInputElement>(root, '#le-zone-marker').value = String(zoneMarkerDiameter(z));
      q<HTMLInputElement>(root, '#le-zone-trigger').value = String(zoneTriggerRadius(z));
      const ztype = z.type ?? 'position';
      q<HTMLSelectElement>(root, '#le-zone-type').value = ztype;
      q<HTMLElement>(root, '#le-zone-position').hidden = ztype !== 'position';
      q<HTMLElement>(root, '#le-zone-altitude').hidden = ztype !== 'altitude';
      q<HTMLElement>(root, '#le-zone-heading').hidden = ztype !== 'heading';
      q<HTMLElement>(root, '#le-zone-marker-wrap').hidden = ztype !== 'position';
      if (ztype === 'position') {
        const pz = z as PositionZone;
        q<HTMLInputElement>(root, '#le-zone-minx').value = String(pz.minX ?? z.x - 1);
        q<HTMLInputElement>(root, '#le-zone-maxx').value = String(pz.maxX ?? z.x + 1);
        q<HTMLInputElement>(root, '#le-zone-minz').value = String(pz.minZ ?? z.z - 1);
        q<HTMLInputElement>(root, '#le-zone-maxz').value = String(pz.maxZ ?? z.z + 1);
        q<HTMLInputElement>(root, '#le-zone-pos-miny').value = pz.minY != null ? String(pz.minY) : '';
        q<HTMLInputElement>(root, '#le-zone-pos-maxy').value = pz.maxY != null ? String(pz.maxY) : '';
      } else if (ztype === 'altitude') {
        const az = z as AltitudeZone;
        q<HTMLInputElement>(root, '#le-zone-miny').value = az.minY != null ? String(az.minY) : '';
        q<HTMLInputElement>(root, '#le-zone-maxy').value = az.maxY != null ? String(az.maxY) : '';
      } else if (ztype === 'heading') {
        const hz = z as HeadingZone;
        q<HTMLInputElement>(root, '#le-zone-yaw').value = String(hz.targetYaw ?? 0);
        q<HTMLInputElement>(root, '#le-zone-tol').value = String(hz.tolerance ?? 30);
      }
    }

    host.setSyncing(false);
  };

  const apply = (): void => {
    if (host.isSyncing()) return;
    const selection = host.getSelection();
    if (!selection) return;
    const snapStep = host.getSnapStep();
    const level = host.getLevel();
    const x = snapClampXZ(Number(q<HTMLInputElement>(root, '#le-px').value) || 0, 0, snapStep).x;
    const z = snapClampXZ(0, Number(q<HTMLInputElement>(root, '#le-pz').value) || 0, snapStep).z;
    const y = Number(q<HTMLInputElement>(root, '#le-py').value) || 2;
    const color = readColor(root);

    if (selection.kind === 'ring') {
      const rings = [...(level.rings ?? [])];
      const r = rings[selection.index];
      if (!r) return;
      const faceRaw = q<HTMLInputElement>(root, '#le-face-yaw').value.trim();
      const faceYaw = faceRaw === '' ? undefined : Number(faceRaw);
      const faceTol = Number(q<HTMLInputElement>(root, '#le-face-tol').value) || 35;
      const diam = Number(q<HTMLInputElement>(root, '#le-ring-diam').value) || ringDiameter(r);
      const thick = Number(q<HTMLInputElement>(root, '#le-ring-thick').value) || ringThickness(r);
      const spin = Number(q<HTMLInputElement>(root, '#le-ring-spin').value);
      const bobAmp = Number(q<HTMLInputElement>(root, '#le-ring-bob').value);
      const next: RingDef = {
        ...r,
        x,
        z,
        y,
        color,
        label: q<HTMLInputElement>(root, '#le-label').value.trim() || r.label,
        diameter: diam === 3 ? undefined : diam,
        thickness: thick === 0.24 ? undefined : thick,
        spin: spin === DEFAULT_RING_SPIN ? undefined : spin,
        bobAmp: bobAmp === DEFAULT_RING_BOB_AMP ? undefined : bobAmp,
        faceYaw,
        faceTol: faceYaw != null ? faceTol : undefined,
        physics: readPhysics(root, 'ring', false),
      };
      rings[selection.index] = next;
      host.setLevel({ ...level, rings });
    } else if (selection.kind === 'obstacle') {
      const obs = [...(level.obstacles ?? [])];
      const o = obs[selection.index];
      if (!o) return;
      const solid = q<HTMLInputElement>(root, '#le-solid').checked;
      const physics = readPhysics(root, 'obstacle', solid);
      const next: ObstacleDef = {
        ...o,
        x,
        z,
        y,
        size: Number(q<HTMLInputElement>(root, '#le-size').value) || 1,
        solid,
        type: solid ? 'cube' : 'soft-cube',
        color,
        physics: physics ?? (solid ? { collidable: true } : undefined),
      };
      obs[selection.index] = next;
      host.setLevel({ ...level, obstacles: obs });
    } else if (selection.kind === 'balloon') {
      const balloons = [...(level.balloons ?? [])];
      const b = balloons[selection.index];
      if (!b) return;
      const diam = Number(q<HTMLInputElement>(root, '#le-balloon-diam').value) || DEFAULT_BALLOON_DIAMETER;
      const label = q<HTMLInputElement>(root, '#le-label').value.trim();
      const next: BalloonDef = {
        ...b,
        x,
        z,
        y,
        color,
        diameter: diam === DEFAULT_BALLOON_DIAMETER ? undefined : diam,
        label: label || undefined,
        physics: readPhysics(root, 'balloon', false),
      };
      balloons[selection.index] = next;
      host.setLevel({ ...level, balloons });
    } else {
      const zones = [...(level.passZones ?? [])];
      const zn = zones[selection.index];
      if (!zn) return;
      const ztype = q<HTMLSelectElement>(root, '#le-zone-type').value as PassZoneDef['type'];
      const label = q<HTMLInputElement>(root, '#le-label').value.trim() || zn.label;
      const markerD = Number(q<HTMLInputElement>(root, '#le-zone-marker').value);
      const triggerR = Number(q<HTMLInputElement>(root, '#le-zone-trigger').value);
      const markerDiameter =
        markerD === DEFAULT_ZONE_MARKER_DIAMETER ? undefined : markerD;
      const triggerRadius =
        triggerR === DEFAULT_ZONE_TRIGGER_RADIUS ? undefined : triggerR;
      let next: PassZoneDef;
      if (ztype === 'altitude') {
        const minYRaw = q<HTMLInputElement>(root, '#le-zone-miny').value.trim();
        const maxYRaw = q<HTMLInputElement>(root, '#le-zone-maxy').value.trim();
        next = {
          type: 'altitude',
          x,
          z,
          label,
          triggerRadius,
          minY: minYRaw === '' ? undefined : Number(minYRaw),
          maxY: maxYRaw === '' ? undefined : Number(maxYRaw),
        };
      } else if (ztype === 'heading') {
        next = {
          type: 'heading',
          x,
          z,
          label,
          triggerRadius,
          targetYaw: Number(q<HTMLInputElement>(root, '#le-zone-yaw').value) || 0,
          tolerance: Number(q<HTMLInputElement>(root, '#le-zone-tol').value) || 30,
        };
      } else {
        const minYRaw = q<HTMLInputElement>(root, '#le-zone-pos-miny').value.trim();
        const maxYRaw = q<HTMLInputElement>(root, '#le-zone-pos-maxy').value.trim();
        next = {
          type: 'position',
          x,
          z,
          label,
          markerDiameter,
          minX: Number(q<HTMLInputElement>(root, '#le-zone-minx').value),
          maxX: Number(q<HTMLInputElement>(root, '#le-zone-maxx').value),
          minZ: Number(q<HTMLInputElement>(root, '#le-zone-minz').value),
          maxZ: Number(q<HTMLInputElement>(root, '#le-zone-maxz').value),
          minY: minYRaw === '' ? undefined : Number(minYRaw),
          maxY: maxYRaw === '' ? undefined : Number(maxYRaw),
        };
      }
      zones[selection.index] = next;
      host.setLevel({ ...level, passZones: zones });
    }
    host.redraw();
    host.scheduleSave();
  };

  const bind = (): void => {
    const inputs = [
      '#le-px', '#le-pz', '#le-py', '#le-py-range', '#le-size', '#le-label', '#le-solid',
      '#le-face-yaw', '#le-face-tol', '#le-ring-diam', '#le-ring-thick', '#le-ring-spin', '#le-ring-bob',
      '#le-balloon-diam', '#le-color', '#le-color-hex',
      '#le-zone-minx', '#le-zone-maxx', '#le-zone-minz', '#le-zone-maxz',
      '#le-zone-pos-miny', '#le-zone-pos-maxy',
      '#le-zone-miny', '#le-zone-maxy', '#le-zone-yaw', '#le-zone-tol',
      '#le-zone-marker', '#le-zone-trigger',
      '#le-phys-collidable', '#le-phys-mass', '#le-phys-restitution', '#le-phys-friction', '#le-phys-gravity',
    ];
    inputs.forEach((sel) => {
      const el = root.querySelector<HTMLElement>(sel);
      if (!el) return;
      el.addEventListener('input', () => apply());
      el.addEventListener('change', () => apply());
    });

    q<HTMLInputElement>(root, '#le-py-range').addEventListener('input', () => {
      q<HTMLInputElement>(root, '#le-py').value = q<HTMLInputElement>(root, '#le-py-range').value;
      apply();
    });

    q<HTMLInputElement>(root, '#le-color').addEventListener('input', () => {
      q<HTMLInputElement>(root, '#le-color-hex').value = q<HTMLInputElement>(root, '#le-color').value;
      apply();
    });
    q<HTMLInputElement>(root, '#le-color-hex').addEventListener('change', () => {
      const c = parseLevelColor(q<HTMLInputElement>(root, '#le-color-hex').value, DEFAULT_RING_COLOR);
      q<HTMLInputElement>(root, '#le-color').value = c;
      apply();
    });

    q<HTMLInputElement>(root, '#le-solid').addEventListener('change', () => {
      const solid = q<HTMLInputElement>(root, '#le-solid').checked;
      q<HTMLInputElement>(root, '#le-phys-collidable').checked = solid;
      syncColorInputs(root, obstacleDefaultColor(solid));
      apply();
    });

    q<HTMLInputElement>(root, '#le-ring-diam').addEventListener('input', () => {
      const diam = Number(q<HTMLInputElement>(root, '#le-ring-diam').value);
      q<HTMLElement>(root, '#le-ring-diam-readout').textContent = ` ${diam.toFixed(1)} m`;
      apply();
    });
    q<HTMLElement>(root, '#le-ring-diam-presets').querySelectorAll<HTMLButtonElement>('button[data-diam]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const diam = Number(btn.dataset['diam']);
        q<HTMLInputElement>(root, '#le-ring-diam').value = String(diam);
        q<HTMLElement>(root, '#le-ring-diam-readout').textContent = ` ${diam.toFixed(1)} m`;
        apply();
      });
    });

    q<HTMLInputElement>(root, '#le-ring-thick').addEventListener('input', () => {
      const t = Number(q<HTMLInputElement>(root, '#le-ring-thick').value);
      q<HTMLElement>(root, '#le-ring-thick-readout').textContent = ` ${t.toFixed(2)} m`;
      apply();
    });

    q<HTMLInputElement>(root, '#le-ring-bob').addEventListener('input', () => {
      const b = Number(q<HTMLInputElement>(root, '#le-ring-bob').value);
      q<HTMLElement>(root, '#le-ring-bob-readout').textContent = ` ${b.toFixed(2)} m`;
      apply();
    });

    q<HTMLInputElement>(root, '#le-balloon-diam').addEventListener('input', () => {
      const d = Number(q<HTMLInputElement>(root, '#le-balloon-diam').value);
      q<HTMLElement>(root, '#le-balloon-diam-readout').textContent = ` ${d.toFixed(1)} m`;
      apply();
    });

    q<HTMLInputElement>(root, '#le-phys-restitution').addEventListener('input', () => {
      q<HTMLElement>(root, '#le-phys-rest-readout').textContent =
        ` ${Number(q<HTMLInputElement>(root, '#le-phys-restitution').value).toFixed(2)}`;
      apply();
    });
    q<HTMLInputElement>(root, '#le-phys-friction').addEventListener('input', () => {
      q<HTMLElement>(root, '#le-phys-fric-readout').textContent =
        ` ${Number(q<HTMLInputElement>(root, '#le-phys-friction').value).toFixed(2)}`;
      apply();
    });

    q<HTMLElement>(root, '#le-height-presets').querySelectorAll<HTMLButtonElement>('button[data-y]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const yv = Number(btn.dataset['y']);
        if (!Number.isFinite(yv)) return;
        host.syncPyControls(yv);
        apply();
      });
    });

    q<HTMLSelectElement>(root, '#le-zone-type').addEventListener('change', () => {
      const ztype = q<HTMLSelectElement>(root, '#le-zone-type').value;
      q<HTMLElement>(root, '#le-zone-position').hidden = ztype !== 'position';
      q<HTMLElement>(root, '#le-zone-altitude').hidden = ztype !== 'altitude';
      q<HTMLElement>(root, '#le-zone-heading').hidden = ztype !== 'heading';
      q<HTMLElement>(root, '#le-zone-marker-wrap').hidden = ztype !== 'position';
      apply();
    });
  };

  return { sync, apply, bind };
}
