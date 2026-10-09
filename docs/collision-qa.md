# 碰撞系統品質驗證（G-01）

這份紀錄只留當時修過的兩件事。舊場地的量測數字已經不是現在的 F9A 尺寸，不再列在這裡，避免跟現行常數搞混。

現行尺寸：

- 教室關卡的碰撞球：`DRONE_RADIUS = 0.6`（`apps/simulator/src/core/droneState.ts`）
- 足球護罩：F9A-A 半徑 0.20（`SOCCER_BALL_R`／`shieldR`）
- 機對機與牆面：護罩半徑，輕彈（`apps/simulator/src/soccer/contact.ts`）
- 練習假人：球形、半徑等於護罩，碰撞用護罩半徑
- 隱藏 ball 模式的黃球半徑：伺服器與客戶端都是 0.6

## 仍在程式裡的修正

1. **`resolveObstacleCollisions()`**（`apps/simulator/src/core/physics.ts`）：方塊把球心推出地板或天花板之後，位置拉回地板／天花板之間。只改位置，不動速度與起降狀態。
2. **機對機完全重疊**：距離近乎 0 時，兩邊不要推往同一個方向。現在依 id 把本機推向相反側（`resolveShieldContact`）。
