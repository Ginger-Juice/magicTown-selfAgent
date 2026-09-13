import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { motion, useReducedMotion } from 'framer-motion';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/providers/auth';
import { useLanguage } from '@/lib/i18n';
import { byId } from '@/lib/landmarks';
import { cn } from '@/lib/utils';
import { EASE_SQUASH } from './presets';
import { TapeStrip } from './bits';

type TrailKind = 'open_landmark' | 'open_chat' | 'chat_turn' | 'memory_l2' | 'memory_l1';

const KIND_BAR: Record<TrailKind, string> = {
  open_landmark: 'bg-peach',
  open_chat: 'bg-ink',
  chat_turn: 'bg-ink/55',
  memory_l2: 'bg-seafoam',
  memory_l1: 'bg-coral',
};

const NODE_FILL: Record<string, string> = {
  landmark: '#FFB37E',
  agent: '#4A4470',
  keyword: '#5EC2BC',
  topic: '#9B8CE8',
};

function landmarkName(id: string | null, t: (path: string) => string): string | null {
  if (!id) return null;
  const lm = byId(id);
  return lm ? t(lm.nameKey) : id;
}

function eventHref(event: {
  agentId: number | null;
  memoryId: number | null;
}): string | null {
  if (event.agentId != null) return `/agents?agent=${event.agentId}`;
  if (event.memoryId != null) return `/agents?memory=${event.memoryId}`;
  return null;
}

function eventCopy(
  event: {
    kind: TrailKind;
    agentName: string | null;
    landmarkId: string | null;
    memoryKey: string | null;
    memoryValue: string | null;
  },
  t: (path: string, vars?: Record<string, string | number>) => string,
): { title: string; detail: string } {
  const place = landmarkName(event.landmarkId, t);
  const who = event.agentName;
  const memo = event.memoryValue ?? event.memoryKey ?? '';
  switch (event.kind) {
    case 'open_landmark':
      return {
        title: t('journal.trail.kinds.open_landmark'),
        detail: place ?? '',
      };
    case 'open_chat':
      return {
        title: t('journal.trail.kinds.open_chat'),
        detail: [who, place].filter(Boolean).join(' · '),
      };
    case 'chat_turn':
      return {
        title: t('journal.trail.kinds.chat_turn'),
        detail: [who, place].filter(Boolean).join(' · '),
      };
    case 'memory_l2':
      return {
        title: t('journal.trail.kinds.memory_l2'),
        detail: memo,
      };
    case 'memory_l1':
      return {
        title: t('journal.trail.kinds.memory_l1'),
        detail: memo,
      };
  }
}

export default function TrailLedger() {
  const { t, lang } = useLanguage();
  const { user, loading } = useAuth();
  const reduced = useReducedMotion();
  const mine = trpc.trail.mine.useQuery(undefined, {
    enabled: !!user,
    retry: false,
  });
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const selectedEventIds = useMemo(() => {
    const node = mine.data?.nodes.find((n) => n.id === selectedNode);
    return new Set(node?.eventIds ?? []);
  }, [mine.data, selectedNode]);

  const days = useMemo(() => {
    const events = mine.data?.events ?? [];
    const locale = lang === 'zh' ? 'zh-CN' : 'en-US';
    const groups: { key: string; label: string; events: typeof events }[] = [];
    const index = new Map<string, number>();
    for (const event of events) {
      const d = new Date(event.createdAt);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      let slot = index.get(key);
      if (slot == null) {
        slot = groups.length;
        index.set(key, slot);
        groups.push({
          key,
          label: d.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' }),
          events: [],
        });
      }
      groups[slot].events.push(event);
    }
    return groups;
  }, [mine.data, lang]);

  return (
    <section className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6 md:py-24" aria-labelledby="trail-title">
      <motion.div
        initial={{ y: 24, opacity: 0 }}
        whileInView={{ y: 0, opacity: 1 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ duration: 0.55, ease: EASE_SQUASH }}
      >
        <p className="kicker text-coral">{t('journal.trail.kicker')}</p>
        <h2
          id="trail-title"
          className="mt-2 font-display text-[clamp(2rem,4vw,3.5rem)] font-semibold leading-[1.05] text-ink"
        >
          {t('journal.trail.title')}
        </h2>
        <p className="font-hand mt-2 text-2xl text-ink-soft">{t('journal.trail.hand')}</p>
      </motion.div>

      {loading ? (
        <p className="mt-8 text-sm font-semibold text-ink-soft">{t('common.loading')}</p>
      ) : !user ? (
        <div className="relative mt-8 max-w-xl">
          <TapeStrip className="-top-2 left-8 h-4 w-24 rotate-[-8deg]" />
          <div className="sticker-card p-6">
            <p className="text-sm font-semibold text-ink/80">{t('journal.trail.needLogin')}</p>
            <Link to="/login" className="btn-secondary mt-4 inline-flex px-4 py-2 text-sm">
              {t('journal.trail.goSignIn')}
            </Link>
          </div>
        </div>
      ) : mine.isError ? (
        <p className="mt-8 text-sm font-semibold text-ink-soft">{t('auth.failed')}</p>
      ) : mine.isLoading ? (
        <p className="mt-8 text-sm font-semibold text-ink-soft">{t('common.loading')}</p>
      ) : (mine.data?.events.length ?? 0) === 0 ? (
        <p className="mt-8 text-sm font-semibold text-ink-soft">{t('journal.trail.empty')}</p>
      ) : (
        <div className="mt-10 grid gap-10 lg:grid-cols-[3fr_2fr] lg:gap-12">
          <ol className="space-y-8">
            {days.map((day) => (
              <li key={day.key}>
                <p className="text-[0.65rem] font-extrabold uppercase tracking-[0.14em] text-ink-soft">
                  {day.label}
                </p>
                <ol className="mt-3 space-y-2">
                  {day.events.map((event) => {
                    const copy = eventCopy(event, t);
                    const href = eventHref(event);
                    const active = selectedEventIds.has(event.id);
                    const body = (
                      <>
                        <span
                          aria-hidden
                          className={cn('mt-1 h-8 w-1.5 shrink-0 rounded-full', KIND_BAR[event.kind])}
                        />
                        <span className="min-w-0 flex-1 text-left">
                          <span className="block text-[0.65rem] font-extrabold uppercase tracking-[0.12em] text-ink-soft">
                            {copy.title}
                          </span>
                          <span
                            className={cn(
                              'mt-0.5 block text-sm font-semibold text-ink/85',
                              event.kind === 'memory_l1' && 'font-extrabold',
                            )}
                          >
                            {copy.detail}
                          </span>
                        </span>
                      </>
                    );
                    const cls = cn(
                      'flex w-full items-start gap-3 rounded-[22px] border-[3px] bg-paper px-3 py-2.5 shadow-sticker transition',
                      active ? 'border-coral' : 'border-white hover:border-peach/80',
                    );
                    return (
                      <li key={event.id}>
                        {href ? (
                          <Link to={href} className={cls}>
                            {body}
                          </Link>
                        ) : (
                          <div className={cls}>{body}</div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </li>
            ))}
          </ol>

          <div className={reduced ? undefined : 'lg:sticky lg:top-24'}>
            <p className="text-[0.65rem] font-extrabold uppercase tracking-[0.14em] text-ink-soft">
              {t('journal.trail.graphTitle')}
            </p>
            <p className="font-hand mt-1 text-xl text-ink-soft">{t('journal.trail.graphHand')}</p>
            <KeywordGraph
              nodes={mine.data?.nodes ?? []}
              edges={mine.data?.edges ?? []}
              selected={selectedNode}
              onSelect={setSelectedNode}
              t={t}
            />
          </div>
        </div>
      )}
    </section>
  );
}

type GraphNode = {
  id: string;
  type: 'landmark' | 'agent' | 'keyword' | 'topic';
  label: string;
  weight: number;
  eventIds: number[];
  promoted: boolean;
};

type GraphEdge = {
  id: string;
  from: string;
  to: string;
  kind: string;
  weight: number;
};

function layout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number,
  height: number,
): { x: number; y: number }[] {
  const n = nodes.length;
  const pos = nodes.map((_, i) => {
    const a = (i / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2;
    return {
      x: width / 2 + Math.cos(a) * Math.min(width, height) * 0.28,
      y: height / 2 + Math.sin(a) * Math.min(width, height) * 0.28,
      vx: 0,
      vy: 0,
    };
  });
  const index = new Map(nodes.map((node, i) => [node.id, i]));
  for (let tick = 0; tick < 80; tick += 1) {
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        let dx = pos[j].x - pos[i].x;
        let dy = pos[j].y - pos[i].y;
        const dist = Math.hypot(dx, dy) || 0.01;
        const force = 700 / (dist * dist);
        dx = (dx / dist) * force;
        dy = (dy / dist) * force;
        pos[i].vx -= dx;
        pos[i].vy -= dy;
        pos[j].vx += dx;
        pos[j].vy += dy;
      }
    }
    for (const edge of edges) {
      const ia = index.get(edge.from);
      const ib = index.get(edge.to);
      if (ia == null || ib == null) continue;
      const dx = pos[ib].x - pos[ia].x;
      const dy = pos[ib].y - pos[ia].y;
      const dist = Math.hypot(dx, dy) || 0.01;
      const f = (dist - 88) * 0.025;
      pos[ia].vx += (dx / dist) * f;
      pos[ia].vy += (dy / dist) * f;
      pos[ib].vx -= (dx / dist) * f;
      pos[ib].vy -= (dy / dist) * f;
    }
    for (const p of pos) {
      p.vx += (width / 2 - p.x) * 0.012;
      p.vy += (height / 2 - p.y) * 0.012;
      p.vx *= 0.72;
      p.vy *= 0.72;
      p.x = Math.min(width - 28, Math.max(28, p.x + p.vx));
      p.y = Math.min(height - 28, Math.max(28, p.y + p.vy));
    }
  }
  return pos.map(({ x, y }) => ({ x, y }));
}

function KeywordGraph({
  nodes,
  edges,
  selected,
  onSelect,
  t,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  t: (path: string) => string;
}) {
  const width = 520;
  const height = 380;
  const pos = useMemo(() => layout(nodes, edges, width, height), [nodes, edges]);
  const index = useMemo(() => new Map(nodes.map((n, i) => [n.id, i])), [nodes]);

  if (nodes.length === 0) {
    return <p className="mt-4 text-sm font-semibold text-ink-soft">{t('journal.trail.graphEmpty')}</p>;
  }

  const caption = (node: GraphNode) => {
    if (node.type === 'landmark') return landmarkName(node.label, t) ?? node.label;
    return node.label;
  };

  return (
    <div className="relative mt-4 overflow-hidden rounded-[28px] border-[3px] border-white bg-cream/80 shadow-sticker">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={t('journal.trail.graphTitle')}>
        {edges.map((edge) => {
          const a = index.get(edge.from);
          const b = index.get(edge.to);
          if (a == null || b == null) return null;
          const hot = selected === edge.from || selected === edge.to;
          return (
            <line
              key={edge.id}
              x1={pos[a].x}
              y1={pos[a].y}
              x2={pos[b].x}
              y2={pos[b].y}
              stroke={edge.kind === 'temporal' ? '#5EC2BC' : '#4A4470'}
              strokeOpacity={hot ? 0.55 : 0.18}
              strokeWidth={edge.kind === 'temporal' ? 2.4 : 1.4}
            />
          );
        })}
        {nodes.map((node, i) => {
          const r = 9 + Math.sqrt(Math.max(node.weight, 1)) * 3.2;
          const fill = NODE_FILL[node.type] ?? '#4A4470';
          const active = selected === node.id;
          return (
            <g
              key={node.id}
              transform={`translate(${pos[i].x},${pos[i].y})`}
              className="cursor-pointer"
              onClick={() => onSelect(active ? null : node.id)}
            >
              <circle
                r={r}
                fill={fill}
                stroke={active || node.promoted ? '#FF9B9B' : '#fff'}
                strokeWidth={active ? 4 : 2.5}
              />
              <text
                y={r + 12}
                textAnchor="middle"
                className="fill-ink text-[9px] font-extrabold"
                style={{ fontFamily: 'Nunito, sans-serif' }}
              >
                {caption(node).slice(0, 12)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
