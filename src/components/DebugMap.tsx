import { useCallback, useEffect, useRef, useState } from 'react';
import { Compass as CompassIcon, Minus, Plus } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';

const FALLBACK = { w: 1600, h: 1200 };

interface Cam {
  x: number;
  y: number;
  s: number;
}

/** Pan/zoom shell for backend debugging. No landmark hit targets. */
export default function DebugMap() {
  const { t } = useLanguage();
  const stageRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const cam = useRef<Cam>({ x: 0, y: 0, s: 1 });
  const size = useRef(FALLBACK);
  const baseScale = useRef(1);
  const [ready, setReady] = useState(false);

  const applyCam = useCallback(() => {
    const el = worldRef.current;
    if (!el) return;
    const { x, y, s } = cam.current;
    el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${s})`;
  }, []);

  const fit = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const vw = stage.clientWidth;
    const vh = stage.clientHeight;
    const s = Math.min(vw / size.current.w, vh / size.current.h);
    baseScale.current = s;
    cam.current = {
      x: (vw - size.current.w * s) / 2,
      y: (vh - size.current.h * s) / 2,
      s,
    };
    applyCam();
  }, [applyCam]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const ro = new ResizeObserver(fit);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [fit]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    let dragging = false;
    let sx = 0;
    let sy = 0;
    let startX = 0;
    let startY = 0;

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
      startX = cam.current.x;
      startY = cam.current.y;
      try {
        stage.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };

    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      cam.current.x = startX + (e.clientX - sx);
      cam.current.y = startY + (e.clientY - sy);
      applyCam();
    };

    const onUp = () => {
      dragging = false;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = stage.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const old = cam.current.s;
      const next = Math.min(
        baseScale.current * 3,
        Math.max(baseScale.current * 0.6, old * Math.exp(-e.deltaY * 0.0012)),
      );
      if (next === old) return;
      const wx = (cx - cam.current.x) / old;
      const wy = (cy - cam.current.y) / old;
      cam.current.s = next;
      cam.current.x = cx - wx * next;
      cam.current.y = cy - wy * next;
      applyCam();
    };

    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onUp);
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      stage.removeEventListener('pointerdown', onDown);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerup', onUp);
      stage.removeEventListener('pointercancel', onUp);
      stage.removeEventListener('wheel', onWheel);
    };
  }, [applyCam]);

  const stepZoom = (dir: 1 | -1) => {
    const stage = stageRef.current;
    const vw = stage ? stage.clientWidth : window.innerWidth;
    const vh = stage ? stage.clientHeight : window.innerHeight;
    const old = cam.current.s;
    const next = Math.min(
      baseScale.current * 3,
      Math.max(baseScale.current * 0.6, old * (dir === 1 ? 1.2 : 1 / 1.2)),
    );
    const wx = (vw / 2 - cam.current.x) / old;
    const wy = (vh / 2 - cam.current.y) / old;
    cam.current = { x: vw / 2 - wx * next, y: vh / 2 - wy * next, s: next };
    applyCam();
  };

  return (
    <div
      ref={stageRef}
      className="relative h-[100dvh] w-full cursor-grab select-none overflow-hidden active:cursor-grabbing"
      style={{
        touchAction: 'none',
        background: 'linear-gradient(to bottom, #1a2744, #2a1f3d 55%, #141820)',
      }}
    >
      <div
        ref={worldRef}
        className="absolute left-0 top-0 will-change-transform"
        style={{
          width: size.current.w,
          height: size.current.h,
          transformOrigin: '0 0',
        }}
      >
        <img
          src="/map-full.png"
          alt={t('map.mapAlt')}
          draggable={false}
          className="block h-full w-full object-contain"
          onLoad={(e) => {
            const img = e.currentTarget;
            size.current = {
              w: img.naturalWidth || FALLBACK.w,
              h: img.naturalHeight || FALLBACK.h,
            };
            if (worldRef.current) {
              worldRef.current.style.width = `${size.current.w}px`;
              worldRef.current.style.height = `${size.current.h}px`;
            }
            setReady(true);
            fit();
          }}
        />
      </div>

      <div className="pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2">
        <div className="rounded-full border-[3px] border-white bg-paper/90 px-5 py-2 text-center text-sm font-extrabold text-ink shadow-sticker">
          {t('map.debugHint')}
        </div>
      </div>

      <div className="absolute right-4 top-1/2 z-10 -translate-y-1/2">
        <div className="flex flex-col items-center gap-2 rounded-[24px] border-[3px] border-white bg-paper/90 p-2 shadow-sticker">
          <button
            type="button"
            onClick={() => stepZoom(1)}
            aria-label={t('map.zoomIn')}
            className="flex h-9 w-9 items-center justify-center rounded-full text-ink hover:bg-white"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => stepZoom(-1)}
            aria-label={t('map.zoomOut')}
            className="flex h-9 w-9 items-center justify-center rounded-full text-ink hover:bg-white"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={fit}
            aria-label={t('map.resetView')}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/70 text-ink hover:scale-110"
          >
            <CompassIcon className="h-5 w-5" />
          </button>
        </div>
      </div>

      {!ready && (
        <div className="absolute inset-0 grid place-items-center text-sm font-semibold text-cream/80">
          {t('common.loading')}
        </div>
      )}
    </div>
  );
}
