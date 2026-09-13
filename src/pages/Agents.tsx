import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { motion } from 'framer-motion';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/providers/auth';
import { useLanguage } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { ChatThread } from '@/components/AgentChat';

const KINDS = [
  'fitness',
  'work',
  'diet',
  'code',
  'social',
  'mixology',
  'study',
  'divination',
  'custom',
] as const;

export default function Agents() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const focusAgent = params.get('agent');
  const focusMemory = params.get('memory');
  const town = trpc.agent.listTown.useQuery(undefined, { retry: false });
  const mine = trpc.agent.listMine.useQuery(undefined, {
    enabled: !!user,
    retry: false,
  });

  return (
    <div className="mx-auto max-w-[960px] px-6 py-16">
      <p className="kicker text-coral">{t('agent.townKicker')}</p>
      <h1 className="mt-2 font-display text-[clamp(2rem,4vw,3.5rem)] font-semibold text-ink">
        {t('agent.title')}
      </h1>
      <p className="font-hand mt-1 text-2xl text-ink-soft">{t('agent.hand')}</p>

      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        {town.isError && (
          <p className="sm:col-span-3 text-sm font-semibold text-ink-soft">{t('auth.failed')}</p>
        )}
        {(town.data ?? []).map((agent) => (
          <AgentCard
            key={agent.id}
            id={agent.id}
            name={agent.name}
            kind={agent.kind}
            persona={agent.persona}
            openByDefault={focusAgent === String(agent.id)}
          />
        ))}
      </div>

      {user && <MemoryDrawer highlightId={focusMemory ? Number(focusMemory) : null} />}

      <section className="mt-16">
        <p className="kicker text-coral">{t('agent.mineKicker')}</p>
        {!user ? (
          <div className="sticker-card mt-4 p-6">
            <p className="font-semibold text-ink">{t('agent.needLogin')}</p>
            <Link to="/login" className="btn-primary mt-4 inline-flex">
              {t('agent.goSignIn')}
            </Link>
          </div>
        ) : mine.data ? (
          <div className="mt-4">
            <AgentCard
              id={mine.data.id}
              name={mine.data.name}
              kind={mine.data.kind}
              persona={mine.data.persona}
              openByDefault={focusAgent === String(mine.data.id)}
            />
            <p className="mt-3 text-sm font-semibold text-ink-soft">{t('agent.already')}</p>
          </div>
        ) : (
          <RegisterForm onDone={() => void mine.refetch()} />
        )}
      </section>
    </div>
  );
}

function AgentCard({
  id,
  name,
  kind,
  persona,
  openByDefault = false,
}: {
  id: number;
  name: string;
  kind: string;
  persona: string;
  openByDefault?: boolean;
}) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [open, setOpen] = useState(openByDefault);

  useEffect(() => {
    if (openByDefault) setOpen(true);
  }, [openByDefault]);

  return (
    <div className="sticker-card flex flex-col p-5 text-left">
      <span className="inline-flex w-fit rounded-full bg-white/70 px-2.5 py-0.5 text-[0.65rem] font-extrabold uppercase tracking-[0.12em] text-ink-soft">
        {t(`agent.kinds.${kind}`)}
      </span>
      <h2 className="mt-2 font-display text-xl font-semibold text-ink">{name}</h2>
      <p className="mt-2 flex-1 text-sm font-semibold leading-relaxed text-ink/80">{persona}</p>
      {user ? (
        <button type="button" onClick={() => setOpen((v) => !v)} className="btn-secondary mt-4 self-start px-4 py-2 text-sm">
          {t('agent.openChat')}
        </button>
      ) : (
        <Link to="/login" className="btn-secondary mt-4 self-start px-4 py-2 text-sm">
          {t('agent.goSignIn')}
        </Link>
      )}
      {open && user && <ChatThread agentId={id} />}
    </div>
  );
}

function MemoryDrawer({ highlightId }: { highlightId: number | null }) {
  const { t } = useLanguage();
  const list = trpc.agent.listMemories.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const refresh = () => void list.refetch();
  const resolve = trpc.agent.resolveProposal.useMutation({ onSuccess: refresh });
  const forget = trpc.agent.forgetMemory.useMutation({ onSuccess: refresh });

  const rows = list.data ?? [];
  const proposals = rows.filter((r) => r.status === 'proposed');
  const canon = rows.filter((r) => r.status === 'active' && r.level === 'L1');
  const insights = rows.filter((r) => r.status === 'active' && r.level !== 'L1');
  const hasRows = proposals.length + canon.length + insights.length > 0;

  return (
    <section className="mt-16">
      <p className="kicker text-coral">{t('agent.memoryTitle')}</p>
      <p className="font-hand mt-1 text-xl text-ink-soft">{t('agent.memoryHint')}</p>

      {list.isPending && !list.data ? (
        <p className="mt-4 text-sm font-semibold text-ink-soft">{t('common.loading')}</p>
      ) : list.isError && !list.data ? (
        <p className="mt-4 text-sm font-semibold text-ink-soft">{t('auth.failed')}</p>
      ) : (
        <>
      {proposals.length > 0 && (
        <div className="mt-4 grid gap-2">
          {proposals.map((row) => (
            <div
              key={row.id}
              className="sticker-card flex flex-wrap items-center gap-3 border-coral/40 p-4"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[0.65rem] font-extrabold uppercase tracking-[0.12em] text-coral">
                  {t('agent.proposalTitle')}
                </p>
                    <p className="mt-1 break-words text-sm font-semibold text-ink">{row.value}</p>
              </div>
              <button
                type="button"
                disabled={resolve.isPending}
                onClick={() => resolve.mutate({ id: row.id, accept: true })}
                className="btn-primary px-3 py-1.5 text-sm"
              >
                {t('agent.accept')}
              </button>
              <button
                type="button"
                disabled={resolve.isPending}
                    onClick={() => {
                      if (!window.confirm(t('agent.rejectConfirm'))) return;
                      resolve.mutate({ id: row.id, accept: false });
                    }}
                    className="btn-secondary px-3 py-1.5 text-sm"
              >
                {t('agent.reject')}
              </button>
            </div>
          ))}
        </div>
      )}

      {!hasRows ? (
        <p className="mt-4 text-sm font-semibold text-ink-soft">{t('agent.memoryEmpty')}</p>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <MemoryColumn
            title={t('agent.memoryCanon')}
            rows={canon}
            highlightId={highlightId}
            onForget={(id) => {
              if (!window.confirm(t('agent.forgetConfirm'))) return;
              forget.mutate({ id });
            }}
          />
          <MemoryColumn
            title={t('agent.memoryInsight')}
            rows={insights}
            highlightId={highlightId}
            onForget={(id) => {
              if (!window.confirm(t('agent.forgetConfirm'))) return;
              forget.mutate({ id });
            }}
          />
        </div>
      )}
        </>
      )}
    </section>
  );
}

type MemoryRow = { id: number; key: string; value: string; pinned: boolean };

function MemoryColumn({
  title,
  rows,
  highlightId,
  onForget,
}: {
  title: string;
  rows: MemoryRow[];
  highlightId: number | null;
  onForget: (id: number) => void;
}) {
  const { t } = useLanguage();
  if (rows.length === 0) return null;

  return (
    <div className="sticker-card p-5">
      <p className="text-[0.65rem] font-extrabold uppercase tracking-[0.12em] text-ink-soft">
        {title}
      </p>
      <ul className="mt-3 space-y-2">
        {rows.map((row) => (
          <li
            key={row.id}
            className={cn(
              'flex items-start gap-2 rounded-xl px-1 py-0.5',
              highlightId === row.id && 'ring-2 ring-coral',
            )}
          >
            <span className="min-w-0 flex-1 break-words text-sm font-semibold text-ink/85">
              <span className="text-ink-soft">{row.key.split(':')[1] ?? row.key}</span> · {row.value}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onForget(row.id);
              }}
              className="shrink-0 text-xs font-bold text-ink-soft underline decoration-dotted"
            >
              {t('agent.forget')}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RegisterForm({ onDone }: { onDone: () => void }) {
  const { t } = useLanguage();
  const register = trpc.agent.register.useMutation();
  const [kind, setKind] = useState<(typeof KINDS)[number]>('custom');
  const [handle, setHandle] = useState('');
  const [name, setName] = useState('');
  const [persona, setPersona] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await register.mutateAsync({ kind, handle, name, persona });
      onDone();
    } catch (err) {
      const message = (err as { message?: string } | null)?.message;
      if (message === 'slug_reserved') setError(t('agent.slugReserved'));
      else if (message === 'slug_taken') setError(t('agent.slugTaken'));
      else if (message === 'already_registered') setError(t('agent.already'));
      else setError(t('auth.failed'));
    }
  }

  return (
    <motion.form
      initial={{ y: 16, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      onSubmit={(e) => void submit(e)}
      className="sticker-card mt-4 grid gap-3 p-6"
    >
      <h2 className="font-display text-xl font-semibold text-ink">{t('agent.registerTitle')}</h2>
      <label className="text-left">
        <span className="text-[0.72rem] font-extrabold uppercase tracking-[0.14em] text-ink-soft">
          {t('agent.kind')}
        </span>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])}
          className="mt-1 w-full rounded-2xl border-[3px] border-white bg-cream px-4 py-2.5 font-bold text-ink outline-none"
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`agent.kinds.${k}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="text-left">
        <span className="text-[0.72rem] font-extrabold uppercase tracking-[0.14em] text-ink-soft">
          {t('agent.handle')}
        </span>
        <input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          required
          pattern="[a-z0-9-]{2,24}"
          className="mt-1 w-full rounded-2xl border-[3px] border-white bg-cream px-4 py-2.5 font-bold text-ink outline-none"
        />
        <span className="mt-1 block text-xs font-semibold text-ink-soft">{t('agent.handleHint')}</span>
      </label>
      <label className="text-left">
        <span className="text-[0.72rem] font-extrabold uppercase tracking-[0.14em] text-ink-soft">
          {t('agent.name')}
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={80}
          className="mt-1 w-full rounded-2xl border-[3px] border-white bg-cream px-4 py-2.5 font-bold text-ink outline-none"
        />
      </label>
      <label className="text-left">
        <span className="text-[0.72rem] font-extrabold uppercase tracking-[0.14em] text-ink-soft">
          {t('agent.persona')}
        </span>
        <textarea
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
          required
          rows={3}
          maxLength={2000}
          className="mt-1 w-full rounded-2xl border-[3px] border-white bg-cream px-4 py-2.5 font-bold text-ink outline-none"
        />
      </label>
      {error && <p className="text-sm font-bold text-coral">{error}</p>}
      <button type="submit" disabled={register.isPending} className="btn-primary justify-self-start">
        {register.isPending ? t('common.loading') : t('agent.registerCta')}
      </button>
    </motion.form>
  );
}
