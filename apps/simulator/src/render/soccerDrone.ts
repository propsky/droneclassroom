// 無人機足球機體：球形護罩 + 裡面的四軸與螺旋槳 + 赤道 LED 環。
// 半徑對齊護罩碰撞（呼叫端傳入），只負責外觀。
import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  TransformNode,
  Quaternion,
  ShadowGenerator,
} from '@babylonjs/core';
import { hex } from './scene';

export interface SoccerDroneModel {
  root: TransformNode;
  setGuardColor(color: number): void;
  /** 螺旋槳轉角（rad）＋機身姿態 */
  pose(x: number, y: number, z: number, yaw: number, pitch: number, roll: number, propAngle: number): void;
  setEnabled(on: boolean): void;
  dispose(): void;
}

export function createSoccerDrone(
  scene: Scene,
  name: string,
  radius: number,
  shadows: ShadowGenerator | null,
): SoccerDroneModel {
  const root = new TransformNode(`soccerDrone-${name}`, scene);
  root.rotationQuaternion = Quaternion.Identity();
  const casters: Mesh[] = [];

  const track = (mesh: Mesh): Mesh => {
    mesh.parent = mesh.parent ?? root;
    mesh.isPickable = false;
    casters.push(mesh);
    shadows?.addShadowCaster(mesh);
    return mesh;
  };

  const cageMat = new StandardMaterial(`soccerCage-${name}`, scene);
  cageMat.diffuseColor = hex(0xd5dce4);
  cageMat.specularColor = new Color3(0.62, 0.66, 0.72);
  cageMat.emissiveColor = hex(0xb7c0cc).scale(0.18);
  const ledMat = new StandardMaterial(`soccerLed-${name}`, scene);
  ledMat.disableLighting = true;
  const dark = new StandardMaterial(`soccerDroneDark-${name}`, scene);
  dark.diffuseColor = hex(0x1c2430);
  dark.specularColor = new Color3(0.2, 0.2, 0.2);
  const propMat = new StandardMaterial(`soccerProp-${name}`, scene);
  propMat.diffuseColor = hex(0xd7dde6);
  propMat.specularColor = new Color3(0.4, 0.4, 0.4);
  propMat.emissiveColor = hex(0x9aa3b2).scale(0.15);

  const tube = Math.max(0.012, radius * 0.16);
  const ring = (id: string, diameter: number, y: number): void => {
    const mesh = track(
      MeshBuilder.CreateTorus(
        `soccerCageRing-${name}-${id}`,
        { diameter, thickness: tube, tessellation: 28 },
        scene,
      ),
    );
    mesh.parent = root;
    mesh.position.y = y;
    mesh.material = cageMat;
  };

  // 三條緯線（赤道＋上下）
  ring('eq', radius * 2 * 0.98, 0);
  const lat = 0.62;
  const latR = Math.cos(lat) * radius;
  const latY = Math.sin(lat) * radius;
  ring('up', latR * 2, latY);
  ring('dn', latR * 2, -latY);

  // 兩條經線（各自是一整圈，轉 90° 後交成球籠）
  for (let i = 0; i < 2; i++) {
    const node = new TransformNode(`soccerMeridian-${name}-${i}`, scene);
    node.parent = root;
    node.rotation.y = i * (Math.PI / 2);
    const mesh = track(
      MeshBuilder.CreateTorus(
        `soccerMeridianMesh-${name}-${i}`,
        { diameter: radius * 2 * 0.98, thickness: tube, tessellation: 28 },
        scene,
      ),
    );
    mesh.parent = node;
    mesh.rotation.x = Math.PI / 2;
    mesh.material = cageMat;
  }

  const led = track(
    MeshBuilder.CreateTorus(
      `soccerLed-${name}`,
      { diameter: radius * 1.55, thickness: tube * 1.15, tessellation: 32 },
      scene,
    ),
  );
  led.parent = root;
  led.material = ledMat;

  // 護罩裡的四軸
  const body = track(MeshBuilder.CreateBox(`soccerBody-${name}`, { size: radius * 0.42 }, scene));
  body.parent = root;
  body.material = dark;

  const props: TransformNode[] = [];
  const armLen = radius * 0.48;
  const motors: Array<[number, number]> = [
    [armLen, armLen],
    [-armLen, armLen],
    [armLen, -armLen],
    [-armLen, -armLen],
  ];
  motors.forEach(([mx, mz], i) => {
    const arm = track(
      MeshBuilder.CreateBox(
        `soccerArm-${name}-${i}`,
        { width: radius * 0.06, height: radius * 0.05, depth: armLen * 0.85 },
        scene,
      ),
    );
    arm.parent = root;
    arm.material = dark;
    arm.position.set(mx * 0.45, 0, mz * 0.45);
    arm.rotation.y = Math.atan2(mx, mz);

    const motor = track(
      MeshBuilder.CreateCylinder(
        `soccerMotor-${name}-${i}`,
        { diameter: radius * 0.16, height: radius * 0.1, tessellation: 10 },
        scene,
      ),
    );
    motor.parent = root;
    motor.material = dark;
    motor.position.set(mx, radius * 0.06, mz);

    const prop = new TransformNode(`soccerProp-${name}-${i}`, scene);
    prop.parent = root;
    prop.position.set(mx, radius * 0.12, mz);
    const bladeA = track(
      MeshBuilder.CreateBox(
        `soccerBlade-${name}-${i}a`,
        { width: radius * 0.62, height: radius * 0.02, depth: radius * 0.08 },
        scene,
      ),
    );
    bladeA.parent = prop;
    bladeA.material = propMat;
    const bladeB = track(
      MeshBuilder.CreateBox(
        `soccerBlade-${name}-${i}b`,
        { width: radius * 0.08, height: radius * 0.02, depth: radius * 0.62 },
        scene,
      ),
    );
    bladeB.parent = prop;
    bladeB.material = propMat;
    props.push(prop);
  });

  // 機頭小標記（鼻朝 -Z），方便看出朝向
  const nose = track(MeshBuilder.CreateSphere(`soccerNose-${name}`, { diameter: radius * 0.12, segments: 6 }, scene));
  nose.parent = root;
  nose.position.set(0, 0, -radius * 0.72);
  const noseMat = new StandardMaterial(`soccerNoseMat-${name}`, scene);
  noseMat.emissiveColor = Color3.White();
  noseMat.disableLighting = true;
  nose.material = noseMat;

  let guard = 0xffffff;

  const apply = (color: number): void => {
    guard = color;
    const c = hex(color);
    // 骨架維持金屬銀，只在邊緣帶一點隊色；LED 環用全亮度隊色，從場地裡跳出來
    cageMat.diffuseColor = hex(0xd5dce4);
    cageMat.emissiveColor = c.scale(0.2);
    cageMat.specularColor = new Color3(0.62, 0.66, 0.72);
    ledMat.emissiveColor = c;
  };
  apply(0xff2d3a);

  return {
    root,
    setGuardColor(color: number): void {
      if (color !== guard) apply(color);
    },
    pose(x, y, z, yaw, pitch, roll, propAngle): void {
      root.position.set(x, y, z);
      Quaternion.RotationYawPitchRollToRef(yaw, pitch, roll, root.rotationQuaternion as Quaternion);
      props.forEach((p, i) => {
        p.rotation.y = propAngle * (i % 2 ? 1 : -1);
      });
      const pulse = 0.78 + 0.22 * Math.sin(propAngle * 3);
      ledMat.emissiveColor = hex(guard).scale(pulse);
    },
    setEnabled(on: boolean): void {
      root.setEnabled(on);
    },
    dispose(): void {
      for (const mesh of casters) shadows?.removeShadowCaster(mesh);
      root.dispose(false, true);
    },
  };
}
