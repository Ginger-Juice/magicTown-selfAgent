import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'framer-motion';
import { KeyRound } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/providers/auth';
import { useLanguage } from '@/lib/i18n';

export default function Login() {
  const { t } = useLanguage();
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const login = trpc.auth.login.useMutation();
  const register = trpc.auth.register.useMutation();
  const busy = login.isPending || register.isPending;

  function mapError(code: string | undefined, fallback: string) {
    if (code === 'email_taken') return t('auth.emailTaken');
    if (code === 'invalid_credentials') return t('auth.invalid');
    return fallback;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (mode === 'register') {
        await register.mutateAsync({ email, password, displayName });
      } else {
        await login.mutateAsync({ email, password });
      }
      await refresh();
      navigate('/agents');
    } catch (err) {
      const message = (err as { message?: string } | null)?.message;
      setError(mapError(message, t('auth.failed')));
    }
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-16">
      <motion.form
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        onSubmit={(e) => void submit(e)}
        className="sticker-card w-full max-w-sm p-8 text-center"
      >
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border-[3px] border-butter bg-ink shadow-md">
          <KeyRound className="h-7 w-7 text-butter" />
        </div>
        <h1 className="font-display text-2xl font-semibold text-ink">{t('auth.title')}</h1>
        <p className="font-hand mt-1 text-xl text-ink-soft">{t('auth.subtitle')}</p>

        {mode === 'register' && (
          <label className="mt-5 block text-left">
            <span className="text-[0.72rem] font-extrabold uppercase tracking-[0.14em] text-ink-soft">
              {t('auth.displayName')}
            </span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              maxLength={60}
              className="mt-1 w-full rounded-2xl border-[3px] border-white bg-cream px-4 py-2.5 font-bold text-ink shadow-inner outline-none focus:border-butter"
            />
          </label>
        )}

        <label className="mt-4 block text-left">
          <span className="text-[0.72rem] font-extrabold uppercase tracking-[0.14em] text-ink-soft">
            {t('auth.email')}
          </span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            className="mt-1 w-full rounded-2xl border-[3px] border-white bg-cream px-4 py-2.5 font-bold text-ink shadow-inner outline-none focus:border-butter"
          />
        </label>

        <label className="mt-4 block text-left">
          <span className="text-[0.72rem] font-extrabold uppercase tracking-[0.14em] text-ink-soft">
            {t('auth.password')}
          </span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            className="mt-1 w-full rounded-2xl border-[3px] border-white bg-cream px-4 py-2.5 font-bold text-ink shadow-inner outline-none focus:border-butter"
          />
          {mode === 'register' && (
            <span className="mt-1 block text-xs font-semibold text-ink-soft">{t('auth.passwordHint')}</span>
          )}
        </label>

        {error && <p className="mt-3 text-sm font-bold text-coral">{error}</p>}

        <button type="submit" disabled={busy} className="btn-primary mt-5 w-full">
          {busy ? t('common.loading') : mode === 'register' ? t('auth.register') : t('auth.login')}
        </button>

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError(null);
          }}
          className="mt-3 text-sm font-bold text-ink-soft underline decoration-dotted underline-offset-2"
        >
          {mode === 'login' ? t('auth.switchToRegister') : t('auth.switchToLogin')}
        </button>
      </motion.form>
    </div>
  );
}
