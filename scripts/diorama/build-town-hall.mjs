/**
 * Scripted Magic Town 镇公所 GLB — clay diorama matching public/b-townhall.png.
 *
 * Rounded volumes, plaster/slate noise, inset windows, clock faces, ivy worms.
 * Quality bar is the konbini preview's material richness — still a civic hall.
 *
 * Preferred local path (Blender 4+/5):
 *   blender --background --python scripts/blender/town_hall.py
 *
 * Cloud / CI fallback (this file, no Blender):
 *   npm run diorama:town-hall
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    constructor() {
      this.result = null;
      this.onload = null;
      this.onloadend = null;
      this.onerror = null;
    }
    readAsArrayBuffer(blob) {
      setTimeout(() => {
        Promise.resolve(blob.arrayBuffer())
          .then((buf) => {
            this.result = buf;
            const ev = { target: this };
            this.onload?.(ev);
            this.onloadend?.(ev);
          })
          .catch((err) => {
            this.onerror?.({ target: this, error: err });
            this.onloadend?.({ target: this });
          });
      }, 0);
    }
  };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC_DIR = path.join(ROOT, 'public', 'diorama-town-hall');
const ASSET_DIR = path.join(ROOT, 'assets', 'diorama-town-hall');
const GLB_NAME = 'town_hall.glb';

function hash(i) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function clay(name, color, extra = {}) {
  return new THREE.MeshStandardMaterial({
    name,
    color,
    roughness: extra.rough ?? 0.78,
    metalness: extra.metal ?? 0.03,
    emissive: extra.emissive ?? color,
    emissiveIntensity: extra.emit ?? 0.18,
    vertexColors: extra.vertexColors ?? true,
    transparent: extra.transparent ?? false,
    opacity: extra.opacity ?? 1,
    side: extra.side ?? THREE.FrontSide,
  });
}

function tintGeometry(geo, variation = 0.07) {
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const n = (hash(i + pos.getX(i) * 17 + pos.getY(i) * 31) - 0.5) * variation;
    colors[i * 3] = 1 + n;
    colors[i * 3 + 1] = 1 + n * 0.7;
    colors[i * 3 + 2] = 1 + n * 0.45;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

const MAT = {
  wall: clay('TownHallWall', 0xb46a48, { emit: 0.2, rough: 0.82 }),
  timber: clay('TownHallTimber', 0xf0dfc4, { emit: 0.22, rough: 0.62 }),
  roof: clay('TownHallRoof', 0x4d5868, { emit: 0.1, rough: 0.88 }),
  ridge: clay('TownHallRidge', 0x3c4554, { emit: 0.08, rough: 0.7 }),
  window: clay('InteriorLight', 0xffd27a, { emit: 3.1, rough: 0.28, emissive: 0xffe08a, vertexColors: false }),
  mullion: clay('TownHallMullion', 0xc9a07a, { emit: 0.16, rough: 0.55 }),
  frame: clay('TownHallFrame', 0x6a4030, { emit: 0.1, rough: 0.68 }),
  clock: clay('ClockFace', 0xfff6ea, { emit: 0.7, rough: 0.38, emissive: 0xfff3dc, vertexColors: false }),
  bezel: clay('ClockBezel', 0xd8c4a4, { emit: 0.2, rough: 0.45, vertexColors: false }),
  hand: clay('ClockHand', 0x2c2826, { emit: 0.06, rough: 0.5, vertexColors: false }),
  ivy: clay('TownHallIvy', 0x61704c, { emit: 0.14, rough: 0.92 }),
  ivyTip: clay('TownHallIvyTip', 0x71825a, { emit: 0.16, rough: 0.9 }),
  bush: clay('TownHallBush', 0x6a784f, { emit: 0.12, rough: 0.94 }),
  ground: clay('TownHallGround', 0xd2c4ae, { emit: 0.12, rough: 0.9 }),
  chimney: clay('TownHallChimney', 0x353238, { emit: 0.08, rough: 0.76 }),
  step: clay('TownHallStep', 0xa45c40, { emit: 0.16, rough: 0.74 }),
  door: clay('TownHallDoor', 0x7e4a34, { emit: 0.12, rough: 0.7 }),
};

const root = new THREE.Group();
root.name = 'TownHallDiorama';

function add(mesh, parent = root) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function rbox(w, h, d, mat, x, y, z, radius = 0.08, segs = 2, rx = 0, ry = 0, rz = 0) {
  const rad = Math.min(radius, w / 2.2, h / 2.2, d / 2.2);
  const geo = tintGeometry(new RoundedBoxGeometry(w, h, d, segs, rad));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  return add(mesh);
}

function cyl(rTop, rBot, h, segs, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const mesh = new THREE.Mesh(tintGeometry(new THREE.CylinderGeometry(rTop, rBot, h, segs)), mat);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  return add(mesh);
}

function sphere(r, mat, x, y, z, sx = 1, sy = 1, sz = 1, segs = 16) {
  const mesh = new THREE.Mesh(tintGeometry(new THREE.SphereGeometry(r, segs, segs - 2), 0.05), mat);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  return add(mesh);
}

function gableRoof({ cx, cz, eavesY, width, depth, height, ridgeAxis, overhang = 0.18 }) {
  const half = width / 2 + overhang;
  const len = depth + overhang * 2;
  const slope = Math.hypot(half, height);
  const angle = Math.atan2(height, half);
  const thick = 0.16;
  const midY = eavesY + height / 2;

  if (ridgeAxis === 'z') {
    rbox(slope, thick, len, MAT.roof, cx - half / 2, midY, cz, 0.05, 1, 0, 0, angle);
    rbox(slope, thick, len, MAT.roof, cx + half / 2, midY, cz, 0.05, 1, 0, 0, -angle);
    cyl(0.045, 0.045, len * 0.98, 10, MAT.ridge, cx, eavesY + height + 0.02, cz, Math.PI / 2, 0, 0);
  } else {
    rbox(len, thick, slope, MAT.roof, cx, midY, cz - half / 2, 0.05, 1, -angle, 0, 0);
    rbox(len, thick, slope, MAT.roof, cx, midY, cz + half / 2, 0.05, 1, angle, 0, 0);
    cyl(0.045, 0.045, len * 0.98, 10, MAT.ridge, cx, eavesY + height + 0.02, cz, 0, 0, Math.PI / 2);
  }
}

function gableEnd({ x, y, z, width, height, facing }) {
  const hw = width / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-hw, 0);
  shape.lineTo(hw, 0);
  shape.lineTo(0, height);
  const geo = tintGeometry(
    new THREE.ExtrudeGeometry(shape, {
      depth: 0.12,
      bevelEnabled: true,
      bevelThickness: 0.035,
      bevelSize: 0.03,
      bevelSegments: 2,
    }),
  );
  geo.translate(0, 0, -0.06);
  const mesh = new THREE.Mesh(geo, MAT.wall);
  if (facing === 'x') mesh.rotation.y = Math.PI / 2;
  mesh.position.set(x, y, z);
  return add(mesh);
}

function timber(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  return rbox(w, h, d, MAT.timber, x, y, z, 0.035, 1, rx, ry, rz);
}

function windowPane(w, h, x, y, z, facing) {
  const lip = 0.05;
  if (facing === 'x' || facing === '-x') {
    const out = facing === '-x' ? -1 : 1;
    rbox(0.04, h + lip * 2, w + lip * 2, MAT.frame, x, y, z, 0.018, 1);
    rbox(0.018, h * 0.86, w * 0.86, MAT.window, x + out * 0.02, y, z, 0.01, 1);
    rbox(0.012, h * 0.86, 0.016, MAT.mullion, x + out * 0.03, y, z, 0.005, 1);
    rbox(0.012, 0.016, w * 0.86, MAT.mullion, x + out * 0.03, y, z, 0.005, 1);
  } else {
    const out = facing === '-z' ? -1 : 1;
    rbox(w + lip * 2, h + lip * 2, 0.04, MAT.frame, x, y, z, 0.018, 1);
    rbox(w * 0.86, h * 0.86, 0.018, MAT.window, x, y, z + out * 0.02, 0.01, 1);
    rbox(0.016, h * 0.86, 0.012, MAT.mullion, x, y, z + out * 0.03, 0.005, 1);
    rbox(w * 0.86, 0.016, 0.012, MAT.mullion, x, y, z + out * 0.03, 0.005, 1);
  }
}

function clockFace(x, y, z, facing) {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  if (facing === '-x') group.rotation.y = Math.PI / 2;
  if (facing === '+x') group.rotation.y = -Math.PI / 2;
  root.add(group);

  const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.028, 10, 28), MAT.bezel);
  add(bezel, group);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.285, 32), MAT.clock);
  disc.position.z = 0.01;
  add(disc, group);

  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const tick = new THREE.Mesh(new THREE.BoxGeometry(i % 3 === 0 ? 0.03 : 0.018, 0.04, 0.012), MAT.hand);
    tick.position.set(Math.sin(a) * 0.23, Math.cos(a) * 0.23, 0.016);
    tick.rotation.z = -a;
    add(tick, group);
  }

  const hourGeo = new RoundedBoxGeometry(0.03, 0.12, 0.014, 1, 0.005);
  hourGeo.translate(0, 0.06, 0);
  const hour = new THREE.Mesh(hourGeo, MAT.hand);
  hour.rotation.z = 0.52;
  hour.position.z = 0.02;
  add(hour, group);
  const minuteGeo = new RoundedBoxGeometry(0.022, 0.18, 0.014, 1, 0.004);
  minuteGeo.translate(0, 0.09, 0);
  const minute = new THREE.Mesh(minuteGeo, MAT.hand);
  minute.rotation.z = -0.42;
  minute.position.z = 0.022;
  add(minute, group);
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 10), MAT.hand);
  hub.position.z = 0.024;
  add(hub, group);
}

function vine(points, radius = 0.075) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const tube = new THREE.Mesh(tintGeometry(new THREE.TubeGeometry(curve, 22, radius, 8, false), 0.08), MAT.ivy);
  add(tube);
  const end = points[points.length - 1];
  sphere(radius * 1.15, MAT.ivyTip, end[0], end[1], end[2], 1.1, 1.2, 1.1, 12);
  const start = points[0];
  sphere(radius * 1.35, MAT.ivy, start[0], start[1] * 0.4, start[2], 1.3, 0.8, 1.2, 12);
}

function bush(x, y, z, s = 1) {
  sphere(0.28 * s, MAT.bush, x, y, z, 1.25, 0.88, 1.2, 14);
  sphere(0.18 * s, MAT.bush, x + 0.16 * s, y + 0.07 * s, z + 0.08 * s, 1, 1, 1, 12);
  sphere(0.16 * s, MAT.bush, x - 0.14 * s, y + 0.05 * s, z - 0.08 * s, 1, 1, 1, 12);
  sphere(0.12 * s, MAT.ivyTip, x + 0.04 * s, y + 0.14 * s, z - 0.04 * s, 1, 1, 1, 10);
}

function chimney(x, y, z, w = 0.3, d = 0.24, h = 0.58) {
  rbox(w, h, d, MAT.chimney, x, y + h / 2, z, 0.06, 2);
  cyl(0.05, 0.055, 0.18, 10, MAT.chimney, x - w * 0.2, y + h + 0.07, z);
  cyl(0.05, 0.055, 0.22, 10, MAT.chimney, x + w * 0.2, y + h + 0.09, z);
}

function steps(cx, cz, facing = 'z', count = 3, width = 1.05) {
  for (let i = 0; i < count; i++) {
    const t = 0.1;
    const w = width - i * 0.05;
    const d = 0.24;
    const y = 0.055 + i * t;
    if (facing === 'z') rbox(w, t, d, MAT.step, cx, y, cz + i * 0.15, 0.03, 1);
    else rbox(d, t, w, MAT.step, cx - i * 0.15, y, cz, 0.03, 1);
  }
}

function buildPlaza() {
  rbox(9.6, 0.16, 9.6, MAT.ground, 0, -0.06, 0.18, 0.12, 2);
  const nubs = [
    [-3.7, -0.2],
    [-2.3, -2.7],
    [0.3, -2.9],
    [2.9, -2.3],
    [4.0, 0.15],
    [3.7, 2.5],
    [1.1, 3.4],
    [-1.5, 3.2],
    [-3.6, 2.3],
    [-4.1, 0.55],
    [-3.9, -1.4],
    [3.2, 3.1],
  ];
  for (const [x, z] of nubs) {
    sphere(0.11, MAT.ivy, x, 0.04, z, 1.25, 0.65, 1.15, 10);
  }
}

function buildWings() {
  const left = { cx: -1.72, cz: -0.12, w: 3.16, d: 4.28, h: 2.52 };
  const right = { cx: 1.42, cz: 0.92, w: 4.36, d: 3.16, h: 2.52 };
  const eaves = left.h;

  rbox(left.w, left.h, left.d, MAT.wall, left.cx, left.h / 2, left.cz, 0.11, 2);
  rbox(right.w, right.h, right.d, MAT.wall, right.cx, right.h / 2, right.cz, 0.11, 2);

  const roofH = 2.05;
  gableRoof({
    cx: left.cx,
    cz: left.cz,
    eavesY: eaves - 0.02,
    width: left.w,
    depth: left.d,
    height: roofH,
    ridgeAxis: 'z',
  });
  gableEnd({
    x: left.cx - left.w / 2 - 0.01,
    y: eaves,
    z: left.cz,
    width: left.d * 0.94,
    height: roofH * 0.96,
    facing: 'x',
  });

  gableRoof({
    cx: right.cx,
    cz: right.cz,
    eavesY: eaves - 0.02,
    width: right.d,
    depth: right.w,
    height: roofH + 0.08,
    ridgeAxis: 'x',
  });
  gableEnd({
    x: right.cx + right.w / 2 + 0.01,
    y: eaves,
    z: right.cz,
    width: right.d * 0.94,
    height: (roofH + 0.08) * 0.96,
    facing: 'x',
  });

  const westX = left.cx - left.w / 2 - 0.035;
  timber(0.11, left.h + 0.06, 0.13, westX, left.h / 2, left.cz - left.d * 0.32);
  timber(0.11, left.h + 0.06, 0.13, westX, left.h / 2, left.cz + left.d * 0.32);
  timber(0.11, left.h + 0.06, 0.13, westX, left.h / 2, left.cz);
  timber(0.11, 0.13, left.d * 0.9, westX, 1.28, left.cz);
  timber(0.11, 0.13, left.d * 0.9, westX, 2.4, left.cz);
  timber(0.1, 1.45, 0.1, westX, eaves + 0.74, left.cz, 0.68, 0, 0);
  timber(0.1, 1.45, 0.1, westX, eaves + 0.74, left.cz, -0.68, 0, 0);
  timber(0.1, 0.5, 0.1, westX, eaves + 1.28, left.cz);

  const southZ = right.cz + right.d / 2 + 0.035;
  timber(right.w * 0.9, 0.13, 0.11, right.cx, 1.3, southZ);
  timber(right.w * 0.9, 0.13, 0.11, right.cx, 2.42, southZ);
  for (const ox of [-1.55, -0.52, 0.52, 1.55]) {
    timber(0.12, 1.18, 0.11, right.cx + ox, 1.88, southZ);
  }
  timber(0.72, 0.1, 0.1, right.cx - 1.02, 1.88, southZ, 0, 0, 0.7);
  timber(0.72, 0.1, 0.1, right.cx - 1.02, 1.88, southZ, 0, 0, -0.7);
  timber(0.72, 0.1, 0.1, right.cx + 1.02, 1.88, southZ, 0, 0, 0.7);
  timber(0.72, 0.1, 0.1, right.cx + 1.02, 1.88, southZ, 0, 0, -0.7);

  const eastX = right.cx + right.w / 2 + 0.035;
  timber(0.11, right.h + 0.06, 0.13, eastX, right.h / 2, right.cz - 0.7);
  timber(0.11, right.h + 0.06, 0.13, eastX, right.h / 2, right.cz + 0.7);
  timber(0.11, 0.13, right.d * 0.86, eastX, 1.28, right.cz);
  timber(0.11, 0.13, right.d * 0.86, eastX, 2.4, right.cz);
  timber(0.1, 1.32, 0.1, eastX, eaves + 0.7, right.cz, 0.62, 0, 0);
  timber(0.1, 1.32, 0.1, eastX, eaves + 0.7, right.cz, -0.62, 0, 0);

  windowPane(0.34, 0.44, westX - 0.02, 1.84, left.cz - 0.55, '-x');
  windowPane(0.34, 0.44, westX - 0.02, 1.84, left.cz + 0.55, '-x');
  windowPane(0.34, 0.44, westX - 0.02, 0.74, left.cz - 0.55, '-x');
  windowPane(0.34, 0.44, westX - 0.02, 0.74, left.cz + 0.55, '-x');
  windowPane(0.22, 0.28, left.cx - 0.52, eaves + 0.74, left.cz - 0.85, '-x');
  windowPane(0.22, 0.28, left.cx - 0.52, eaves + 0.74, left.cz + 0.85, '-x');

  const leftSouth = left.cz + left.d / 2 + 0.03;
  windowPane(0.32, 0.42, left.cx - 0.55, 1.82, leftSouth, 'z');
  windowPane(0.32, 0.42, left.cx + 0.55, 0.72, leftSouth, 'z');

  windowPane(0.32, 0.42, right.cx - 1.15, 1.88, southZ + 0.02, 'z');
  windowPane(0.32, 0.42, right.cx - 0.15, 1.88, southZ + 0.02, 'z');
  windowPane(0.32, 0.42, right.cx + 0.85, 1.88, southZ + 0.02, 'z');
  windowPane(0.32, 0.42, right.cx - 1.15, 0.74, southZ + 0.02, 'z');
  windowPane(0.32, 0.42, right.cx - 0.15, 0.74, southZ + 0.02, 'z');

  rbox(0.78, 1.32, 0.1, MAT.frame, right.cx + 1.15, 0.72, southZ + 0.02, 0.04, 1);
  rbox(0.6, 1.14, 0.06, MAT.door, right.cx + 1.15, 0.7, southZ + 0.06, 0.04, 1);
  sphere(0.03, MAT.bezel, right.cx + 1.32, 0.72, southZ + 0.12);
  cyl(0.075, 0.085, 1.58, 12, MAT.wall, right.cx + 0.78, 0.84, southZ + 0.44);
  cyl(0.075, 0.085, 1.58, 12, MAT.wall, right.cx + 1.52, 0.84, southZ + 0.44);
  rbox(1.12, 0.12, 0.78, MAT.roof, right.cx + 1.15, 1.68, southZ + 0.34, 0.04, 1);
  steps(right.cx + 1.15, southZ + 0.58, 'z', 3, 1.08);

  windowPane(0.32, 0.42, eastX + 0.02, 1.86, right.cz + 0.15, 'x');
  windowPane(0.32, 0.42, eastX + 0.02, 0.74, right.cz + 0.15, 'x');

  rbox(0.58, 0.46, 0.52, MAT.wall, right.cx + 0.15, eaves + 0.55, southZ - 0.12, 0.06, 1);
  gableRoof({
    cx: right.cx + 0.15,
    cz: southZ - 0.12,
    eavesY: eaves + 0.74,
    width: 0.64,
    depth: 0.56,
    height: 0.4,
    ridgeAxis: 'x',
    overhang: 0.05,
  });
  windowPane(0.2, 0.24, right.cx + 0.15, eaves + 0.58, southZ + 0.1, 'z');

  chimney(left.cx - 0.12, eaves + roofH - 0.12, left.cz - 1.55, 0.34, 0.26, 0.52);
  chimney(right.cx + 1.85, eaves + roofH - 0.02, right.cz - 0.04, 0.32, 0.26, 0.5);

  steps(left.cx - 0.15, leftSouth + 0.22, 'z', 2, 0.9);

  return { left, right, eaves, roofH };
}

function buildTower() {
  const cx = 0.06;
  const cz = -0.18;
  const base = 2.28;
  const top = 5.12;
  const w = 1.3;
  rbox(w, top - base, w, MAT.wall, cx, (base + top) / 2, cz, 0.1, 2);
  rbox(w + 0.1, 1.02, w + 0.1, MAT.wall, cx, top + 0.46, cz, 0.08, 2);
  clockFace(cx, top + 0.46, cz + w / 2 + 0.07, 'z');
  clockFace(cx - w / 2 - 0.07, top + 0.46, cz, '-x');

  const inset = w / 2 + 0.04;
  for (const [dx, dz] of [
    [-inset, -inset],
    [inset, -inset],
    [-inset, inset],
    [inset, inset],
  ]) {
    rbox(0.11, 0.55, 0.11, MAT.chimney, cx + dx, top + 0.88, cz + dz, 0.03, 1);
  }

  const pts = [
    new THREE.Vector2(1.0, 0),
    new THREE.Vector2(0.86, 0.14),
    new THREE.Vector2(0.48, 0.62),
    new THREE.Vector2(0.16, 1.02),
    new THREE.Vector2(0.035, 1.22),
    new THREE.Vector2(0.0, 1.32),
  ];
  const hat = new THREE.Mesh(tintGeometry(new THREE.LatheGeometry(pts, 4)), MAT.roof);
  hat.position.set(cx, top + 0.92, cz);
  add(hat);

  cyl(0.026, 0.03, 0.72, 10, MAT.chimney, cx, top + 0.92 + 1.62, cz);
  sphere(0.045, MAT.bezel, cx, top + 0.92 + 2.02, cz);
  rbox(0.22, 0.028, 0.028, MAT.chimney, cx, top + 0.92 + 2.12, cz, 0.008, 1);
  rbox(0.028, 0.12, 0.028, MAT.chimney, cx, top + 0.92 + 2.2, cz, 0.008, 1);
}

function buildGarden() {
  vine(
    [
      [-3.34, 0.18, 1.42],
      [-3.33, 0.9, 1.22],
      [-3.3, 1.65, 0.95],
      [-3.28, 2.25, 0.58],
      [-3.18, 2.62, 0.18],
    ],
    0.07,
  );
  vine(
    [
      [-3.32, 0.2, 1.72],
      [-3.22, 0.95, 1.92],
      [-3.12, 1.55, 2.02],
    ],
    0.055,
  );
  vine(
    [
      [-0.88, 0.16, 2.06],
      [-0.78, 0.88, 2.08],
      [-0.68, 1.58, 2.06],
    ],
    0.055,
  );
  vine(
    [
      [0.5, 0.18, 2.54],
      [0.58, 1.05, 2.53],
      [0.52, 1.85, 2.5],
      [0.42, 2.48, 2.38],
    ],
    0.065,
  );
  vine(
    [
      [1.9, 0.2, 2.54],
      [1.98, 1.1, 2.52],
      [2.08, 1.88, 2.44],
      [2.14, 2.48, 2.22],
    ],
    0.058,
  );
  vine(
    [
      [3.64, 0.2, 1.52],
      [3.65, 1.05, 1.36],
      [3.62, 1.82, 1.1],
      [3.56, 2.42, 0.82],
    ],
    0.065,
  );

  bush(-3.42, 0.18, 1.88, 1.28);
  bush(-2.12, 0.16, 2.28, 1.08);
  bush(0.12, 0.16, 2.9, 0.95);
  bush(3.58, 0.18, 2.22, 1.18);
  bush(3.88, 0.16, 0.32, 0.98);
  bush(-3.52, 0.16, -2.08, 1.05);
  bush(-0.15, 0.14, 2.62, 0.82);
}

function build() {
  buildPlaza();
  buildWings();
  buildTower();
  buildGarden();
}

async function exportGlb() {
  const exporter = new GLTFExporter();
  const data = await exporter.parseAsync(root, { binary: true });
  const buf = Buffer.from(data instanceof ArrayBuffer ? data : await data.arrayBuffer());
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  fs.mkdirSync(ASSET_DIR, { recursive: true });
  const publicPath = path.join(PUBLIC_DIR, GLB_NAME);
  const assetPath = path.join(ASSET_DIR, GLB_NAME);
  fs.writeFileSync(publicPath, buf);
  fs.writeFileSync(assetPath, buf);
  console.log(`wrote ${publicPath} (${buf.length} bytes)`);
  console.log(`wrote ${assetPath}`);
}

build();
exportGlb().catch((err) => {
  console.error(err);
  process.exit(1);
});
