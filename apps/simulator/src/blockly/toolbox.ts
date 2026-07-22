// Toolbox 定義 — 分類結構與顏色照 legacy injectBlockly() 的 XML。
// 「🖊️ 畫筆」分類與 legacy 相同為恆顯示（legacy toolbox 是靜態 XML、不依關卡切換）。
export const TOOLBOX_XML = `
<xml id="toolbox" style="display:none">
  <category name="🛫 動作" colour="160">
    <block type="cf_takeoff">
      <value name="HEIGHT">
        <block type="math_number"><field name="NUM">8</field></block>
      </value>
    </block>
    <block type="cf_land"></block>
    <block type="cf_hover">
      <value name="SEC">
        <block type="math_number"><field name="NUM">1</field></block>
      </value>
    </block>
  </category>
  <category name="🧭 移動" colour="210">
    <block type="cf_forward">
      <value name="DIST">
        <block type="math_number"><field name="NUM">2</field></block>
      </value>
    </block>
    <block type="cf_backward">
      <value name="DIST">
        <block type="math_number"><field name="NUM">2</field></block>
      </value>
    </block>
    <block type="cf_left">
      <value name="DIST">
        <block type="math_number"><field name="NUM">2</field></block>
      </value>
    </block>
    <block type="cf_right">
      <value name="DIST">
        <block type="math_number"><field name="NUM">2</field></block>
      </value>
    </block>
    <block type="cf_up">
      <value name="DIST">
        <block type="math_number"><field name="NUM">1</field></block>
      </value>
    </block>
    <block type="cf_down">
      <value name="DIST">
        <block type="math_number"><field name="NUM">1</field></block>
      </value>
    </block>
  </category>
  <category name="🔄 旋轉" colour="20">
    <block type="cf_rotate_cw">
      <value name="ANGLE">
        <block type="math_number"><field name="NUM">90</field></block>
      </value>
    </block>
    <block type="cf_rotate_ccw">
      <value name="ANGLE">
        <block type="math_number"><field name="NUM">90</field></block>
      </value>
    </block>
  </category>
  <category name="🖊️ 畫筆" colour="285">
    <block type="cf_pen_down"></block>
    <block type="cf_pen_up"></block>
    <block type="cf_pen_color"></block>
    <block type="cf_pen_random"></block>
  </category>
  <category name="📝 邏輯" colour="200">
    <block type="controls_if"></block>
    <block type="logic_compare"></block>
    <block type="logic_operation"></block>
    <block type="logic_negate"></block>
    <block type="logic_boolean"></block>
  </category>
  <category name="🔁 迴圈" colour="120">
    <block type="controls_repeat_ext">
      <value name="TIMES">
        <block type="math_number"><field name="NUM">3</field></block>
      </value>
    </block>
    <block type="controls_whileUntil"></block>
    <block type="cf_forever"></block>
  </category>
  <category name="📦 變數" custom="VARIABLE" colour="330">
    <block type="variables_set"></block>
    <block type="math_change">
      <value name="DELTA">
        <block type="math_number"><field name="NUM">1</field></block>
      </value>
    </block>
  </category>
  <category name="⏱ 時間" colour="290">
    <block type="cf_elapsed"></block>
    <block type="cf_wait">
      <value name="SEC">
        <block type="math_number"><field name="NUM">1</field></block>
      </value>
    </block>
    <block type="cf_every">
      <value name="SEC">
        <block type="math_number"><field name="NUM">1</field></block>
      </value>
    </block>
    <block type="cf_timer_reset"></block>
  </category>
  <category name="🔢 數字" colour="230">
    <block type="math_number"><field name="NUM">0</field></block>
    <block type="math_arithmetic"></block>
    <block type="cf_random">
      <value name="A">
        <block type="math_number"><field name="NUM">1</field></block>
      </value>
      <value name="B">
        <block type="math_number"><field name="NUM">10</field></block>
      </value>
    </block>
  </category>
</xml>`;

// 預載範例：起飛 8m → 前進 2m → 順時針 90° → 降落（legacy T-102 starter）
export const STARTER_XML = `
<xml xmlns="https://developers.google.com/blockly/xml">
  <block type="cf_takeoff" x="50" y="50">
    <value name="HEIGHT">
      <block type="math_number"><field name="NUM">8</field></block>
    </value>
    <next>
      <block type="cf_forward">
        <value name="DIST">
          <block type="math_number"><field name="NUM">2</field></block>
        </value>
        <next>
          <block type="cf_rotate_cw">
            <value name="ANGLE">
              <block type="math_number"><field name="NUM">90</field></block>
            </value>
            <next>
              <block type="cf_land"></block>
            </next>
          </block>
        </next>
      </block>
    </next>
  </block>
</xml>`;

/**
 * 畫畫教室 starter：起飛到繪圖高度 + 下筆（搭好鷹架，形狀（迴圈）留給學生自己拼）。
 * 對齊 legacy drawStarterXml(height)；height 由關卡 JSON 的 drawHeight 帶入。
 */
export function drawStarterXml(height: number): string {
  return `
<xml xmlns="https://developers.google.com/blockly/xml">
  <block type="cf_takeoff" x="50" y="50">
    <value name="HEIGHT">
      <block type="math_number"><field name="NUM">${height}</field></block>
    </value>
    <next><block type="cf_pen_down"></block></next>
  </block>
</xml>`;
}
