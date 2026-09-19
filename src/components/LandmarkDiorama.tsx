import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, MessageCircle } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';
import { byId } from '@/lib/landmarks';
import { dioramaFor } from '@/lib/diorama';
import { usePauseSmoothScroll } from '@/lib/smoothScroll';
import { mountKonbiniRainNight } from '@/components/diorama/mountKonbiniRainNight';

export default function LandmarkDiorama({
  landmarkId,
  onBack,
  onTalk,
}: {
  landmarkId: string;
  onBack: () => void;
  onTalk: () => void;
}) {
  const { t } = useLanguage();
  const landmark = byId(landmarkId);
  const scene = dioramaFor(landmarkId);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reload, setReload] = useState(0);

  usePauseSmoothScroll(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !scene) return;
    const dispose = mountKonbiniRainNight(canvas, scene.glbUrl, {
      onReady: () => setStatus('ready'),
      onError: () => setStatus('error'),
    });
    return dispose;
  }, [scene, reload]);

  if (!scene) return null;

  const name = landmark ? t(landmark.nameKey) : landmarkId;

  return (
    <motion.div
      className="fixed inset-0 z-[3500] bg-[#0a1018]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      role="dialog"
      aria-modal="true"
      aria-label={t('map.diorama.aria', { name })}
      data-lenis-prevent
    >
      <canvas
        key={reload}
        ref={canvasRef}
        className="block h-full w-full touch-none cursor-grab active:cursor-grabbing"
      />

      {status !== 'ready' && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[#0a1018]/70">
          <div className="pointer-events-auto rounded-[24px] border-[3px] border-white bg-paper/92 px-6 py-5 text-center shadow-sticker">
            {status === 'loading' ? (
              <p className="text-sm font-extrabold text-ink">{t('map.diorama.loading')}</p>
            ) : (
              <>
                <p className="text-sm font-extrabold text-ink">{t('map.diorama.error')}</p>
                <button
                  type="button"
                  className="btn-secondary mt-3 px-4 py-2 text-sm"
                  onClick={() => {
                    setStatus('loading');
                    setReload((n) => n + 1);
                  }}
                >
                  {t('map.diorama.retry')}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <div data-hud className="pointer-events-none absolute inset-0 z-10 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            className="pointer-events-auto inline-flex items-center gap-2 rounded-full border-[3px] border-white bg-paper/92 px-4 py-2 text-sm font-extrabold text-ink shadow-sticker"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('map.diorama.back')}
          </button>
          <button
            type="button"
            onClick={onTalk}
            className="pointer-events-auto inline-flex items-center gap-2 rounded-full border-[3px] border-white bg-coral px-4 py-2 text-sm font-extrabold text-white shadow-sticker"
          >
            <MessageCircle className="h-4 w-4" />
            {t('map.diorama.talk')}
          </button>
        </div>
        <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2">
          <div className="rounded-full border-[3px] border-white bg-paper/90 px-5 py-2 text-center text-sm font-extrabold text-ink shadow-sticker">
            {name}
            <span className="mt-0.5 block text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
              {t('map.diorama.hint')}
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
