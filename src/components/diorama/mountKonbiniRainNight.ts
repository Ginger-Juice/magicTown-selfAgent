import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

type ColorMat = THREE.Material & {
  color?: THREE.Color;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  depthWrite?: boolean;
};

function isMesh(obj: THREE.Object3D): obj is THREE.Mesh {
  return (obj as THREE.Mesh).isMesh === true;
}

function eachMaterial(obj: THREE.Object3D, fn: (mat: ColorMat) => void) {
  if (!isMesh(obj)) return;
  const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
  for (const mat of mats) {
    if (mat) fn(mat);
  }
}

function sizeOf(el: HTMLElement) {
  return {
    w: Math.max(1, el.clientWidth),
    h: Math.max(1, el.clientHeight),
  };
}

export function mountKonbiniRainNight(
  canvas: HTMLCanvasElement,
  glbUrl: string,
  handlers: {
    onReady: () => void;
    onError: (err: unknown) => void;
  },
): () => void {
  let disposed = false;
  let raf = 0;
  const reduced =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a1018);
  scene.fog = new THREE.FogExp2(0x0c1420, 0.018);

  const { w, h } = sizeOf(canvas);
  const camera = new THREE.PerspectiveCamera(42, w / h, 0.05, 80);
  camera.position.set(-7.6, 6.4, 8.8);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.target.set(0.15, 0.95, -0.05);
  controls.minDistance = 4.2;
  controls.maxDistance = 16;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minPolarAngle = 0.18;
  controls.enablePan = true;
  controls.screenSpacePanning = true;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.2, 0.45, 0.86));
  composer.addPass(new OutputPass());

  scene.add(new THREE.AmbientLight(0x5a6d8c, 0.42));
  scene.add(new THREE.HemisphereLight(0x6a88bb, 0x1a2030, 0.38));
  const fill = new THREE.DirectionalLight(0x8aa6d6, 0.28);
  fill.position.set(-4, 8, -3);
  scene.add(fill);
  const neon = new THREE.PointLight(0x4ecfc6, 12, 9, 1.6);
  neon.position.set(0.7, 3.3, 2.1);
  scene.add(neon);
  const warm = new THREE.PointLight(0xffc56a, 16, 7, 1.4);
  warm.position.set(0.7, 1.8, 1.4);
  scene.add(warm);
  const lamp = new THREE.PointLight(0xffb056, 10, 6, 1.8);
  lamp.position.set(-1.5, 2.9, 2.0);
  scene.add(lamp);

  const disposables: THREE.Object3D[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const signMats: { mat: ColorMat; base: number }[] = [];
  let rain: THREE.Points | null = null;
  let rainVel: Float32Array | null = null;
  const drips: THREE.Mesh[] = [];

  const resize = () => {
    if (disposed) return;
    const next = sizeOf(canvas);
    camera.aspect = next.w / next.h;
    camera.updateProjectionMatrix();
    renderer.setSize(next.w, next.h, false);
    composer.setSize(next.w, next.h);
  };
  const ro = new ResizeObserver(resize);

  const clock = new THREE.Clock();
  const tick = () => {
    if (disposed) return;
    const t = clock.getElapsedTime();
    const dt = Math.min(clock.getDelta(), 0.05);
    controls.update();

    if (rain && rainVel) {
      const pos = rain.geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < rainVel.length; i++) {
        pos[i * 3] += dt * 0.35;
        pos[i * 3 + 1] -= rainVel[i] * dt;
        if (pos[i * 3 + 1] < 0.32) {
          pos[i * 3] = (Math.random() - 0.5) * 8.2;
          pos[i * 3 + 1] = 6.2 + Math.random();
          pos[i * 3 + 2] = (Math.random() - 0.5) * 8.2;
        }
      }
      rain.geometry.attributes.position.needsUpdate = true;
    }

    for (const drip of drips) {
      const u = (t * 0.55 + (drip.userData.phase as number)) % 1;
      drip.position.set(drip.userData.x as number, (drip.userData.y0 as number) - u * 2.35, drip.userData.z as number);
      const s = u < 0.08 ? u / 0.08 : u > 0.9 ? (1 - u) / 0.1 : 1;
      drip.scale.setScalar(0.35 + 0.85 * s);
    }

    for (const { mat, base } of signMats) {
      if (mat.emissiveIntensity == null) continue;
      mat.emissiveIntensity = base * (1 + 0.08 * Math.sin(t * 2.1) + 0.04 * Math.sin(t * 7.3));
    }

    composer.render();
    raf = requestAnimationFrame(tick);
  };

  const loader = new GLTFLoader();
  loader.load(
    glbUrl,
    (root) => {
      if (disposed) return;
      const model = root.scene;
      model.traverse((obj) => {
        if (!isMesh(obj)) return;
        obj.castShadow = true;
        obj.receiveShadow = true;
        eachMaterial(obj, (mat) => {
          if (mat.color) {
            const hsl = { h: 0, s: 0, l: 0 };
            mat.color.getHSL(hsl);
            if (hsl.s < 0.08 && mat.emissive) {
              const eh = { h: 0, s: 0, l: 0 };
              mat.emissive.getHSL(eh);
              if (eh.s > 0.12) mat.color.copy(mat.emissive);
            } else if (hsl.s > 0.04) {
              mat.color.setHSL(hsl.h, Math.min(1, hsl.s * 1.35), hsl.l);
            }
          }
          if (mat.emissive && (mat.emissiveIntensity ?? 0) > 3.2) {
            mat.emissiveIntensity = 3.2;
          }
          if (mat.name && /glass|water/i.test(`${mat.name}${obj.name}`)) {
            mat.transparent = true;
            mat.opacity = Math.min(mat.opacity ?? 1, 0.28);
            mat.depthWrite = false;
          }
        });
      });
      scene.add(model);
      disposables.push(model);

      model.traverse((obj) => {
        eachMaterial(obj, (mat) => {
          if (mat.name && /sign|neon|interiorlight|lamp/i.test(mat.name)) {
            signMats.push({ mat, base: mat.emissiveIntensity || 1 });
          }
        });
      });

      if (!reduced) {
        const rainCount = 1600;
        const rainGeo = new THREE.BufferGeometry();
        const rainPos = new Float32Array(rainCount * 3);
        rainVel = new Float32Array(rainCount);
        for (let i = 0; i < rainCount; i++) {
          rainPos[i * 3] = (Math.random() - 0.5) * 8.2;
          rainPos[i * 3 + 1] = Math.random() * 6.5 + 0.4;
          rainPos[i * 3 + 2] = (Math.random() - 0.5) * 8.2;
          rainVel[i] = 7 + Math.random() * 4;
        }
        rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
        const rainMat = new THREE.PointsMaterial({
          color: 0x7a93aa,
          size: 0.028,
          transparent: true,
          opacity: 0.32,
          depthWrite: false,
        });
        rain = new THREE.Points(rainGeo, rainMat);
        scene.add(rain);
        geometries.push(rainGeo);
        materials.push(rainMat);

        const dripGeom = new THREE.SphereGeometry(0.018, 8, 8);
        const dripMat = new THREE.MeshBasicMaterial({ color: 0xc5e4ff });
        geometries.push(dripGeom);
        materials.push(dripMat);
        const dripStarts = [
          [-0.5, 2.75, 2.15],
          [0.35, 2.75, 2.15],
          [1.15, 2.75, 2.15],
          [1.9, 2.75, 2.15],
          [-1.1, 2.75, 0.6],
        ];
        for (let i = 0; i < 10; i++) {
          const mesh = new THREE.Mesh(dripGeom, dripMat);
          const src = dripStarts[i % dripStarts.length];
          mesh.userData = { x: src[0], z: src[2], y0: src[1], phase: i * 0.37 };
          scene.add(mesh);
          drips.push(mesh);
        }
      }

      handlers.onReady();
      raf = requestAnimationFrame(tick);
    },
    undefined,
    (err) => {
      if (!disposed) handlers.onError(err);
    },
  );

  ro.observe(canvas);
  window.addEventListener('resize', resize);

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    ro.disconnect();
    window.removeEventListener('resize', resize);
    controls.dispose();
    composer.dispose();
    renderer.dispose();
    for (const obj of drips) scene.remove(obj);
    if (rain) scene.remove(rain);
    for (const obj of disposables) scene.remove(obj);
    for (const geo of geometries) geo.dispose();
    for (const mat of materials) mat.dispose();
    scene.clear();
  };
}
