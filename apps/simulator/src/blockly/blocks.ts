// CREAFLY 自訂積木定義 + JS 生成器（對齊 legacy main.js §9 defineCreaFlyBlocks）。
// 範圍：動作 / 移動 / 旋轉 / 畫筆(cf_pen_*) / 迴圈(cf_forever) / 時間 / 數字(cf_random)。
//
// 生成碼契約：runProgram(code) 以 new Function('CREAFLY', ...) 注入 API 物件，
// 生成碼一律以 `await CREAFLY.xxx(...)` 形式呼叫（與 src/core/program.ts CREAFLY_API 對齊）。
import * as Blockly from 'blockly';
import { javascriptGenerator, Order } from 'blockly/javascript';

/** 取數值輸入的生成碼（空缺時用預設值 — 與 legacy num() 相同語意） */
function num(block: Blockly.Block, name: string, fallback: number): string {
  return javascriptGenerator.valueToCode(block, name, Order.ATOMIC) || String(fallback);
}

let defined = false;

export function defineCreaFlyBlocks(): void {
  // 防重註冊（HMR / 重複呼叫 initBlockly 時直接跳過 — legacy B-101-001 的 npm 版等價保護）
  if (defined || Blockly.Blocks['cf_takeoff']) {
    defined = true;
    return;
  }
  defined = true;

  // ========== 動作分類（顏色 160 青綠）==========
  // 起飛
  Blockly.Blocks['cf_takeoff'] = {
    init: function (this: Blockly.Block) {
      this.appendDummyInput().appendField('🛫 起飛 (高度)');
      this.appendValueInput('HEIGHT').setCheck('Number').appendField('到');
      this.appendDummyInput().appendField('m');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(160);
      this.setTooltip('垂直上升到指定高度（公尺），最少 1.5m');
    },
  };
  javascriptGenerator.forBlock['cf_takeoff'] = (block) =>
    `await CREAFLY.takeoff(${num(block, 'HEIGHT', 8)});\n`;

  // 降落
  Blockly.Blocks['cf_land'] = {
    init: function (this: Blockly.Block) {
      this.appendDummyInput().appendField('🛬 降落');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(160);
      this.setTooltip('緩降回起飛墊');
    },
  };
  javascriptGenerator.forBlock['cf_land'] = () => 'await CREAFLY.land();\n';

  // 懸停
  Blockly.Blocks['cf_hover'] = {
    init: function (this: Blockly.Block) {
      this.appendDummyInput().appendField('⏸ 懸停 (秒數)');
      this.appendValueInput('SEC').setCheck('Number').appendField('');
      this.appendDummyInput().appendField('秒');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(160);
      this.setTooltip('在原地懸停 N 秒（不移動、不旋轉）');
    },
  };
  javascriptGenerator.forBlock['cf_hover'] = (block) =>
    `await CREAFLY.hover(${num(block, 'SEC', 1)});\n`;

  // ========== 移動分類（顏色 210 藍）==========
  function makeMoveBlock(name: string, icon: string, label: string): void {
    Blockly.Blocks[name] = {
      init: function (this: Blockly.Block) {
        this.appendDummyInput().appendField(`${icon} ${label} (距離)`);
        this.appendValueInput('DIST').setCheck('Number').appendField('');
        this.appendDummyInput().appendField('m');
        this.setInputsInline(true);
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour(210);
        this.setTooltip(`沿當前機頭方向${label}指定距離（公尺）`);
      },
    };
  }
  makeMoveBlock('cf_forward', '⬆', '前進');
  makeMoveBlock('cf_backward', '⬇', '後退');
  makeMoveBlock('cf_left', '⬅', '左移');
  makeMoveBlock('cf_right', '➡', '右移');
  makeMoveBlock('cf_up', '🔼', '上升'); // 3D：垂直爬升
  makeMoveBlock('cf_down', '🔽', '下降'); // 3D：垂直下降

  javascriptGenerator.forBlock['cf_forward'] = (b) => `await CREAFLY.forward(${num(b, 'DIST', 2)});\n`;
  javascriptGenerator.forBlock['cf_backward'] = (b) => `await CREAFLY.backward(${num(b, 'DIST', 2)});\n`;
  javascriptGenerator.forBlock['cf_left'] = (b) => `await CREAFLY.left(${num(b, 'DIST', 2)});\n`;
  javascriptGenerator.forBlock['cf_right'] = (b) => `await CREAFLY.right(${num(b, 'DIST', 2)});\n`;
  javascriptGenerator.forBlock['cf_up'] = (b) => `await CREAFLY.up(${num(b, 'DIST', 1)});\n`;
  javascriptGenerator.forBlock['cf_down'] = (b) => `await CREAFLY.down(${num(b, 'DIST', 1)});\n`;

  // ========== 旋轉分類（顏色 20 橘）==========
  function makeRotateBlock(name: string, icon: string, label: string): void {
    Blockly.Blocks[name] = {
      init: function (this: Blockly.Block) {
        this.appendDummyInput().appendField(`${icon} ${label} (角度)`);
        this.appendValueInput('ANGLE').setCheck('Number').appendField('');
        this.appendDummyInput().appendField('°');
        this.setInputsInline(true);
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour(20);
        this.setTooltip(`${label}指定角度（從上方看）`);
      },
    };
  }
  makeRotateBlock('cf_rotate_cw', '↻', '順時針');
  makeRotateBlock('cf_rotate_ccw', '↺', '逆時針');

  javascriptGenerator.forBlock['cf_rotate_cw'] = (b) =>
    `await CREAFLY.rotateClockwise(${num(b, 'ANGLE', 90)});\n`;
  javascriptGenerator.forBlock['cf_rotate_ccw'] = (b) =>
    `await CREAFLY.rotateCounterClockwise(${num(b, 'ANGLE', 90)});\n`;

  // ========== 畫筆分類（顏色 285 紫，畫畫教室用 — 對齊 legacy L2328–2374）==========
  Blockly.Blocks['cf_pen_down'] = {
    init: function (this: Blockly.Block) {
      this.appendDummyInput().appendField('🖊️ 下筆（開始畫）');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(285);
      this.setTooltip('放下畫筆，之後的移動會留下墨水線');
    },
  };
  Blockly.Blocks['cf_pen_up'] = {
    init: function (this: Blockly.Block) {
      this.appendDummyInput().appendField('✋ 抬筆（停止畫）');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(285);
      this.setTooltip('抬起畫筆，之後的移動不會留下線（可移到別處再下筆）');
    },
  };
  Blockly.Blocks['cf_pen_color'] = {
    init: function (this: Blockly.Block) {
      this.appendDummyInput()
        .appendField('🎨 換筆色')
        .appendField(
          new Blockly.FieldDropdown([
            ['紅', '#ff5252'],
            ['藍', '#42a5f5'],
            ['綠', '#66bb6a'],
            ['黃', '#ffd54f'],
            ['紫', '#ab47bc'],
            ['深藍', '#1565c0'],
          ]),
          'COLOR',
        );
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(285);
      this.setTooltip('換一個畫筆顏色，之後畫的線就是新顏色');
    },
  };
  Blockly.Blocks['cf_pen_random'] = {
    init: function (this: Blockly.Block) {
      this.appendDummyInput().appendField('🎲 隨機換筆色');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(285);
      this.setTooltip('隨機挑一個顏色 — 放進迴圈就能畫出彩色星星！');
    },
  };
  javascriptGenerator.forBlock['cf_pen_down'] = () => 'await CREAFLY.penDown();\n';
  javascriptGenerator.forBlock['cf_pen_up'] = () => 'await CREAFLY.penUp();\n';
  javascriptGenerator.forBlock['cf_pen_color'] = (b) =>
    `await CREAFLY.penColor('${b.getFieldValue('COLOR')}');\n`;
  javascriptGenerator.forBlock['cf_pen_random'] = () => 'await CREAFLY.penRandom();\n';

  // ========== 迴圈（內建 + 自訂 forever）==========
  // 內建：controls_repeat_ext（重複 N 次）、controls_whileUntil（當...時）
  // 自訂：cf_forever（無限迴圈 + 30s timeout，避免 dead loop 卡死）
  Blockly.Blocks['cf_forever'] = {
    init: function (this: Blockly.Block) {
      this.appendDummyInput().appendField('🔁 無限迴圈 (最長 30s)');
      this.appendStatementInput('DO').appendField('執行');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(120);
      this.setTooltip('無限重複執行內部動作，最多跑 30 秒自動停止（避免卡死）');
    },
  };
  javascriptGenerator.forBlock['cf_forever'] = (block) => {
    const body = javascriptGenerator.statementToCode(block, 'DO');
    // 每輪 ensureRunning（停止鍵可立即中斷）+ wait(0.02) 讓出事件圈 — 照 legacy 生成碼語意
    return `{
  const _foreverStart = CREAFLY.elapsed();
  while (CREAFLY.elapsed() - _foreverStart < 30) {
    CREAFLY.ensureRunning();
${body}
    await CREAFLY.wait(0.02);
  }
}\n`;
  };

  // ========== 時間型計時（顏色 290 · 自訂 4 個，取代距離感測 per ADR-001）==========
  Blockly.Blocks['cf_elapsed'] = {
    init: function (this: Blockly.Block) {
      this.appendDummyInput().appendField('⏱ 經過秒數');
      this.setOutput(true, 'Number');
      this.setColour(290);
      this.setTooltip('從程式開始到現在經過的秒數（float）。例如：搭配 wait 計算 elapsed 差值 = 飛行時間');
    },
  };
  javascriptGenerator.forBlock['cf_elapsed'] = () => ['CREAFLY.elapsed()', Order.FUNCTION_CALL];

  Blockly.Blocks['cf_wait'] = {
    init: function (this: Blockly.Block) {
      this.appendDummyInput().appendField('⏸ 等待');
      this.appendValueInput('SEC').setCheck('Number').appendField('');
      this.appendDummyInput().appendField('秒');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(290);
      this.setTooltip('暫停 N 秒（drone 不動作但計時繼續走）');
    },
  };
  javascriptGenerator.forBlock['cf_wait'] = (b) => `await CREAFLY.wait(${num(b, 'SEC', 1)});\n`;

  Blockly.Blocks['cf_every'] = {
    init: function (this: Blockly.Block) {
      this.appendDummyInput().appendField('⏰ 每');
      this.appendValueInput('SEC').setCheck('Number').appendField('');
      this.appendDummyInput().appendField('秒執行');
      this.appendStatementInput('DO').appendField('');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(290);
      this.setTooltip('每 N 秒觸發一次內部動作（pseudo interrupt）。內部用 while + elapsed 檢查實作，30s timeout 保護。');
    },
  };
  javascriptGenerator.forBlock['cf_every'] = (block) => {
    const sec = javascriptGenerator.valueToCode(block, 'SEC', Order.ATOMIC) || '1';
    const body = javascriptGenerator.statementToCode(block, 'DO');
    return `{
  const _everyStart = CREAFLY.elapsed();
  let _everyLast = CREAFLY.elapsed();
  while (CREAFLY.elapsed() - _everyStart < 30) {
    CREAFLY.ensureRunning();
    if (CREAFLY.elapsed() - _everyLast >= ${sec}) {
      _everyLast = CREAFLY.elapsed();
${body}
    }
    await CREAFLY.wait(0.02);
  }
}\n`;
  };

  Blockly.Blocks['cf_timer_reset'] = {
    init: function (this: Blockly.Block) {
      this.appendDummyInput().appendField('⏱ 計時器重設');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(290);
      this.setTooltip('把 elapsed() 計時器歸零（從現在開始算）');
    },
  };
  javascriptGenerator.forBlock['cf_timer_reset'] = () => 'CREAFLY.timerReset();\n';

  // ========== 數字（顏色 230 · 隨機整數）==========
  Blockly.Blocks['cf_random'] = {
    init: function (this: Blockly.Block) {
      this.appendValueInput('A').setCheck('Number').appendField('🎲 隨機整數');
      this.appendValueInput('B').setCheck('Number').appendField('到');
      this.setInputsInline(true);
      this.setOutput(true, 'Number');
      this.setColour(230);
      this.setTooltip('在 A 到 B 之間隨機取一個整數（含 A、B 本身），例如 1 到 6 模擬骰子');
    },
  };
  javascriptGenerator.forBlock['cf_random'] = (block) => [
    `CREAFLY.random(${num(block, 'A', 1)}, ${num(block, 'B', 10)})`,
    Order.FUNCTION_CALL,
  ];
}
