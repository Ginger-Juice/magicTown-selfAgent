import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/providers/auth';
import { useLanguage } from '@/lib/i18n';
import { byId } from '@/lib/landmarks';
import { usePauseSmoothScroll } from '@/lib/smoothScroll';
import { cn } from '@/lib/utils';
import { ChatThread } from './AgentChat';

export default function LandmarkChat({
  landmarkId,
  onClose,
  onNext,
}: {
  landmarkId: string;
  onClose: () => void;
  onNext?: () => void;
}) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const landmark = byId(landmarkId);
  const town = trpc.agent.listTown.useQuery(undefined, { retry: false });
  const residents = useMemo(
    () => (town.data ?? []).filter((a) => a.landmarkId === landmarkId),
    [town.data, landmarkId],
  );
  const [agentId, setAgentId] = useState<number | null>(null);
  const active = residents.find((a) => a.id === agentId) ?? residents[0] ?? null;

  usePauseSmoothScroll(true);

  useEffect(() => {
    if (!residents.length) {
      setAgentId(null);
      return;
    }
    if (!agentId || !residents.some((a) => a.id === agentId)) {
      setAgentId(residents[0].id);
    }
  }, [residents, agentId]);

  const title = landmark ? t(landmark.nameKey) : landmarkId;

  return (
    <motion.div
      className="fixed inset-0 z-[4000] flex items-end justify-center p-3 sm:p-5 md:items-center md:justify-end"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label={t('map.close')}
        onClick={onClose}
        className="absolute inset-0 bg-ink/20"
      />
      <motion.div
        initial={{ y: 36, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 24, opacity: 0 }}
        transition={{ duration: 0.3 }}
        className="sticker-card relative z-10 flex max-h-[min(82dvh,680px)] w-full max-w-md select-text flex-col overflow-hidden p-5 touch-auto"
        data-lenis-prevent
      >
        <div className="flex shrink-0 items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="kicker text-coral">{t('map.chat.kicker')}</p>
            <h2 className="mt-1 font-display text-2xl font-semibold leading-tight text-ink">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('map.close')}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-[3px] border-white bg-paper text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {town.isLoading ? (
          <p className="mt-4 text-sm font-semibold text-ink-soft">{t('common.loading')}</p>
        ) : town.isError ? (
          <p className="mt-4 text-sm font-semibold text-ink-soft">{t('auth.failed')}</p>
        ) : residents.length === 0 ? (
          <p className="mt-4 text-sm font-semibold text-ink-soft">{t('map.chat.none')}</p>
        ) : (
          <>
            {residents.length > 1 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {residents.map((agent) => (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => setAgentId(agent.id)}
                    className={cn(
                      'rounded-full border-[3px] border-white px-3 py-1 text-xs font-extrabold',
                      (active?.id ?? residents[0].id) === agent.id
                        ? 'bg-coral text-white'
                        : 'bg-white/70 text-ink-soft',
                    )}
                  >
                    {agent.name}
                  </button>
                ))}
              </div>
            )}

            {active && (
              <div className="mt-3 flex min-h-0 flex-1 flex-col">
                <p className="shrink-0 text-[0.65rem] font-extrabold uppercase tracking-[0.12em] text-ink-soft">
                  {t(`agent.kinds.${active.kind}`)} · {active.name}
                </p>
                <p className="mt-1 shrink-0 text-sm font-semibold leading-relaxed text-ink/80">{active.persona}</p>
                {landmarkId === 'magic-house' && user && <ReadingLedger />}

                {user ? (
                  <ChatThread key={active.id} agentId={active.id} tall />
                ) : (
                  <div className="mt-4">
                    <p className="text-sm font-semibold text-ink">{t('agent.needLogin')}</p>
                    <Link to="/login" className="btn-primary mt-3 inline-flex">
                      {t('agent.goSignIn')}
                    </Link>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {onNext && (
          <button type="button" onClick={onNext} className="btn-secondary mt-3 shrink-0 self-start px-4 py-2 text-sm">
            {t('map.chat.next')}
          </button>
        )}
      </motion.div>
    </motion.div>
  );
}

function ReadingLedger() {
  const { t } = useLanguage();
  const list = trpc.agent.listMemories.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const readings = (list.data ?? [])
    .filter((row) => row.status === 'active' && row.key.startsWith('reading:'))
    .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
    .slice(0, 4);

  return (
    <div className="mt-3 shrink-0 rounded-[18px] border-2 border-dashed border-lilac/50 bg-lilac/15 px-3 py-2">
      <p className="text-[0.62rem] font-extrabold uppercase tracking-[0.12em] text-ink-soft">
        {t('map.chat.readings')}
      </p>
      {list.isPending && !list.data ? (
        <p className="mt-1 text-xs font-semibold text-ink-soft">{t('common.loading')}</p>
      ) : list.isError && !list.data ? (
        <p className="mt-1 text-xs font-semibold text-ink-soft">{t('auth.failed')}</p>
      ) : readings.length === 0 ? (
        <p className="mt-1 text-xs font-semibold text-ink-soft">{t('map.chat.readingsEmpty')}</p>
      ) : (
        <ul className="sticker-scroll mt-1 max-h-28 space-y-1 overflow-y-auto">
          {readings.map((row) => (
            <li key={row.id} className="line-clamp-3 text-xs font-semibold leading-relaxed text-ink/80">
              {row.value}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
