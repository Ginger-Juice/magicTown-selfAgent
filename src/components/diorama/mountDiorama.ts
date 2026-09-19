import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { DioramaKind } from '@/lib/diorama';

type ColorMat = THREE.Material & {
  color?: THREE.Color;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  depthWrite?: boolean;
};

export interface DioramaPreset {
  background: number;
  fog?: { color: number; density: number };
  cameraFov: number;
  cameraPosition: [number, number, number];
  target: [number, number, number];
  minDistance: number;
  maxDistance: number;
  minPolarAngle: number;
  maxPolarAngle: number;
  exposure: number;
  bloom: { strength: number; radius: number; threshold: number };
  ambient: { color: number; intensity: number };
  hemi: { sky: number; ground: number; intensity: number };
  sun: { color: number; intensity: number; position: [number, number, number] };
  fill?: { color: number; intensity: number; position: [number, number, number] };
  points: Array<{
    color: number;
    intensity: number;
    distance: number;
    decay: number;
    position: [number, number, number];
  }>;
}

export const DIORAMA_PRESETS: Record<DioramaKind, DioramaPreset> = {
  'town-hall-garden': {
    background: 0xf3efe6,
    cameraFov: 32,
    cameraPosition: [-10.2, 6.2, 12.0],
    target: [0.1, 2.55, 0.2],
    minDistance: 7.4,
    maxDistance: 18,
    minPolarAngle: 0.22,
    maxPolarAngle: Math.PI * 0.46,
    exposure: 1.16,
    bloom: { strength: 0.24, radius: 0.52, threshold: 0.7 },
    ambient: { color: 0xfff1dc, intensity: 0.64 },
    hemi: { sky: 0xffe6c4, ground: 0xc4a888, intensity: 0.5 },
    sun: { color: 0xffe0b0, intensity: 1.42, position: [7.2, 11.5, 5.4] },
    fill: { color: 0xc8d8f0, intensity: 0.32, position: [-6.5, 6.2, -3.8] },
    points: [
      { color: 0xffc56a, intensity: 6.2, distance: 6.5, decay: 1.5, position: [-1.7, 1.45, -0.15] },
      { color: 0xffd27a, intensity: 7.0, distance: 7.2, decay: 1.4, position: [1.35, 1.55, 1.55] },
      { color: 0xffe6b8, intensity: 4.4, distance: 5.4, decay: 1.7, position: [0.05, 4.7, 0.05] },
    ],
  },
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

/** Load a pre-authored GLB and present it. Does not build landmark meshes. */
export function mountDiorama(
  canvas: HTMLCanvasElement,
  glbUrl: string,
  kind: DioramaKind,
  handlers: {
    onReady: () => void;
    onError: (err: unknown) => void;
  },
): () => void {
  let disposed = false;
  let raf = 0;
  const preset = DIORAMA_PRESETS[kind];

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(preset.background);
  if (preset.fog) {
    scene.fog = new THREE.FogExp2(preset.fog.color, preset.fog.density);
  }

  const { w, h } = sizeOf(canvas);
  const camera = new THREE.PerspectiveCamera(preset.cameraFov, w / h, 0.05, 80);
  camera.position.set(...preset.cameraPosition);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = preset.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.target.set(...preset.target);
  controls.minDistance = preset.minDistance;
  controls.maxDistance = preset.maxDistance;
  controls.maxPolarAngle = preset.maxPolarAngle;
  controls.minPolarAngle = preset.minPolarAngle;
  controls.enablePan = true;
  controls.screenSpacePanning = true;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(
    new UnrealBloomPass(
      new THREE.Vector2(w, h),
      preset.bloom.strength,
      preset.bloom.radius,
      preset.bloom.threshold,
    ),
  );
  composer.addPass(new OutputPass());

  scene.add(new THREE.AmbientLight(preset.ambient.color, preset.ambient.intensity));
  scene.add(new THREE.HemisphereLight(preset.hemi.sky, preset.hemi.ground, preset.hemi.intensity));
  const sun = new THREE.DirectionalLight(preset.sun.color, preset.sun.intensity);
  sun.position.set(...preset.sun.position);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.00035;
  sun.shadow.normalBias = 0.04;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 32;
  sun.shadow.camera.left = -10;
  sun.shadow.camera.right = 10;
  sun.shadow.camera.top = 10;
  sun.shadow.camera.bottom = -10;
  scene.add(sun);
  if (preset.fill) {
    const fill = new THREE.DirectionalLight(preset.fill.color, preset.fill.intensity);
    fill.position.set(...preset.fill.position);
    scene.add(fill);
  }
  for (const lamp of preset.points) {
    const light = new THREE.PointLight(lamp.color, lamp.intensity, lamp.distance, lamp.decay);
    light.position.set(...lamp.position);
    scene.add(light);
  }

  const disposables: THREE.Object3D[] = [];
  const lampMats: { mat: ColorMat; base: number }[] = [];

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
    controls.update();
    for (const { mat, base } of lampMats) {
      if (mat.emissiveIntensity == null) continue;
      mat.emissiveIntensity = base * (1 + 0.06 * Math.sin(t * 1.6) + 0.03 * Math.sin(t * 4.2));
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
          if (mat.emissive && (mat.emissiveIntensity ?? 0) > 4.2) {
            mat.emissiveIntensity = 4.2;
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
          if (mat.name && /window|interiorlight|lamp|clockface/i.test(`${mat.name}${obj.name}`)) {
            lampMats.push({ mat, base: mat.emissiveIntensity || 1 });
          }
        });
      });

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
    for (const obj of disposables) scene.remove(obj);
    scene.clear();
  };
}
