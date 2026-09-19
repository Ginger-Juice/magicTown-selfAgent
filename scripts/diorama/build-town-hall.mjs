/**
 * Scripted Magic Town 镇公所 GLB — matches public/b-townhall.png
 * (L-plan half-timber hall, clock tower, ivy, garden plaza).
 *
 * Preferred local path (Blender 4+/5, higher-quality clay):
 *   blender --background --python scripts/blender/town_hall.py
 *
 * This Node builder is the cloud/CI fallback when headless Blender is missing.
 *   npm run diorama:town-hall
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

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

function clay(name, color, extra = {}) {
  return new THREE.MeshStandardMaterial({
    name,
    color,
    roughness: extra.rough ?? 0.8,
    metalness: extra.metal ?? 0.02,
    emissive: extra.emissive ?? color,
    emissiveIntensity: extra.emit ?? 0.14,
    transparent: extra.transparent ?? false,
    opacity: extra.opacity ?? 1,
    side: extra.side ?? THREE.FrontSide,
  });
}

const MAT = {
  wall: clay('TownHallWall', 0x9a563c, { emit: 0.16, side: THREE.DoubleSide }),
  timber: clay('TownHallTimber', 0xe6d3b4, { emit: 0.18, rough: 0.72 }),
  roof: clay('TownHallRoof', 0x4a5568, { emit: 0.08, rough: 0.86 }),
  window: clay('InteriorLight', 0xf3c46a, { emit: 2.8, rough: 0.32, emissive: 0xffd27a }),
  frame: clay('TownHallFrame', 0x5c3a2a, { emit: 0.08, rough: 0.7 }),
  clock: clay('ClockFace', 0xf6f0e4, { emit: 0.55, rough: 0.45, emissive: 0xfff6e8 }),
  hand: clay('ClockHand', 0x2a2624, { emit: 0.05, rough: 0.55 }),
  ivy: clay('TownHallIvy', 0x5c6b48, { emit: 0.12, rough: 0.9 }),
  bush: clay('TownHallBush', 0x66754f, { emit: 0.1, rough: 0.92 }),
  ground: clay('TownHallGround', 0xc8bba8, { emit: 0.1, rough: 0.88 }),
  chimney: clay('TownHallChimney', 0x2f2c2e, { emit: 0.06, rough: 0.78 }),
  step: clay('TownHallStep', 0x8d4f38, { emit: 0.12 }),
};

const root = new THREE.Group();
root.name = 'TownHallDiorama';

function add(mesh, parent = root) {
  parent.add(mesh);
  return mesh;
}

function box(w, h, d, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  return add(mesh);
}

function cyl(rTop, rBot, h, segs, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, segs), mat);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  return add(mesh);
}

function sphere(r, mat, x, y, z, sx = 1, sy = 1, sz = 1) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), mat);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  return add(mesh);
}

function cone(r, h, segs, mat, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(r, h, segs), mat);
  mesh.position.set(x, y, z);
  return add(mesh);
}

function gableRoof({ cx, cz, eavesY, width, depth, height, ridgeAxis, overhang = 0.16, mat = MAT.roof }) {
  const half = width / 2 + overhang;
  const len = depth + overhang * 2;
  const slope = Math.hypot(half, height);
  const angle = Math.atan2(height, half);
  const thick = 0.08;
  const midY = eavesY + height / 2;

  if (ridgeAxis === 'z') {
    box(slope, thick, len, mat, cx - half / 2, midY, cz, 0, 0, angle);
    box(slope, thick, len, mat, cx + half / 2, midY, cz, 0, 0, -angle);
  } else {
    box(len, thick, slope, mat, cx, midY, cz - half / 2, -angle, 0, 0);
    box(len, thick, slope, mat, cx, midY, cz + half / 2, angle, 0, 0);
  }
}

/** Thin triangular gable cap flush with a wall plane (no extrude — those drifted). */
function gableEnd({ x, y, z, width, height, facing }) {
  const hw = width / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-hw, 0);
  shape.lineTo(hw, 0);
  shape.lineTo(0, height);
  const geo = new THREE.ShapeGeometry(shape);
  const mesh = new THREE.Mesh(geo, MAT.wall);
  if (facing === 'x') mesh.rotation.y = Math.PI / 2;
  mesh.position.set(x, y, z);
  return add(mesh);
}

function timberStrip(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  return box(w, h, d, MAT.timber, x, y, z, rx, ry, rz);
}

function windowPane(w, h, x, y, z, facing) {
  const depth = 0.06;
  const frameT = 0.045;
  let wx = x;
  let wz = z;
  let bw = w;
  let bd = depth;
  if (facing === 'x') {
    bw = depth;
    bd = w;
  }
  box(bw + frameT * 2, h + frameT * 2, bd + (facing === 'x' ? 0 : frameT * 0.4), MAT.frame, wx, y, wz);
  box(bw * 0.78, h * 0.78, bd * 1.4, MAT.window, wx, y, wz);
}

function clockFace(x, y, z, facing) {
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.28, 24), MAT.clock);
  if (facing === 'z') {
    disc.position.set(x, y, z);
  } else {
    disc.rotation.y = facing === '+x' ? -Math.PI / 2 : Math.PI / 2;
    disc.position.set(x, y, z);
  }
  add(disc);
  const hour = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.14, 0.02), MAT.hand);
  const minute = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.2, 0.02), MAT.hand);
  hour.position.set(0, 0.05, 0.012);
  hour.rotation.z = 0.55;
  minute.position.set(0, 0.08, 0.014);
  minute.rotation.z = -0.35;
  disc.add(hour);
  disc.add(minute);
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), MAT.hand);
  hub.position.z = 0.016;
  disc.add(hub);
}

function vine(points, radius = 0.1) {
  for (let i = 0; i < points.length; i++) {
    const [x, y, z] = points[i];
    const wobble = 0.9 + ((i * 17) % 7) * 0.04;
    sphere(radius * wobble, MAT.ivy, x, y, z, 1.05, 1.25, 1.05);
    if (i > 0) {
      const [x0, y0, z0] = points[i - 1];
      sphere(radius * 0.95, MAT.ivy, (x + x0) / 2, (y + y0) / 2, (z + z0) / 2, 1.15, 1.3, 1.15);
    }
  }
}

function bush(x, y, z, s = 1) {
  sphere(0.32 * s, MAT.bush, x, y, z, 1.2, 0.9, 1.15);
  sphere(0.2 * s, MAT.bush, x + 0.16 * s, y + 0.06 * s, z + 0.08 * s);
  sphere(0.18 * s, MAT.bush, x - 0.14 * s, y + 0.05 * s, z - 0.07 * s);
}

function chimney(x, y, z, w = 0.28, d = 0.22, h = 0.55) {
  box(w, h, d, MAT.chimney, x, y + h / 2, z);
  cyl(0.045, 0.05, 0.16, 8, MAT.chimney, x - w * 0.18, y + h + 0.06, z);
  cyl(0.045, 0.05, 0.2, 8, MAT.chimney, x + w * 0.18, y + h + 0.08, z);
}

function steps(cx, cz, facing = 'z', count = 3) {
  for (let i = 0; i < count; i++) {
    const t = 0.09;
    const w = 0.95 - i * 0.04;
    const d = 0.22;
    const y = 0.05 + i * t;
    if (facing === 'z') box(w, t, d, MAT.step, cx, y, cz + i * 0.14);
    else box(d, t, w, MAT.step, cx - i * 0.14, y, cz);
  }
}

function buildPlaza() {
  box(9.4, 0.1, 9.4, MAT.ground, 0, -0.05, 0.15);
  // cobble nubs around the pad edge, matching the clay cutout
  const nubs = [
    [-3.6, -0.3],
    [-2.2, -2.6],
    [0.4, -2.8],
    [2.8, -2.2],
    [3.9, 0.2],
    [3.6, 2.4],
    [1.2, 3.3],
    [-1.4, 3.1],
    [-3.5, 2.2],
    [-4.0, 0.6],
  ];
  for (const [x, z] of nubs) {
    sphere(0.09, MAT.ivy, x, 0.02, z, 1.2, 0.7, 1.1);
  }
}

function buildWings() {
  const left = { cx: -1.72, cz: -0.12, w: 3.16, d: 4.28, h: 2.52 };
  const right = { cx: 1.42, cz: 0.92, w: 4.36, d: 3.16, h: 2.52 };
  const eaves = left.h;

  box(left.w, left.h, left.d, MAT.wall, left.cx, left.h / 2, left.cz);
  box(right.w, right.h, right.d, MAT.wall, right.cx, right.h / 2, right.cz);

  const roofH = 2.05;
  gableRoof({
    cx: left.cx,
    cz: left.cz,
    eavesY: eaves,
    width: left.w,
    depth: left.d,
    height: roofH,
    ridgeAxis: 'z',
  });
  gableEnd({
    x: left.cx - left.w / 2 - 0.01,
    y: eaves,
    z: left.cz,
    width: left.d * 0.96,
    height: roofH,
    facing: 'x',
  });

  gableRoof({
    cx: right.cx,
    cz: right.cz,
    eavesY: eaves,
    width: right.d,
    depth: right.w,
    height: roofH + 0.08,
    ridgeAxis: 'x',
  });
  gableEnd({
    x: right.cx + right.w / 2 + 0.01,
    y: eaves,
    z: right.cz,
    width: right.d * 0.96,
    height: roofH + 0.08,
    facing: 'x',
  });

  // West gable timber — keep strips in the wall plane (YZ), never rotate around Z.
  const westX = left.cx - left.w / 2 - 0.03;
  timberStrip(0.1, left.h + 0.08, 0.12, westX, left.h / 2, left.cz - left.d * 0.32);
  timberStrip(0.1, left.h + 0.08, 0.12, westX, left.h / 2, left.cz + left.d * 0.32);
  timberStrip(0.1, left.h + 0.08, 0.12, westX, left.h / 2, left.cz);
  timberStrip(0.1, 0.12, left.d * 0.92, westX, 1.28, left.cz);
  timberStrip(0.1, 0.12, left.d * 0.92, westX, 2.42, left.cz);
  timberStrip(0.1, 1.55, 0.1, westX, eaves + 0.78, left.cz, 0.7, 0, 0);
  timberStrip(0.1, 1.55, 0.1, westX, eaves + 0.78, left.cz, -0.7, 0, 0);
  timberStrip(0.1, 0.55, 0.1, westX, eaves + 1.35, left.cz);

  // South facade timber on the right wing
  const southZ = right.cz + right.d / 2 + 0.03;
  timberStrip(right.w * 0.92, 0.12, 0.1, right.cx, 1.32, southZ);
  timberStrip(right.w * 0.92, 0.12, 0.1, right.cx, 2.44, southZ);
  for (const ox of [-1.55, -0.52, 0.52, 1.55]) {
    timberStrip(0.11, 1.2, 0.1, right.cx + ox, 1.9, southZ);
  }
  timberStrip(0.7, 0.1, 0.1, right.cx - 1.0, 1.9, southZ, 0, 0, 0.7);
  timberStrip(0.7, 0.1, 0.1, right.cx - 1.0, 1.9, southZ, 0, 0, -0.7);
  timberStrip(0.7, 0.1, 0.1, right.cx + 1.0, 1.9, southZ, 0, 0, 0.7);
  timberStrip(0.7, 0.1, 0.1, right.cx + 1.0, 1.9, southZ, 0, 0, -0.7);

  // East gable timber
  const eastX = right.cx + right.w / 2 + 0.03;
  timberStrip(0.1, right.h + 0.08, 0.12, eastX, right.h / 2, right.cz - 0.7);
  timberStrip(0.1, right.h + 0.08, 0.12, eastX, right.h / 2, right.cz + 0.7);
  timberStrip(0.1, 0.12, right.d * 0.88, eastX, 1.3, right.cz);
  timberStrip(0.1, 0.12, right.d * 0.88, eastX, 2.42, right.cz);
  timberStrip(0.1, 1.4, 0.1, eastX, eaves + 0.72, right.cz, 0.65, 0, 0);
  timberStrip(0.1, 1.4, 0.1, eastX, eaves + 0.72, right.cz, -0.65, 0, 0);

  // Windows — left west gable
  windowPane(0.32, 0.42, westX - 0.02, 1.85, left.cz - 0.55, 'x');
  windowPane(0.32, 0.42, westX - 0.02, 1.85, left.cz + 0.55, 'x');
  windowPane(0.32, 0.42, westX - 0.02, 0.72, left.cz - 0.55, 'x');
  windowPane(0.32, 0.42, westX - 0.02, 0.72, left.cz + 0.55, 'x');
  // roof dormers on left slope
  windowPane(0.22, 0.26, left.cx - 0.55, eaves + 0.72, left.cz - 0.85, 'x');
  windowPane(0.22, 0.26, left.cx - 0.55, eaves + 0.72, left.cz + 0.85, 'x');

  // South wall of left wing
  const leftSouth = left.cz + left.d / 2 + 0.02;
  windowPane(0.3, 0.4, left.cx - 0.55, 1.82, leftSouth, 'z');
  windowPane(0.3, 0.4, left.cx + 0.55, 0.7, leftSouth, 'z');

  // Right wing south windows + door
  windowPane(0.3, 0.4, right.cx - 1.15, 1.88, southZ + 0.02, 'z');
  windowPane(0.3, 0.4, right.cx - 0.15, 1.88, southZ + 0.02, 'z');
  windowPane(0.3, 0.4, right.cx + 0.85, 1.88, southZ + 0.02, 'z');
  windowPane(0.3, 0.4, right.cx - 1.15, 0.72, southZ + 0.02, 'z');
  windowPane(0.3, 0.4, right.cx - 0.15, 0.72, southZ + 0.02, 'z');

  // Door + porch
  box(0.72, 1.28, 0.08, MAT.frame, right.cx + 1.15, 0.7, southZ + 0.02);
  box(0.58, 1.12, 0.04, clay('TownHallDoor', 0x7a4330, { emit: 0.1 }), right.cx + 1.15, 0.68, southZ + 0.05);
  cyl(0.07, 0.08, 1.55, 10, MAT.wall, right.cx + 0.78, 0.82, southZ + 0.42);
  cyl(0.07, 0.08, 1.55, 10, MAT.wall, right.cx + 1.52, 0.82, southZ + 0.42);
  box(1.05, 0.1, 0.7, MAT.roof, right.cx + 1.15, 1.64, southZ + 0.32);
  steps(right.cx + 1.15, southZ + 0.55, 'z', 3);

  // East windows
  windowPane(0.3, 0.4, eastX + 0.02, 1.86, right.cz + 0.15, 'x');
  windowPane(0.3, 0.4, eastX + 0.02, 0.72, right.cz + 0.15, 'x');

  // Dormer on right south roof
  box(0.55, 0.42, 0.5, MAT.wall, right.cx + 0.15, eaves + 0.55, southZ - 0.15);
  gableRoof({
    cx: right.cx + 0.15,
    cz: southZ - 0.15,
    eavesY: eaves + 0.72,
    width: 0.62,
    depth: 0.55,
    height: 0.38,
    ridgeAxis: 'x',
    overhang: 0.04,
  });
  windowPane(0.2, 0.24, right.cx + 0.15, eaves + 0.58, southZ + 0.08, 'z');

  chimney(left.cx - 0.15, eaves + roofH - 0.15, left.cz - 1.55, 0.32, 0.24, 0.5);
  chimney(right.cx + 1.85, eaves + roofH - 0.05, right.cz - 0.05, 0.3, 0.24, 0.48);

  steps(left.cx - 0.15, leftSouth + 0.2, 'z', 2);

  return { left, right, eaves, roofH };
}

function buildTower() {
  const cx = 0.06;
  const cz = -0.18;
  const base = 2.35;
  const top = 5.12;
  const w = 1.28;
  box(w, top - base, w, MAT.wall, cx, (base + top) / 2, cz);

  // clock loft
  box(w + 0.08, 0.95, w + 0.08, MAT.wall, cx, top + 0.42, cz);
  clockFace(cx, top + 0.42, cz + w / 2 + 0.055, 'z');
  clockFace(cx - w / 2 - 0.055, top + 0.42, cz, '-x');

  const pinnacleH = 0.72;
  const inset = w / 2 + 0.02;
  for (const [dx, dz] of [
    [-inset, -inset],
    [inset, -inset],
    [-inset, inset],
    [inset, inset],
  ]) {
    box(0.1, pinnacleH, 0.1, MAT.chimney, cx + dx, top + 0.85 + pinnacleH / 2, cz + dz);
  }

  const roofH = 1.85;
  cone(1.05, roofH, 4, MAT.roof, cx, top + 0.95 + roofH / 2, cz);
  cyl(0.03, 0.035, 1.15, 8, MAT.chimney, cx, top + 0.95 + roofH + 0.45, cz);
  sphere(0.055, MAT.chimney, cx, top + 0.95 + roofH + 1.02, cz);
  box(0.28, 0.035, 0.035, MAT.chimney, cx, top + 0.95 + roofH + 1.12, cz);
  box(0.035, 0.16, 0.035, MAT.chimney, cx, top + 0.95 + roofH + 1.22, cz);
}

function buildGarden(left, right) {
  // climbing ivy — clay worms from the homepage sprite
  vine(
    [
      [-3.35, 0.2, 1.45],
      [-3.34, 0.85, 1.28],
      [-3.33, 1.5, 1.05],
      [-3.32, 2.1, 0.72],
      [-3.3, 2.55, 0.28],
    ],
    0.11,
  );
  vine(
    [
      [-3.34, 0.25, 1.7],
      [-3.28, 0.95, 1.88],
      [-3.2, 1.55, 2.0],
    ],
    0.09,
  );
  vine(
    [
      [-0.85, 0.18, 2.05],
      [-0.78, 0.85, 2.07],
      [-0.7, 1.5, 2.06],
    ],
    0.09,
  );
  vine(
    [
      [0.52, 0.2, 2.52],
      [0.58, 1.0, 2.52],
      [0.54, 1.75, 2.5],
      [0.46, 2.4, 2.42],
    ],
    0.1,
  );
  vine(
    [
      [1.88, 0.22, 2.52],
      [1.96, 1.05, 2.51],
      [2.04, 1.8, 2.46],
      [2.1, 2.4, 2.28],
    ],
    0.09,
  );
  vine(
    [
      [3.62, 0.22, 1.5],
      [3.63, 1.0, 1.38],
      [3.61, 1.75, 1.15],
      [3.58, 2.35, 0.88],
    ],
    0.1,
  );

  bush(-3.4, 0.16, 1.85, 1.25);
  bush(-2.1, 0.14, 2.25, 1.05);
  bush(0.15, 0.14, 2.85, 0.9);
  bush(3.55, 0.16, 2.2, 1.15);
  bush(3.85, 0.14, 0.35, 0.95);
  bush(-3.5, 0.14, -2.05, 1.0);
  bush(left.cx + 0.2, 0.12, right.cz + 1.75, 0.85);
}

function build() {
  buildPlaza();
  const { left, right } = buildWings();
  buildTower();
  buildGarden(left, right);
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
