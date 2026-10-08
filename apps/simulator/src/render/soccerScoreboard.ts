// 吊在球館中央的雙面七段計分板。數字畫在貼圖上（七段），兩面各一塊，兩隊都看得到。
import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  DynamicTexture,
  Color3,
  TransformNode,
} from '@babylonjs/core';
import { SEVEN_SEG, formatClock, type BroadcastView } from '../soccer/broadcast';
import { hex } from './scene';

export interface SoccerScoreboard {
  root: TransformNode;
  update(view: BroadcastView): void;
  dispose(): void;
}

const W = 1024;
const H = 512;

export function createSoccerScoreboard(scene: Scene, y: number): SoccerScoreboard {
  const root = new TransformNode('soccerScoreboard', scene);
  root.position.set(0, y, 0);

  const tex = new DynamicTexture('soccerBoardTex', { width: W, height: H }, scene, false);
  tex.hasAlpha = false;

  const mat = new StandardMaterial('soccerBoardMat', scene);
  mat.diffuseTexture = tex;
  mat.emissiveColor = Color3.White();
  mat.specularColor = Color3.Black();
  mat.disableLighting = true;
  mat.backFaceCulling = true;

  const faceW = 3.5;
  const faceH = faceW * (H / W);
  const front = MeshBuilder.CreatePlane('soccerBoardFront', { width: faceW, height: faceH }, scene);
  front.parent = root;
  front.position.z = 0.04;
  front.material = mat;
  front.isPickable = false;
  const back = MeshBuilder.CreatePlane('soccerBoardBack', { width: faceW, height: faceH }, scene);
  back.parent = root;
  back.position.z = -0.04;
  back.rotation.y = Math.PI;
  back.material = mat;
  back.isPickable = false;

  // 吊桿：天花板到板子上緣
  const rodMat = new StandardMaterial('soccerBoardRod', scene);
  rodMat.diffuseColor = hex(0x8ea3b6);
  rodMat.emissiveColor = hex(0x7d93a8);
  rodMat.specularColor = Color3.Black();
  rodMat.disableLighting = true;
  for (const x of [-1.2, 1.2]) {
    const rod = MeshBuilder.CreateCylinder(
      `soccerBoardRod-${x}`,
      { diameter: 0.03, height: 0.7, tessellation: 8 },
      scene,
    );
    rod.parent = root;
    rod.position.set(x, faceH / 2 + 0.35, 0);
    rod.material = rodMat;
    rod.isPickable = false;
  }

  const shell = MeshBuilder.CreateBox(
    'soccerBoardShell',
    { width: faceW + 0.08, height: faceH + 0.08, depth: 0.06 },
    scene,
  );
  shell.parent = root;
  const shellMat = new StandardMaterial('soccerBoardShellMat', scene);
  shellMat.diffuseColor = hex(0x6d8196);
  shellMat.emissiveColor = hex(0x62778c);
  shellMat.specularColor = Color3.Black();
  shellMat.disableLighting = true;
  shell.material = shellMat;
  shell.isPickable = false;

  let lastKey = '';

  const paint = (view: BroadcastView): void => {
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle = '#1a2836';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#8ea4b8';
    ctx.lineWidth = 28;
    ctx.strokeRect(18, 18, W - 36, H - 36);
    ctx.strokeStyle = '#3e5164';
    ctx.lineWidth = 10;
    ctx.strokeRect(48, 48, W - 96, H - 96);

    ctx.fillStyle = '#9aa4b2';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('藍勝局', 36, 24);
    ctx.textAlign = 'right';
    ctx.fillText('紅勝局', W - 36, 24);
    ctx.textAlign = 'center';
    ctx.fillText('第     局', W / 2 - 150, 24);
    ctx.fillText('倒數', W / 2 + 210, 24);

    // 勝局（各一位）、局數（一位）、倒數（四位）
    drawDigit(ctx, String(view.blueSets), 48, 70, 70, 110, '#3ec2ff');
    drawDigit(ctx, String(view.redSets), W - 118, 70, 70, 110, '#ff4d5a');
    drawDigit(ctx, String(view.period % 10), W / 2 - 188, 68, 64, 100, '#f4f7fb');
    const clock = formatClock(view.remainSec);
    drawClock(ctx, clock, W / 2 + 40, 68, 52, 100, '#ffe08a');

    ctx.fillStyle = '#9aa4b2';
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('本局進球', W / 2, 250);

    const b = String(view.blueGoals).padStart(2, '0');
    const r = String(view.redGoals).padStart(2, '0');
    drawDigit(ctx, b[0] ?? '0', W / 2 - 250, 286, 78, 130, '#3ec2ff');
    drawDigit(ctx, b[1] ?? '0', W / 2 - 155, 286, 78, 130, '#3ec2ff');
    ctx.fillStyle = '#f4f7fb';
    ctx.fillRect(W / 2 - 18, 330, 16, 16);
    ctx.fillRect(W / 2 - 18, 386, 16, 16);
    drawDigit(ctx, r[0] ?? '0', W / 2 + 70, 286, 78, 130, '#ff4d5a');
    drawDigit(ctx, r[1] ?? '0', W / 2 + 165, 286, 78, 130, '#ff4d5a');

    ctx.fillStyle = view.flag === '請返場' ? '#ffb020' : view.flag === '可得分' ? '#3dde7a' : '#1a2836';
    if (view.flag) {
      ctx.font = 'bold 36px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(view.flag, 36, 456);
    }
    tex.update();
  };

  return {
    root,
    update(view: BroadcastView): void {
      const key = [
        view.period,
        view.remainSec,
        view.blueSets,
        view.redSets,
        view.blueGoals,
        view.redGoals,
        view.flag,
      ].join('|');
      if (key === lastKey) return;
      lastKey = key;
      paint(view);
    },
    dispose(): void {
      root.dispose(false, true);
      tex.dispose();
    },
  };
}

/** 讓吊桿在建好後能接到天花板（呼叫端知道場高） */
export function stretchScoreboardRods(root: TransformNode, ceilingY: number): void {
  const faceH = 3.5 * (H / W);
  const gap = ceilingY - (root.position.y + faceH / 2);
  const height = Math.max(0.2, gap);
  for (const child of root.getChildMeshes()) {
    if (!child.name.startsWith('soccerBoardRod')) continue;
    child.scaling.y = height / 0.7;
    child.position.y = faceH / 2 + height / 2;
  }
}

function drawClock(
  ctx: CanvasRenderingContext2D,
  clock: string,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  const digits = clock.replace(':', '');
  digits.split('').forEach((ch, i) => {
    drawDigit(ctx, ch, x + i * (w + 8) + (i >= 2 ? 18 : 0), y, w, h, color);
  });
  ctx.fillStyle = color;
  const cx = x + 2 * (w + 8) + 2;
  ctx.fillRect(cx, y + h * 0.32, 10, 10);
  ctx.fillRect(cx, y + h * 0.62, 10, 10);
}

function drawDigit(
  ctx: CanvasRenderingContext2D,
  ch: string,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  const mask = SEVEN_SEG[ch] ?? SEVEN_SEG['0'] ?? [1, 1, 1, 1, 1, 1, 0];
  const t = Math.max(6, Math.round(w * 0.18));
  const hGap = t * 0.55;
  const vLen = (h - t * 3) / 2;
  ctx.fillStyle = '#2c3c4c';
  // 熄滅的段先鋪一層暗的，亮段再蓋上
  for (let i = 0; i < 7; i++) fillSeg(ctx, i, x, y, w, h, t, vLen, hGap);
  ctx.fillStyle = color;
  mask.forEach((on, i) => {
    if (on) fillSeg(ctx, i, x, y, w, h, t, vLen, hGap);
  });
}

function fillSeg(
  ctx: CanvasRenderingContext2D,
  i: number,
  x: number,
  y: number,
  w: number,
  h: number,
  t: number,
  vLen: number,
  hGap: number,
): void {
  const midY = y + t + vLen;
  if (i === 0) ctx.fillRect(x + hGap, y, w - hGap * 2, t);
  else if (i === 1) ctx.fillRect(x + w - t, y + hGap, t, vLen);
  else if (i === 2) ctx.fillRect(x + w - t, midY + hGap, t, vLen);
  else if (i === 3) ctx.fillRect(x + hGap, y + h - t, w - hGap * 2, t);
  else if (i === 4) ctx.fillRect(x, midY + hGap, t, vLen);
  else if (i === 5) ctx.fillRect(x, y + hGap, t, vLen);
  else ctx.fillRect(x + hGap, midY, w - hGap * 2, t);
}
