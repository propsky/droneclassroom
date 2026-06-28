/* 老師專用教材資料（/lesson 投影教學頁用）。
 * 每關：任務、核心概念、教學重點、解答積木（含逐塊中文註解）、進階迴圈寫法提示。
 * cat：act=動作(綠) move=移動(藍) rot=旋轉(橘) loop=迴圈(紫)
 * 注意：這份只給老師看，學生端（index.html）不載入此檔。 */
window.LESSON_DATA = {
  passcode: 'creafly',   // 輕量通關碼（擋學生手賤點開；非真資安，改這裡即可）
  catColor: { act: '#46a883', move: '#5a8fc4', rot: '#cc7a47', loop: '#9b6dd0' },
  catName:  { act: '動作', move: '移動', rot: '旋轉', loop: '迴圈' },
  levels: [
    {
      id: '1-0', name: '搖桿熱身', order: 1,
      goal: '起飛 → 降落（最簡單的一支程式）',
      concept: '認識「程式由上往下、一行一個指令依序執行」。',
      teach: [
        '這是 Blockly 的「Hello World」：先讓學生看到「按執行 → 無人機真的動」。',
        '強調：積木由上往下一塊一塊跑，順序就是飛行順序。'
      ],
      blocks: [
        { icon: '🛫', label: '起飛到 1 公尺', cat: 'act', note: '程式第一步一定先離地。框裡的數字＝飛多高。' },
        { icon: '🛬', label: '降落', cat: 'act', note: '任務結束要降落，安全回到地面。' }
      ]
    },
    {
      id: '1-1', name: '垂直起降', order: 2,
      goal: '起飛 → 升到 3m → 降到 1m → 落地',
      concept: '高度控制與懸停。',
      teach: [
        '⚠️ 提醒：精準「3m→1m 下降」用現有積木較難表達，這關建議以「手動操作」為主、程式示範為輔。',
        '程式示範用「起飛到 3m → 懸停 → 降落」帶過高度概念即可。'
      ],
      blocks: [
        { icon: '🛫', label: '起飛到 3 公尺', cat: 'act', note: '直接飛到目標高度 3m。' },
        { icon: '⏸', label: '懸停 2 秒', cat: 'act', note: '停在空中 2 秒，穩住高度再動作。' },
        { icon: '🛬', label: '降落', cat: 'act' }
      ]
    },
    {
      id: '1-2', name: '水平移動', order: 3,
      goal: '保持 2m 高度：前進 → 後退 → 右移 → 左移',
      concept: '前後左右四方向移動，以及「序列」—— 指令的順序決定路徑。',
      teach: [
        '教「序列」：把積木順序對調，無人機路徑就不一樣，讓學生體會順序的重要。',
        '每個移動積木的數字＝移動幾公尺。'
      ],
      blocks: [
        { icon: '🛫', label: '起飛到 2 公尺', cat: 'act', note: '先到 2m，之後都在這個高度水平移動。' },
        { icon: '⬆', label: '前進 3 公尺', cat: 'move', note: '沿機頭方向往前。' },
        { icon: '⬇', label: '後退 3 公尺', cat: 'move', note: '退回原點。' },
        { icon: '➡', label: '右移 3 公尺', cat: 'move' },
        { icon: '⬅', label: '左移 3 公尺', cat: 'move', note: '回到原點。' },
        { icon: '🛬', label: '降落', cat: 'act' }
      ]
    },
    {
      id: '1-3', name: '旋轉', order: 4, star: true,
      goal: '往同方向轉一整圈（每 90° 過一關）',
      concept: '旋轉 + 重複 —— ⭐ 最佳「迴圈」入門關。',
      teach: [
        '先讓學生用「順時針轉 90°」貼 4 次完成（解答如右）。',
        '再問：「貼 4 次很麻煩，有沒有更聰明的方法？」→ 引出迴圈。',
        '這是全課程導入「重複迴圈」最自然的一關。'
      ],
      blocks: [
        { icon: '🛫', label: '起飛到 2 公尺', cat: 'act' },
        { icon: '↻', label: '順時針轉 90°', cat: 'rot', note: '轉 1/4 圈。' },
        { icon: '↻', label: '順時針轉 90°', cat: 'rot', note: '累計 180°（半圈）。' },
        { icon: '↻', label: '順時針轉 90°', cat: 'rot', note: '累計 270°。' },
        { icon: '↻', label: '順時針轉 90°', cat: 'rot', note: '累計 360°，回到正面。' },
        { icon: '🛬', label: '降落', cat: 'act' }
      ],
      loopTip: '同一塊「順時針轉 90°」貼了 4 次很囉嗦 → 改用「🔁 重複 4 次 ［順時針轉 90°］」一個迴圈就搞定。這就是迴圈的價值！'
    },
    {
      id: '1-4', name: '鑽第一個圈', order: 5, star: true,
      goal: '前進穿過 3 個紅圈 → 飛回原點降落',
      concept: '連續前進穿圈 + 返航；同樣可帶入迴圈。',
      teach: [
        '成就感最高的一關（穿圈很有感），適合鞏固「前進 + 序列」。',
        '前進 5 貼 3 次 → 也可改用「重複 3 次」，跟 1-3 呼應。'
      ],
      blocks: [
        { icon: '🛫', label: '起飛到 3 公尺', cat: 'act', note: '飛到跟圈一樣高，圈才會在正前方。' },
        { icon: '⬆', label: '前進 5 公尺', cat: 'move', note: '穿過紅圈 1。' },
        { icon: '⬆', label: '前進 5 公尺', cat: 'move', note: '穿過紅圈 2。' },
        { icon: '⬆', label: '前進 5 公尺', cat: 'move', note: '穿過紅圈 3。' },
        { icon: '⬇', label: '後退 15 公尺', cat: 'move', note: '一次退回原點（15 = 5×3）。' },
        { icon: '🛬', label: '降落', cat: 'act' }
      ],
      loopTip: '「前進 5」貼了 3 次 → 可用「🔁 重複 3 次 ［前進 5］」。回程後退 15 剛好＝ 3×5。'
    },
    {
      id: '1-5', name: '旋轉鑽圈（綜合）', order: 6,
      goal: '轉向對準紅圈穿過（3 個）→ 飛回原點降落',
      concept: '旋轉 + 移動的綜合運用，加上空間推理 —— 適合當總結驗收關。',
      teach: [
        '這關紅圈要「機頭對準」才算過：口訣是「先轉向、再前進」。',
        '較難，建議當總結關，驗收學生是否能組合前面學到的轉向＋移動。'
      ],
      blocks: [
        { icon: '🛫', label: '起飛到 3 公尺', cat: 'act' },
        { icon: '↻', label: '順時針轉 90°', cat: 'rot', note: '先把機頭轉去對準圈 1。' },
        { icon: '⬆', label: '前進 5 公尺', cat: 'move' },
        { icon: '⬆', label: '前進 5 公尺', cat: 'move', note: '穿過圈 1。' },
        { icon: '↻', label: '順時針轉 90°', cat: 'rot', note: '轉向對準圈 2。' },
        { icon: '⬆', label: '前進 5 公尺', cat: 'move', note: '穿過圈 2。' },
        { icon: '↻', label: '順時針轉 90°', cat: 'rot', note: '轉向對準圈 3。' },
        { icon: '⬆', label: '前進 5 公尺', cat: 'move', note: '穿過圈 3。' },
        { icon: '↻', label: '順時針轉 90°', cat: 'rot' },
        { icon: '⬇', label: '後退 5 公尺', cat: 'move', note: '飛回起飛墊附近。' },
        { icon: '🛬', label: '降落', cat: 'act' }
      ]
    }
  ]
};
