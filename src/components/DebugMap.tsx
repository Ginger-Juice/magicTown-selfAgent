import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import gsap from 'gsap';
import { Check, Compass as CompassIcon, Copy, Minus, Pencil, Plus, RotateCcw } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';
import { useTown } from '@/lib/town';
import { byId } from '@/lib/landmarks';
import { useRecordLandmark } from '@/hooks/useRecordLandmark';
import LandmarkChat from './LandmarkChat';
import { cn } from '@/lib/utils';

const FALLBACK = { w: 1600, h: 1200 };
const FOOT = 0.8;
const STORAGE_KEY = 'st-building-layout-v1';

/** Footprint centers as 0–1 of the empty map; w is width as a fraction of map width. */
const DEBUG_BUILDINGS = [
  { id: 'town-hall', src: '/b-townhall.png?v=pads', x: 0.53, y: 0.48, w: 0.12 },
  { id: 'theater', src: '/b-theater.png?v=regen3', x: 0.32, y: 0.6, w: 0.12 },
  { id: 'livehouse', src: '/b-livehouse.png?v=pads', x: 0.47, y: 0.65, w: 0.11 },
  { id: 'store', src: '/b-store.png?v=pads', x: 0.7, y: 0.76, w: 0.09 },
  { id: 'gallery', src: '/b-gallery.png?v=map1', x: 0.7, y: 0.64, w: 0.11 },
  { id: 'coffee', src: '/b-coffee.png?v=map1', x: 0.6, y: 0.48, w: 0.1 },
  { id: 'radio', src: '/b-radio.png?v=pads', x: 0.26, y: 0.42, w: 0.07 },
  { id: 'library', src: '/b-library.png?v=pads', x: 0.48, y: 0.33, w: 0.07 },
  { id: 'design-lab', src: '/b-gallery-lab.png?v=pair8', x: 0.74, y: 0.6, w: 0.2 },
  { id: 'apple-cottage', src: '/b-apple.png?v=pads', x: 0.58, y: 0.67, w: 0.1 },
  { id: 'magic-house', src: '/b-magic.png?v=pads', x: 0.52, y: 0.36, w: 0.07 },
  { id: 'hotel', src: '/b-hotel.png?v=regen4', x: 0.66, y: 0.4, w: 0.13 },
  { id: 'villas', src: '/b-villas.png?v=map1', x: 0.4, y: 0.44, w: 0.11 },
  { id: 'windbell-isle', src: '/i-pavilion.png?v=regen5', x: 0.76, y: 0.34, w: 0.07 },
] as const;

type BuildingId = (typeof DEBUG_BUILDINGS)[number]['id'];

type LayoutRow = {
  id: BuildingId;
  src: string;
  x: number;
  y: number;
  w: number;
};

const FIT_KEY: Partial<Record<BuildingId, string>> = {
  villas: 'map.fit.villas',
  radio: 'map.fit.radio',
  hotel: 'map.fit.hotel',
  'apple-cottage': 'map.fit.appleCottage',
  'windbell-isle': 'map.fit.windbellIsle',
};

interface Cam {
  x: number;
  y: number;
  s: number;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

const LAYOUT_VERSION = 4;
const HIDDEN_SPRITES = new Set<BuildingId>(['gallery']);
const PAIR_HOST: Partial<Record<BuildingId, BuildingId>> = { gallery: 'design-lab' };
const PAIR_SPLIT = 0.58;

function swapCafeLab(
  bySaved: Map<string, { id: string; x: number; y: number; w: number }>,
) {
  const cafe = bySaved.get('coffee');
  const lab = bySaved.get('design-lab');
  if (!cafe || !lab) return;
  bySaved.set('coffee', { ...lab, id: 'coffee' });
  bySaved.set('design-lab', { ...cafe, id: 'design-lab' });
}

function mergeGalleryLab(
  bySaved: Map<string, { id: string; x: number; y: number; w: number }>,
) {
  const gal = bySaved.get('gallery');
  const lab = bySaved.get('design-lab');
  if (!gal || !lab) return;
  const left = Math.min(gal.x - gal.w / 2, lab.x - lab.w / 2);
  const right = Math.max(gal.x + gal.w / 2, lab.x + lab.w / 2);
  bySaved.set('design-lab', {
    id: 'design-lab',
    x: clamp((left + right) / 2, 0.02, 0.98),
    y: clamp((gal.y + lab.y) / 2, 0.02, 0.98),
    w: clamp(right - left, 0.12, 0.32),
  });
}

function pairTarget(hostId: BuildingId, clientX: number, el: HTMLElement): BuildingId {
  if (hostId !== 'design-lab') return hostId;
  const rect = el.getBoundingClientRect();
  const t = (clientX - rect.left) / Math.max(rect.width, 1);
  return t < PAIR_SPLIT ? 'gallery' : 'design-lab';
}

function loadLayout(): LayoutRow[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEBUG_BUILDINGS.map((b) => ({ ...b }));
    const parsed = JSON.parse(raw) as {
      version?: number;
      buildings?: Array<{ id: string; x: number; y: number; w: number }>;
    };
    const bySaved = new Map((parsed.buildings ?? []).map((row) => [row.id, row]));
    // v2 swapped the two footprints; put them back. Functions stay remapped in agents/i18n.
    if (parsed.version === 2) swapCafeLab(bySaved);
    if ((parsed.version ?? 1) < 4) mergeGalleryLab(bySaved);
    return DEBUG_BUILDINGS.map((b) => {
      const saved = bySaved.get(b.id);
      if (!saved) return { ...b };
      return {
        ...b,
        x: clamp(saved.x, 0.02, 0.98),
        y: clamp(saved.y, 0.02, 0.98),
        w: clamp(saved.w, 0.03, 0.35),
      };
    });
  } catch {
    return DEBUG_BUILDINGS.map((b) => ({ ...b }));
  }
}

function saveLayout(rows: LayoutRow[]) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: LAYOUT_VERSION,
        buildings: rows.map(({ id, x, y, w }) => ({ id, x, y, w })),
      }),
    );
  } catch {
    /* ignore */
  }
}

function punchBlack(src: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      if (!ctx) {
        resolve(src);
        return;
      }
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height);
      const px = data.data;
      const alreadyCut = px[3] < 10 || px[(c.width - 1) * 4 + 3] < 10;
      if (alreadyCut) {
        resolve(src);
        return;
      }
      // Only clear black that touches the frame, so dark roofs and brick stay.
      const w = c.width;
      const h = c.height;
      const seen = new Uint8Array(w * h);
      const stack: number[] = [];
      const isBg = (i: number) => px[i] < 16 && px[i + 1] < 16 && px[i + 2] < 16;
      const visit = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= w || y >= h) return;
        const idx = y * w + x;
        if (seen[idx]) return;
        seen[idx] = 1;
        const i = idx * 4;
        if (!isBg(i)) return;
        px[i + 3] = 0;
        stack.push(idx);
      };
      for (let x = 0; x < w; x++) {
        visit(x, 0);
        visit(x, h - 1);
      }
      for (let y = 0; y < h; y++) {
        visit(0, y);
        visit(w - 1, y);
      }
      while (stack.length) {
        const idx = stack.pop()!;
        const x = idx % w;
        const y = (idx / w) | 0;
        visit(x + 1, y);
        visit(x - 1, y);
        visit(x, y + 1);
        visit(x, y - 1);
      }
      ctx.putImageData(data, 0, 0);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => resolve(src);
    img.src = src;
  });
}

function Cutout({ src, alt, lift }: { src: string; alt: string; lift: boolean }) {
  const [url, setUrl] = useState(src);
  useEffect(() => {
    let alive = true;
    void punchBlack(src).then((next) => {
      if (alive) setUrl(next);
    });
    return () => {
      alive = false;
    };
  }, [src]);
  return (
    <img
      src={url}
      alt={alt}
      draggable={false}
      className={cn(
        'pointer-events-none relative w-full',
        lift && 'transition-transform duration-300 group-hover:-translate-y-2 group-hover:scale-[1.04]',
      )}
    />
  );
}

/** Pan/zoom shell: empty terrain + landmark cutouts. */
export default function DebugMap() {
  const { t } = useLanguage();
  const { setMapDetailOpen } = useTown();
  const recordLandmark = useRecordLandmark();
  const stageRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const cam = useRef<Cam>({ x: 0, y: 0, s: 1 });
  const size = useRef(FALLBACK);
  const baseScale = useRef(1);
  const dragMoved = useRef(false);
  const priorView = useRef<Cam | null>(null);
  const layoutRef = useRef<LayoutRow[]>([]);
  const editDrag = useRef<{
    id: BuildingId;
    mode: 'move' | 'resize';
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origW: number;
  } | null>(null);

  const [ready, setReady] = useState(false);
  const [world, setWorld] = useState(FALLBACK);
  const [selectedId, setSelectedId] = useState<BuildingId | null>(null);
  const [hoveredId, setHoveredId] = useState<BuildingId | null>(null);
  const [editing, setEditing] = useState(false);
  const [overlay, setOverlay] = useState(false);
  const [editId, setEditId] = useState<BuildingId | null>(null);
  const [layout, setLayout] = useState<LayoutRow[]>(() => DEBUG_BUILDINGS.map((b) => ({ ...b })));
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const next = loadLayout();
    setLayout(next);
    saveLayout(next);
  }, []);

  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  const applyCam = useCallback(() => {
    const el = worldRef.current;
    if (!el) return;
    const { x, y, s } = cam.current;
    el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${s})`;
  }, []);

  const tweenCam = useCallback(
    (to: Cam, duration = 0.9) => {
      gsap.killTweensOf(cam.current);
      return new Promise<void>((resolve) => {
        gsap.to(cam.current, {
          ...to,
          duration,
          ease: 'power3.inOut',
          onUpdate: applyCam,
          onComplete: resolve,
        });
      });
    },
    [applyCam],
  );

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

  const buildingCam = useCallback((b: LayoutRow): Cam => {
    const stage = stageRef.current;
    const vw = stage ? stage.clientWidth : window.innerWidth;
    const vh = stage ? stage.clientHeight : window.innerHeight;
    const width = size.current.w * b.w;
    const cx = size.current.w * b.x;
    const cy = size.current.h * b.y - width * 0.2;
    const s = Math.min(baseScale.current * 2.4, Math.max(baseScale.current * 1.35, baseScale.current * 1.8));
    return {
      x: vw / 2 - cx * s,
      y: vh * 0.42 - cy * s,
      s,
    };
  }, []);

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
      if (selectedId) return;
      if (editDrag.current) return;
      if ((e.target as HTMLElement | null)?.closest?.('[data-building],[data-hud]')) return;
      dragging = true;
      dragMoved.current = false;
      sx = e.clientX;
      sy = e.clientY;
      startX = cam.current.x;
      startY = cam.current.y;
    };

    const onMove = (e: PointerEvent) => {
      const drag = editDrag.current;
      if (drag) {
        const dx = (e.clientX - drag.startX) / cam.current.s / size.current.w;
        const dy = (e.clientY - drag.startY) / cam.current.s / size.current.h;
        setLayout((prev) =>
          prev.map((row) => {
            if (row.id !== drag.id) return row;
            if (drag.mode === 'resize') {
              return { ...row, w: clamp(drag.origW + dx * 1.4, 0.03, 0.35) };
            }
            return {
              ...row,
              x: clamp(drag.origX + dx, 0.02, 0.98),
              y: clamp(drag.origY + dy, 0.02, 0.98),
            };
          }),
        );
        dragMoved.current = true;
        return;
      }
      if (!dragging) return;
      const mx = e.clientX - sx;
      const my = e.clientY - sy;
      if (Math.abs(mx) + Math.abs(my) > 6) {
        if (!dragMoved.current) {
          try {
            stage.setPointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
        }
        dragMoved.current = true;
      }
      cam.current.x = startX + mx;
      cam.current.y = startY + my;
      applyCam();
    };

    const onUp = () => {
      if (editDrag.current) {
        saveLayout(layoutRef.current);
        editDrag.current = null;
      }
      dragging = false;
      window.setTimeout(() => {
        dragMoved.current = false;
      }, 50);
    };

    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('[role="dialog"]')) return;
      e.preventDefault();
      if (selectedId) return;
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
  }, [applyCam, selectedId]);

  const openBuilding = useCallback(
    (id: BuildingId) => {
      const hostId = PAIR_HOST[id] ?? id;
      const b =
        layoutRef.current.find((row) => row.id === hostId) ??
        layoutRef.current.find((row) => row.id === id);
      if (!b) return;
      if (!selectedId) priorView.current = { ...cam.current };
      setSelectedId(id);
      setHoveredId(null);
      setMapDetailOpen(true);
      recordLandmark(id);
      void tweenCam(buildingCam(b), 0.85);
    },
    [buildingCam, recordLandmark, selectedId, setMapDetailOpen, tweenCam],
  );

  const closeBuilding = useCallback(() => {
    setSelectedId(null);
    setMapDetailOpen(false);
    const back = priorView.current;
    priorView.current = null;
    if (back) void tweenCam(back, 0.7);
    else fit();
  }, [fit, setMapDetailOpen, tweenCam]);

  const nextBuilding = useCallback(() => {
    if (!selectedId) return;
    const idx = layout.findIndex((b) => b.id === selectedId);
    const next = layout[(idx + 1) % layout.length];
    openBuilding(next.id);
  }, [layout, openBuilding, selectedId]);

  useEffect(() => {
    if (!selectedId && !editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedId) closeBuilding();
        else if (editing) setEditId(null);
        return;
      }
      if (!editing || !editId) return;
      if (e.target instanceof HTMLInputElement) return;
      const step = e.shiftKey ? 0.01 : 0.003;
      setLayout((prev) => {
        const next = prev.map((row) => {
          if (row.id !== editId) return row;
          if (e.key === 'ArrowLeft') return { ...row, x: clamp(row.x - step, 0.02, 0.98) };
          if (e.key === 'ArrowRight') return { ...row, x: clamp(row.x + step, 0.02, 0.98) };
          if (e.key === 'ArrowUp') return { ...row, y: clamp(row.y - step, 0.02, 0.98) };
          if (e.key === 'ArrowDown') return { ...row, y: clamp(row.y + step, 0.02, 0.98) };
          if (e.key === '[' || e.key === '-') return { ...row, w: clamp(row.w - step, 0.03, 0.35) };
          if (e.key === ']' || e.key === '=' || e.key === '+') return { ...row, w: clamp(row.w + step, 0.03, 0.35) };
          return row;
        });
        saveLayout(next);
        return next;
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeBuilding, editId, editing, selectedId]);

  const stepZoom = (dir: 1 | -1) => {
    if (selectedId) return;
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
    void tweenCam({ x: vw / 2 - wx * next, y: vh / 2 - wy * next, s: next }, 0.35);
  };

  const startEditDrag = (id: BuildingId, mode: 'move' | 'resize', e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const row = layout.find((b) => b.id === id);
    if (!row) return;
    setEditId(id);
    dragMoved.current = false;
    editDrag.current = {
      id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      origX: row.x,
      origY: row.y,
      origW: row.w,
    };
  };

  const copyJson = async () => {
    const payload = JSON.stringify(
      layout.map(({ id, x, y, w }) => ({
        id,
        x: Number(x.toFixed(4)),
        y: Number(y.toFixed(4)),
        w: Number(w.toFixed(4)),
      })),
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore */
    }
  };

  const resetLayout = () => {
    const fresh = DEBUG_BUILDINGS.map((b) => ({ ...b }));
    setLayout(fresh);
    saveLayout(fresh);
  };

  const selected = editId ? layout.find((b) => b.id === editId) : undefined;
  const hovered = hoveredId ? byId(hoveredId) : undefined;
  const mismatches = useMemo(() => layout.filter((b) => FIT_KEY[b.id]), [layout]);

  return (
    <div
      ref={stageRef}
      className="relative h-[100dvh] w-full select-none overflow-hidden"
      style={{
        touchAction: 'none',
        background: 'linear-gradient(to bottom, #1a2744, #2a1f3d 55%, #141820)',
      }}
    >
      <div
        ref={worldRef}
        className="absolute left-0 top-0 will-change-transform"
        style={{
          width: world.w,
          height: world.h,
          transformOrigin: '0 0',
        }}
      >
        <img
          src="/map-base-ext.png?v=pads"
          alt={t('map.mapAlt')}
          draggable={false}
          className="block h-full w-full object-contain"
          onLoad={(e) => {
            const img = e.currentTarget;
            const next = {
              w: img.naturalWidth || FALLBACK.w,
              h: img.naturalHeight || FALLBACK.h,
            };
            size.current = next;
            setWorld(next);
            setReady(true);
            fit();
          }}
        />
        {overlay && (
          <img
            src="/map-full-orig.png"
            alt=""
            draggable={false}
            className="pointer-events-none absolute inset-0 h-full w-full object-fill mix-blend-lighten opacity-55"
          />
        )}
        {layout.map((b) => {
          if (HIDDEN_SPRITES.has(b.id)) return null;
          const width = world.w * b.w;
          const left = world.w * b.x - width / 2;
          const top = world.h * b.y - width * FOOT;
          const pairMate = b.id === 'design-lab' ? 'gallery' : undefined;
          const active = selectedId === b.id || (pairMate != null && selectedId === pairMate);
          const editingThis = editing && editId === b.id;
          const mismatch = Boolean(FIT_KEY[b.id]);
          return (
            <div
              key={b.id}
              data-building={b.id}
              className={cn(
                'group absolute bg-transparent p-0 outline-none',
                editing ? 'cursor-move' : 'cursor-pointer',
                selectedId && !active && 'opacity-40',
                editingThis && 'ring-2 ring-butter ring-offset-2 ring-offset-transparent',
              )}
              style={{
                left,
                top,
                width,
                zIndex: 10 + Math.round(b.y * 100) + (editingThis ? 80 : 0),
              }}
              onPointerDown={(e) => {
                if (!editing) return;
                startEditDrag(b.id, 'move', e);
              }}
              onMouseMove={(e) => {
                if (selectedId || editing) return;
                setHoveredId(pairTarget(b.id, e.clientX, e.currentTarget));
              }}
              onMouseLeave={() => setHoveredId((cur) => (cur === b.id || cur === pairMate ? null : cur))}
              onClick={(e) => {
                if (dragMoved.current) return;
                if (editing) {
                  setEditId(b.id);
                  return;
                }
                if (selectedId) return;
                openBuilding(pairTarget(b.id, e.clientX, e.currentTarget));
              }}
            >
              <Cutout src={b.src} alt="" lift={!editing} />
              {editing && mismatch && (
                <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-white bg-coral" />
              )}
              {editingThis && (
                <button
                  type="button"
                  data-hud
                  aria-label="Resize"
                  className="absolute -bottom-1 -right-1 h-4 w-4 cursor-nwse-resize rounded-sm border-2 border-ink bg-butter"
                  onPointerDown={(e) => startEditDrag(b.id, 'resize', e)}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2">
        <div className="rounded-full border-[3px] border-white bg-paper/90 px-5 py-2 text-center text-sm font-extrabold text-ink shadow-sticker">
          {editing
            ? t('map.editHint')
            : hovered && !selectedId
              ? t(hovered.nameKey)
              : t('map.debugHint')}
        </div>
      </div>

      <div data-hud className="absolute left-4 top-24 z-10 w-[min(20rem,calc(100vw-2rem))]">
        <div className="rounded-[24px] border-[3px] border-white bg-paper/92 p-3 shadow-sticker backdrop-blur">
          <button
            type="button"
            onClick={() => {
              setEditing((on) => !on);
              setEditId(null);
              if (selectedId) closeBuilding();
            }}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border-[3px] border-ink bg-butter px-3 py-2 text-sm font-extrabold text-ink"
          >
            {editing ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
            {editing ? t('map.editOff') : t('map.editOn')}
          </button>

          {editing && (
            <div className="mt-3 space-y-3 text-sm font-semibold text-ink">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={overlay}
                  onChange={(e) => setOverlay(e.target.checked)}
                />
                {t('map.overlay')}
              </label>

              {selected && (
                <div className="rounded-2xl bg-cream/80 p-2">
                  <p className="font-extrabold">
                    {t('map.selected')}: {t(byId(selected.id)?.nameKey ?? selected.id)}
                  </p>
                  <p className="mt-1 font-mono text-xs">
                    x {selected.x.toFixed(3)} · y {selected.y.toFixed(3)} · w {selected.w.toFixed(3)}
                  </p>
                  {FIT_KEY[selected.id] && (
                    <p className="mt-2 text-xs font-bold text-coral">{t(FIT_KEY[selected.id]!)}</p>
                  )}
                </div>
              )}

              <div>
                <p className="mb-1 font-extrabold">{t('map.mismatchTitle')}</p>
                <ul className="max-h-40 space-y-1 overflow-auto text-xs">
                  {mismatches.map((b) => (
                    <li key={b.id}>
                      <button
                        type="button"
                        className="w-full rounded-lg px-2 py-1 text-left hover:bg-white"
                        onClick={() => setEditId(b.id)}
                      >
                        <span className="font-extrabold">{t(byId(b.id)?.nameKey ?? b.id)}</span>
                        <span className="mt-0.5 block font-semibold text-ink-soft">{t(FIT_KEY[b.id]!)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void copyJson()}
                  className="flex flex-1 items-center justify-center gap-1 rounded-xl border-[3px] border-ink bg-white px-2 py-1.5 text-xs font-extrabold"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? t('map.copied') : t('map.copyLayout')}
                </button>
                <button
                  type="button"
                  onClick={resetLayout}
                  className="flex items-center justify-center gap-1 rounded-xl border-[3px] border-ink bg-white px-2 py-1.5 text-xs font-extrabold"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t('map.resetLayout')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div data-hud className="absolute right-4 top-1/2 z-10 -translate-y-1/2">
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
            onClick={() => {
              if (selectedId) closeBuilding();
              else fit();
            }}
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

      <AnimatePresence>
        {selectedId && !editing && (
          <LandmarkChat
            key={selectedId}
            landmarkId={selectedId}
            onClose={closeBuilding}
            onNext={nextBuilding}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
