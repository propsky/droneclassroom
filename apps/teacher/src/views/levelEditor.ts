// 自訂關卡編輯器 — 表單 + 俯視 2D 圈點（拖曳 / 點擊新增）+ 自動儲存 + 預覽。
import type { LevelDef, ObstacleDef, RingDef } from '@creafly/shared';
import {
  LEVEL_KIT_CATEGORIES,
  applyLevelKitSnippet,
  getLevelKitSnippet,
  levelKitByCategory,
  type LevelKitSnippet,
} from '@creafly/shared';
import { ApiError, fetchTeacherLevel, patchTeacherLevel } from '../api';
import { ICONS } from '../icons';
import { openPreviewModal } from '../preview';
import { toast } from '../toast';

const WORLD = 30; // x,z ∈ [-15, 15]
const HALF = WORLD / 2;

export interface LevelEditorPanel {
  destroy(): void;
}

function errText(err: unknown, doing: string): string {
  if (err instanceof ApiError) {
    if (err.isNetwork) return '無法連到伺服器';
    if (err.status === 401) return '登入已過期';
    return `${doing}失敗（HTTP ${err.status}）`;
  }
  return `${doing}失敗`;
}

function defaultLevel(levelId: string, title: string): LevelDef {
  return {
    id: levelId,
    name: title,
    intro: '',
    hud: title,
    returnHome: true,
    rings: [],
    obstacles: [],
    passZones: [],
  };
}

function parseLevel(def: Record<string, unknown>, levelId: string, title: string): LevelDef {
  const raw = def as unknown as Partial<LevelDef>;
  const base = defaultLevel(levelId, title);
  return {
    ...base,
    ...raw,
    id: levelId,
    name: String(raw.name || title),
    rings: Array.isArray(raw.rings) ? [...raw.rings] : [],
    obstacles: Array.isArray(raw.obstacles) ? [...raw.obstacles] : [],
    passZones: Array.isArray(raw.passZones) ? [...raw.passZones] : [],
  };
}

export function openLevelEditor(levelPk: number, onSaved?: () => void): LevelEditorPanel {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal modal-xl lvl-editor-modal" role="dialog" aria-modal="true">
      <div class="modal-head">
        <div class="modal-head-text">
          <h2 class="modal-title" id="le-title">關卡編輯</h2>
          <p class="modal-desc" id="le-sub">載入中…</p>
        </div>
        <span class="lvl-save-hint" id="le-save-hint"></span>
        <button type="button" class="btn btn-ghost btn-sm" id="le-close">${ICONS.x}關閉</button>
      </div>
      <div class="lvl-editor-body">
        <div class="lvl-editor-form">
          <div class="field">
            <label class="field-label" for="le-name">關卡名稱</label>
            <input id="le-name" type="text" maxlength="200">
          </div>
          <div class="field">
            <label class="field-label" for="le-hud">HUD 提示</label>
            <input id="le-hud" type="text" maxlength="200">
          </div>
          <div class="field">
            <label class="field-label" for="le-intro">開場說明</label>
            <textarea id="le-intro" rows="4"></textarea>
          </div>
          <label class="check-row"><input type="checkbox" id="le-return">需返航降落才算過關</label>
          <div class="lvl-editor-tools">
            <button type="button" class="btn btn-ghost btn-sm" id="le-add-ring">${ICONS.plus}加圈（中央）</button>
            <button type="button" class="btn btn-ghost btn-sm" id="le-del-ring">刪除選取圈</button>
            <button type="button" class="btn btn-ghost btn-sm" id="le-add-obs">${ICONS.plus}加障礙</button>
          </div>
          <p class="note">俯視圖：點空白處加圈；拖曳移動。Shift+點擊加實心障礙。</p>
          <div class="lvl-kit">
            <h3 class="lvl-kit-title">素材庫</h3>
            <p class="note lvl-kit-hint">點選插入預設片段；任務步驟類會覆寫現有步驟。</p>
            <div id="le-kit-panels"></div>
          </div>
        </div>
        <div class="lvl-editor-canvas-wrap">
          <canvas id="le-canvas" width="400" height="400" aria-label="俯視編輯器"></canvas>
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="le-preview">${ICONS.play}預覽</button>
        <button type="button" class="btn btn-primary" id="le-save-now">${ICONS.check}立即儲存</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  const q = <T extends HTMLElement>(sel: string): T => backdrop.querySelector<T>(sel)!;
  const canvas = q<HTMLCanvasElement>('#le-canvas');
  const ctx = canvas.getContext('2d')!;
  const saveHint = q<HTMLElement>('#le-save-hint');

  let levelPkLocal = levelPk;
  let level: LevelDef = defaultLevel('', '');
  let selectedRing = -1;
  let dragRing = -1;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;

  const worldToCanvas = (x: number, z: number): [number, number] => {
    const w = canvas.width;
    const h = canvas.height;
    return [((x + HALF) / WORLD) * w, ((z + HALF) / WORLD) * h];
  };

  const canvasToWorld = (px: number, py: number): [number, number] => {
    const w = canvas.width;
    const h = canvas.height;
    const x = (px / w) * WORLD - HALF;
    const z = (py / h) * WORLD - HALF;
    return [Math.round(x * 10) / 10, Math.round(z * 10) / 10];
  };

  const draw = (): void => {
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#1a2332';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i <= 6; i++) {
      const t = (i / 6) * w;
      ctx.beginPath();
      ctx.moveTo(t, 0);
      ctx.lineTo(t, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, t);
      ctx.lineTo(w, t);
      ctx.stroke();
    }
    const [hx, hz] = worldToCanvas(0, 0);
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(hx, hz, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px sans-serif';
    ctx.fillText('起飛墊', hx + 10, hz + 4);

    for (const obs of level.obstacles ?? []) {
      const [ox, oz] = worldToCanvas(obs.x, obs.z);
      const r = ((obs.size ?? 1) / WORLD) * w * 0.5;
      ctx.fillStyle = obs.solid ? 'rgba(248,113,113,0.5)' : 'rgba(74,222,128,0.35)';
      ctx.fillRect(ox - r, oz - r, r * 2, r * 2);
    }

    for (const b of level.balloons ?? []) {
      const [bx, bz] = worldToCanvas(b.x, b.z);
      ctx.fillStyle = 'rgba(251,191,36,0.7)';
      ctx.beginPath();
      ctx.arc(bx, bz, 10, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const zone of level.passZones ?? []) {
      const [zx, zz] = worldToCanvas(zone.x, zone.z);
      ctx.strokeStyle = 'rgba(167,139,250,0.8)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(zx - 12, zz - 12, 24, 24);
      ctx.setLineDash([]);
    }

    (level.rings ?? []).forEach((ring, i) => {
      const [rx, rz] = worldToCanvas(ring.x, ring.z);
      ctx.strokeStyle = i === selectedRing ? '#60a5fa' : '#38bdf8';
      ctx.lineWidth = i === selectedRing ? 3 : 2;
      ctx.beginPath();
      ctx.arc(rx, rz, 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '10px sans-serif';
      ctx.fillText(String(i + 1), rx - 3, rz + 3);
    });
  };

  const syncFormFromLevel = (): void => {
    q<HTMLInputElement>('#le-name').value = level.name;
    q<HTMLInputElement>('#le-hud').value = level.hud ?? '';
    q<HTMLTextAreaElement>('#le-intro').value = level.intro ?? '';
    q<HTMLInputElement>('#le-return').checked = !!level.returnHome;
  };

  const syncLevelFromForm = (): void => {
    level.name = q<HTMLInputElement>('#le-name').value.trim() || level.name;
    level.hud = q<HTMLInputElement>('#le-hud').value.trim();
    level.intro = q<HTMLTextAreaElement>('#le-intro').value;
    level.returnHome = q<HTMLInputElement>('#le-return').checked;
  };

  const scheduleSave = (): void => {
    dirty = true;
    saveHint.textContent = '儲存中…';
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void flushSave(), 700);
  };

  const flushSave = async (): Promise<void> => {
    syncLevelFromForm();
    try {
      await patchTeacherLevel(levelPkLocal, {
        title: level.name,
        definition: level as unknown as Record<string, unknown>,
      });
      dirty = false;
      saveHint.textContent = '已儲存';
      onSaved?.();
    } catch (e) {
      saveHint.textContent = '儲存失敗';
      toast(errText(e, '儲存'), 'error');
    }
  };

  const hitRing = (px: number, py: number): number => {
    const rings = level.rings ?? [];
    for (let i = rings.length - 1; i >= 0; i--) {
      const ring = rings[i];
      if (!ring) continue;
      const [rx, rz] = worldToCanvas(ring.x, ring.z);
      const d = Math.hypot(px - rx, py - rz);
      if (d < 16) return i;
    }
    return -1;
  };

  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const py = ((e.clientY - rect.top) / rect.height) * canvas.height;
    const hit = hitRing(px, py);
    if (hit >= 0) {
      selectedRing = hit;
      dragRing = hit;
      draw();
      return;
    }
    const [wx, wz] = canvasToWorld(px, py);
    if (e.shiftKey) {
      const obs: ObstacleDef = {
        type: 'cube',
        solid: true,
        x: wx,
        y: 1.5,
        z: wz,
        size: 1,
        color: '#f87171',
      };
      level.obstacles = [...(level.obstacles ?? []), obs];
    } else {
      const ring: RingDef = { x: wx, y: 2, z: wz, label: `圈 ${(level.rings?.length ?? 0) + 1}` };
      level.rings = [...(level.rings ?? []), ring];
      selectedRing = level.rings.length - 1;
    }
    draw();
    scheduleSave();
  });

  canvas.addEventListener('mousemove', (e) => {
    if (dragRing < 0) return;
    const rect = canvas.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const py = ((e.clientY - rect.top) / rect.height) * canvas.height;
    const [wx, wz] = canvasToWorld(px, py);
    const rings = [...(level.rings ?? [])];
    const r = rings[dragRing];
    if (!r) return;
    rings[dragRing] = { ...r, x: wx, z: wz };
    level.rings = rings;
    draw();
  });

  const endDrag = (): void => {
    if (dragRing >= 0) {
      dragRing = -1;
      scheduleSave();
    }
  };
  canvas.addEventListener('mouseup', endDrag);
  canvas.addEventListener('mouseleave', endDrag);

  q<HTMLInputElement>('#le-name').addEventListener('input', scheduleSave);
  q<HTMLInputElement>('#le-hud').addEventListener('input', scheduleSave);
  q<HTMLTextAreaElement>('#le-intro').addEventListener('input', scheduleSave);
  q<HTMLInputElement>('#le-return').addEventListener('change', scheduleSave);

  q<HTMLButtonElement>('#le-add-ring').addEventListener('click', () => {
    level.rings = [...(level.rings ?? []), { x: 0, y: 2, z: -4, label: `圈 ${(level.rings?.length ?? 0) + 1}` }];
    selectedRing = level.rings.length - 1;
    draw();
    scheduleSave();
  });

  q<HTMLButtonElement>('#le-del-ring').addEventListener('click', () => {
    if (selectedRing < 0 || !level.rings?.length) return;
    level.rings = level.rings.filter((_, i) => i !== selectedRing);
    selectedRing = -1;
    draw();
    scheduleSave();
  });

  q<HTMLButtonElement>('#le-add-obs').addEventListener('click', () => {
    level.obstacles = [
      ...(level.obstacles ?? []),
      { type: 'cube', solid: true, x: 4, y: 1.5, z: 0, size: 1, color: '#f87171' },
    ];
    draw();
    scheduleSave();
  });

  const applySnippet = (snippet: LevelKitSnippet): void => {
    const mode = snippet.category === 'tasks' ? 'replace-tasks' : 'append';
    level = applyLevelKitSnippet(level, snippet, mode);
    syncFormFromLevel();
    draw();
    scheduleSave();
    toast(`已插入「${snippet.name}」`, 'success');
  };

  const kitHost = q<HTMLElement>('#le-kit-panels');
  kitHost.innerHTML = LEVEL_KIT_CATEGORIES
    .map((cat) => {
      const items = levelKitByCategory(cat.id);
      if (!items.length) return '';
      return `<details class="lvl-kit-group" open>
        <summary class="lvl-kit-summary">${cat.label}</summary>
        <div class="lvl-kit-grid">
          ${items
            .map(
              (s) =>
                `<button type="button" class="lvl-kit-card" data-kit="${s.id}" title="${s.desc}">
                  <span class="lvl-kit-card-name">${s.name}</span>
                  <span class="lvl-kit-card-desc">${s.desc}</span>
                </button>`,
            )
            .join('')}
        </div>
      </details>`;
    })
    .join('');

  kitHost.querySelectorAll<HTMLButtonElement>('[data-kit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const snippet = getLevelKitSnippet(btn.dataset['kit'] ?? '');
      if (snippet) applySnippet(snippet);
    });
  });

  q<HTMLButtonElement>('#le-preview').addEventListener('click', () => {
    syncLevelFromForm();
    void flushSave().then(() => openPreviewModal(level));
  });

  q<HTMLButtonElement>('#le-save-now').addEventListener('click', () => {
    void flushSave().then(() => toast('已儲存', 'success'));
  });

  const close = (): void => {
    if (dirty) void flushSave();
    backdrop.remove();
  };
  q<HTMLButtonElement>('#le-close').addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  void fetchTeacherLevel(levelPkLocal)
    .then((detail) => {
      levelPkLocal = detail.id;
      level = parseLevel(detail.definition, detail.levelId, detail.title);
      q<HTMLElement>('#le-title').textContent = `編輯 ${detail.levelId}`;
      q<HTMLElement>('#le-sub').textContent =
        detail.status === 'draft' ? '草稿會自動儲存' : '已發布 — 修改後學生端即時生效';
      syncFormFromLevel();
      draw();
    })
    .catch((e) => {
      toast(errText(e, '載入'), 'error');
      close();
    });

  return {
    destroy(): void {
      if (saveTimer) clearTimeout(saveTimer);
      backdrop.remove();
    },
  };
}
