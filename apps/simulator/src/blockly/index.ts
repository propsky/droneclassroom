// Blockly 積木整合入口 — initBlockly()：
//   1. zh-Hant 語系 + 自訂積木註冊（blocks.ts）
//   2. 掛載到 #blockly-div（zelos renderer + Modern 主題，選項照 legacy injectBlockly）
//   3. 預載範例積木、預建變數 count / time
//   4. 註冊 window.__creaflyGetCode provider（overlays.ts 的 ▶ 執行按鈕會呼叫它取生成碼）
// cf_* API 本體在 src/core/program.ts；生成碼契約 = `await CREAFLY.xxx(...)`。
import * as Blockly from 'blockly';
import { javascriptGenerator } from 'blockly/javascript';
import * as ZhHant from 'blockly/msg/zh-hant';
import { bus } from '../core/events';
import { DRAW_HEIGHT_DEFAULT } from '../core/pen';
import { defineCreaFlyBlocks } from './blocks';
import { TOOLBOX_XML, STARTER_XML, drawStarterXml } from './toolbox';

declare global {
  interface Window {
    /** ▶ 執行按鈕的生成碼 provider（overlays.ts 讀取） */
    __creaflyGetCode?: () => string;
  }
}

let workspace: Blockly.WorkspaceSvg | null = null;

/** Modern 主題（npm 版 Blockly core 只內建 Classic/Zelos，照 @blockly/theme-modern 重建同名主題） */
function createModernTheme(): Blockly.Theme {
  return Blockly.Theme.defineTheme('creafly_modern', {
    name: 'creafly_modern',
    base: Blockly.Themes.Classic,
    blockStyles: {
      colour_blocks: { colourPrimary: '#a5745b', colourSecondary: '#dbc7bd', colourTertiary: '#845d49' },
      list_blocks: { colourPrimary: '#745ba5', colourSecondary: '#c7bddb', colourTertiary: '#5d4984' },
      logic_blocks: { colourPrimary: '#5b80a5', colourSecondary: '#bdccdb', colourTertiary: '#496684' },
      loop_blocks: { colourPrimary: '#5ba55b', colourSecondary: '#bddbbd', colourTertiary: '#498449' },
      math_blocks: { colourPrimary: '#5b67a5', colourSecondary: '#bdc2db', colourTertiary: '#495284' },
      procedure_blocks: { colourPrimary: '#995ba5', colourSecondary: '#d6bddb', colourTertiary: '#7a4984' },
      text_blocks: { colourPrimary: '#5ba58c', colourSecondary: '#bddbd1', colourTertiary: '#498470' },
      variable_blocks: { colourPrimary: '#a55b99', colourSecondary: '#dbbdd6', colourTertiary: '#84497a' },
      variable_dynamic_blocks: { colourPrimary: '#a55b99', colourSecondary: '#dbbdd6', colourTertiary: '#84497a' },
      hat_blocks: { colourPrimary: '#a55b99', colourSecondary: '#dbbdd6', colourTertiary: '#84497a', hat: 'cap' },
    },
    categoryStyles: {
      colour_category: { colour: '#a5745b' },
      list_category: { colour: '#745ba5' },
      logic_category: { colour: '#5b80a5' },
      loop_category: { colour: '#5ba55b' },
      math_category: { colour: '#5b67a5' },
      procedure_category: { colour: '#995ba5' },
      text_category: { colour: '#5ba58c' },
      variable_category: { colour: '#a55b99' },
      variable_dynamic_category: { colour: '#a55b99' },
    },
  });
}

export function initBlockly(): void {
  if (workspace) return; // 防重複掛載

  // zh-Hant 語系（內建積木「重複 N 次」「如果」等會顯示中文）
  Blockly.setLocale(ZhHant as unknown as Record<string, string>);

  defineCreaFlyBlocks();

  const blocklyDiv = document.getElementById('blockly-div');
  if (!blocklyDiv) {
    console.warn('[blockly] 找不到 #blockly-div，略過掛載');
    return;
  }
  // 移除「建置中」占位文字
  document.getElementById('blockly-placeholder')?.remove();

  const options: Blockly.BlocklyOptions = {
    toolbox: TOOLBOX_XML,
    grid: { spacing: 20, length: 3, colour: '#ddd', snap: true },
    zoom: { controls: true, wheel: true, startScale: 0.85, maxScale: 2, minScale: 0.5 },
    trashcan: true,
    renderer: 'zelos',
    theme: createModernTheme(),
    media: 'blockly-media/', // 離線資源（public/blockly-media，不打 CDN）
  };

  // legacy B-101-001 對齊：inject 失敗時重試一次（重複註冊已在 blocks.ts 防護，通常第二次會成功）
  try {
    workspace = Blockly.inject(blocklyDiv, options);
  } catch (e) {
    console.warn('[blockly] inject 失敗，重試一次：', e instanceof Error ? e.message : e);
    workspace = Blockly.inject(blocklyDiv, options);
  }

  // 預載範例（起飛 → 前進 → 順時針 → 降落）
  const dom = Blockly.utils.xml.textToDom(STARTER_XML);
  Blockly.Xml.domToWorkspace(dom, workspace);

  // 預設變數 count（計數）、time（自訂時間）— 學生在「變數」分類直接可用
  if (!workspace.getVariable('count')) workspace.createVariable('count', '', 'count');
  if (!workspace.getVariable('time')) workspace.createVariable('time', '', 'time');

  // ▶ 執行按鈕的生成碼 provider（runProgram 會把碼包進 async IIFE 並注入 CREAFLY）
  window.__creaflyGetCode = () => javascriptGenerator.workspaceToCode(workspace!);

  // 畫畫教室 starter：draw 關載入時換成「起飛到 drawHeight + 下筆」鷹架（套 drawHeight）；
  // 從 draw 關回到一般關時還原預設範例。非 draw 關之間切換不動學生的積木。
  let lastWasDraw = false;
  bus.on('level-loaded', ({ level }) => {
    if (!workspace) return;
    const isDraw = !!level.draw;
    if (isDraw) {
      workspace.clear();
      const dom2 = Blockly.utils.xml.textToDom(drawStarterXml(level.drawHeight ?? DRAW_HEIGHT_DEFAULT));
      Blockly.Xml.domToWorkspace(dom2, workspace);
    } else if (lastWasDraw) {
      workspace.clear();
      const dom2 = Blockly.utils.xml.textToDom(STARTER_XML);
      Blockly.Xml.domToWorkspace(dom2, workspace);
    }
    lastWasDraw = isDraw;
  });

  // 面板在手動模式是 display:none，切到程式模式後要重算 Blockly 尺寸
  bus.on('mode-changed', ({ mode }) => {
    if (mode === 'program' && workspace) {
      requestAnimationFrame(() => Blockly.svgResize(workspace!));
    }
  });
  window.addEventListener('resize', () => {
    if (workspace) Blockly.svgResize(workspace);
  });

  console.log('[blockly] 積木編輯器就緒（zelos + zh-Hant）');
}
