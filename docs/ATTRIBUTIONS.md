# 第三方素材出處與授權（Attributions）

本專案使用了來自 [mqnc/propwash](https://github.com/mqnc/propwash)（程式碼 MIT）所附帶的素材。
**這些素材不適用 MIT，各自保留原始的 Creative Commons 授權**，列示如下。

## 背景天空（遠景）

| 項目 | 檔案 | 標題 | 作者 | 授權 | 來源 |
|---|---|---|---|---|---|
| HDRI 天空盒 | `assets/env/pretoria_gardens_1k.hdr` | Pretoria Gardens | Dimitrios Savva, Jarod Guest | **CC0**（公眾領域，免標註） | [Poly Haven](https://polyhaven.com/a/pretoria_gardens) |

- 用途：作為 3D 場景的背景天空盒與環境反射，增加遠景真實感。
- CC0 無須標註，此處列出僅為記錄。

## 場景地圖（大亂鬥背景）

| 項目 | 檔案 | 標題 | 作者 | 授權 | 來源 |
|---|---|---|---|---|---|
| 3D 場景 | `assets/maps/playground_2b.glb` | playground 2 | [Pasha](https://sketchfab.com/Pasha-) | **CC BY 4.0** | [Sketchfab](https://skfb.ly/pyZnG) |

- **CC BY 4.0 要求標註**：須註明標題、作者、授權，並標示是否有變更。
- 變更說明：未修改模型內容；於大亂鬥模式中作為**純背景裝飾**（可開關，不參與碰撞），程式自動置中、縮放、落地對位。

## 背景音樂

| 項目 | 檔案 | 標題 | 作者 | 授權 | 來源 |
|---|---|---|---|---|---|
| 音樂 | `assets/music/magenta-metropolis.mp3` | Magenta Metropolis | \| e s c p \| (https://www.escp.space) | **CC BY 4.0** | [free-stock-music.com](https://www.free-stock-music.com/fsm-team-escp-magenta-metropolis.html) |

- **CC BY 4.0 要求標註**：須註明標題、作者、授權，並標示是否有變更。
- 變更說明：未修改音樂內容；僅在本模擬器中作為可開關的循環背景音樂播放（預設關閉、預設音量 0.15）。
- 檔案自 propwash 的 `assets/music/fsm-team-escp-magenta-metropolis.mp3` 取得，僅更名為 `magenta-metropolis.mp3`。

## 程式碼（MIT）

### 偏航曲線與搖桿死區

| 項目 | 檔案 | 作者 | 授權 | 來源 |
|---|---|---|---|---|
| BETAFLIGHT `rawRate`、subtract-then-rescale 死區 | `apps/simulator/src/input/stickCurve.ts` | Andrii Shramko | **MIT** | [ShramkoGSFPV](https://github.com/AndriiShramko/ShramkoGSFPV) |

- 來源檔：`packages/sim-core/src/rates.ts`（`rawRate` 的 BETAFLIGHT 分支）、`packages/input/src/calib.ts`（`applyDeadband`）。
- 公式由 ShramkoGSFPV 自 Betaflight 4.5.1（`src/main/fc/rc.c`，GPL-3.0）重寫。本專案沿用該 MIT 重寫，**未複製 Betaflight GPL 原始碼**。
- 變更說明：改寫成靜態方法；只保留 BETAFLIGHT 曲線（偏航指數，預設 0 = 線性）與死區縮放。未引入其他 rates type、油門曲線或校正精靈。
- 檔頭保留 MIT 宣告：Copyright (c) 2026 Andrii Shramko。

## 授權連結

- CC0 1.0：https://creativecommons.org/publicdomain/zero/1.0/
- CC BY 4.0：https://creativecommons.org/licenses/by/4.0/
- MIT：https://opensource.org/license/mit
- ShramkoGSFPV：https://github.com/AndriiShramko/ShramkoGSFPV
