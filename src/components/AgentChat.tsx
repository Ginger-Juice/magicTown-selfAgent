import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { trpc } from '@/providers/trpc';
import { useLanguage } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { MarkdownBody } from './MarkdownBody';

function noteFailed(meta: string | null): boolean {
  if (!meta) return false;
  try {
    return Boolean((JSON.parse(meta) as { failed?: boolean }).failed);
  } catch {
    return false;
  }
}

export function ChatThread({
  agentId,
  tall = false,
}: {
  agentId: number;
  tall?: boolean;
}) {
  const { t } = useLanguage();
  const utils = trpc.useUtils();
  const catalog = trpc.agent.listModels.useQuery(undefined, { retry: false });
  const defaultId = catalog.data?.defaultId ?? catalog.data?.models[0]?.id ?? null;
  const open = trpc.agent.openConversation.useMutation({
    onSuccess: (convo) => {
      void utils.agent.listMessages.invalidate({ conversationId: convo.id });
    },
  });
  const conversationId = open.data?.id;
  const messages = trpc.agent.listMessages.useQuery(
    { conversationId: conversationId ?? 0 },
    { enabled: !!conversationId, retry: false },
  );
  const send = trpc.agent.sendMessage.useMutation();
  const retry = trpc.agent.retryMessage.useMutation();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendingEnvelopes, setPendingEnvelopes] = useState(0);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open.data || open.isPending || open.isError) return;
    if (!catalog.isSuccess) return;
    open.mutate({ agentId, model: defaultId ?? undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, catalog.isSuccess, defaultId]);

  useEffect(() => {
    if (pendingEnvelopes === 0 || !conversationId) return;
    const timer = setInterval(() => {
      void utils.agent.listMessages.invalidate({ conversationId });
    }, 3000);
    const stop = setTimeout(() => setPendingEnvelopes(0), 60_000);
    return () => {
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, [pendingEnvelopes, conversationId, utils]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.data, pendingEnvelopes]);

  if (!conversationId) {
    return <p className="mt-3 text-xs font-semibold text-ink-soft">{t('common.loading')}</p>;
  }

  function turnError(err: unknown): string {
    const message = (err as { message?: string } | null)?.message ?? '';
    const name = (err as { name?: string } | null)?.name ?? '';
    if (message === 'agent_busy') return t('agent.busy');
    if (name === 'AbortError' || /aborted|timeout/i.test(message)) return t('agent.retryTimeout');
    return t('agent.sendFailed');
  }

  async function onSend(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !conversationId) return;
    setDraft('');
    setError(null);
    try {
      const result = await send.mutateAsync({ conversationId, body });
      utils.agent.listMessages.setData({ conversationId }, result.messages);
      setPendingEnvelopes(result.envelopesCreated);
      void utils.agent.listMemories.invalidate();
    } catch (err) {
      setError(turnError(err));
      setDraft(body);
    }
  }

  async function onRetry(failedMessageId: number) {
    if (!conversationId || retryingId != null) return;
    setRetryingId(failedMessageId);
    setError(null);
    try {
      const result = await retry.mutateAsync({ conversationId, failedMessageId });
      utils.agent.listMessages.setData({ conversationId }, result.messages);
      setPendingEnvelopes(result.envelopesCreated);
      void utils.agent.listMemories.invalidate();
    } catch (err) {
      retry.reset();
      setError(turnError(err));
    } finally {
      setRetryingId(null);
    }
  }

  const busy = send.isPending || retryingId != null;

  function onComposerKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    e.currentTarget.form?.requestSubmit();
  }

  return (
    <div className={cn('mt-3 flex min-h-0 flex-col rounded-[20px] border-2 border-dashed border-ink/10 bg-cream/60 p-3', tall && 'min-h-0 flex-1')}>
      <ModelPicker conversationId={conversationId} current={open.data?.model ?? defaultId} />
      <div
        ref={scrollerRef}
        className={cn('sticker-scroll mt-2 space-y-3 overflow-y-auto pr-1', tall ? 'min-h-0 flex-1' : 'max-h-56')}
      >
        {(messages.data ?? []).length === 0 && (
          <p className="text-xs font-semibold text-ink-soft">{t('agent.emptyChat')}</p>
        )}
        {(messages.data ?? []).map((m) =>
          m.fromKind === 'system' ? (
            <SystemNote
              key={m.id}
              body={m.body}
              meta={m.meta}
              onRetry={noteFailed(m.meta) ? () => void onRetry(m.id) : undefined}
              retrying={retryingId === m.id}
            />
          ) : m.fromKind === 'agent' ? (
            <div key={m.id} className="flex justify-start">
              <div className="select-text max-w-[88%] rounded-[22px] rounded-bl-md border-[3px] border-white/80 bg-lilac/55 px-3.5 py-2.5 text-sm font-semibold leading-relaxed text-ink">
                <MarkdownBody text={m.body} />
              </div>
            </div>
          ) : (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[88%]">
                <p className="mb-0.5 text-right text-[0.62rem] font-extrabold uppercase tracking-[0.12em] text-ink-soft">
                  {t('agent.you')}
                </p>
                <p className="select-text whitespace-pre-wrap rounded-[22px] rounded-br-md border-[3px] border-white bg-butter px-3.5 py-2.5 text-sm font-semibold leading-relaxed text-ink shadow-[0_3px_0_rgba(30,42,58,0.1)]">
                  {m.body}
                </p>
              </div>
            </div>
          ),
        )}
        {pendingEnvelopes > 0 && (
          <p className="text-xs font-semibold text-ink-soft">{t('agent.waiting')}</p>
        )}
      </div>
      {error && <p className="mt-2 text-xs font-bold text-coral">{error}</p>}
      <form onSubmit={(e) => void onSend(e)} className="mt-3 flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onComposerKey}
          placeholder={t('agent.composer')}
          rows={2}
          className="min-h-[2.75rem] min-w-0 flex-1 resize-none rounded-[18px] border-[3px] border-white bg-paper px-3.5 py-2 text-sm font-semibold leading-relaxed text-ink outline-none placeholder:text-ink-soft/70"
        />
        <button type="submit" disabled={busy} className="btn-primary shrink-0 px-4 py-2 text-sm">
          {t('agent.send')}
        </button>
      </form>
    </div>
  );
}

function ModelPicker({
  conversationId,
  current,
}: {
  conversationId: number;
  current: string | null;
}) {
  const { t } = useLanguage();
  const catalog = trpc.agent.listModels.useQuery(undefined, { retry: false });
  const options = catalog.data?.models ?? [];
  const fallback = current || catalog.data?.defaultId || options[0]?.id || '';
  const [selected, setSelected] = useState(fallback);
  const setModel = trpc.agent.setConversationModel.useMutation();

  useEffect(() => {
    if (fallback) setSelected(fallback);
  }, [fallback]);

  if (catalog.isSuccess && options.length === 0) {
    return <p className="text-xs font-bold text-coral">{t('agent.noModels')}</p>;
  }
  if (!options.length) return null;

  function pick(value: string) {
    setSelected(value);
    setModel.mutate({ conversationId, model: value || null });
  }

  return (
    <label className="flex items-center gap-2">
      <span className="text-[0.62rem] font-extrabold uppercase tracking-[0.12em] text-ink-soft">
        {t('agent.model')}
      </span>
      <select
        value={selected}
        onChange={(e) => pick(e.target.value)}
        className="min-w-0 flex-1 rounded-xl border-2 border-white bg-cream px-2 py-1 text-xs font-bold text-ink outline-none"
      >
        {options.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label} · {m.model}
            {m.id === catalog.data?.defaultId ? ` · ${t('agent.modelDefaultTag')}` : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

function SystemNote({
  body,
  meta,
  onRetry,
  retrying = false,
}: {
  body: string;
  meta: string | null;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const { t } = useLanguage();
  let kind = 'notice';
  try {
    if (meta) kind = String((JSON.parse(meta) as { kind?: string }).kind ?? 'notice');
  } catch {
    /* ignore */
  }

  const accent =
    kind === 'handoff'
      ? 'border-lilac bg-lilac/20'
      : kind === 'memory_proposal'
        ? 'border-coral/50 bg-coral/10'
        : kind === 'tool_trace'
          ? 'border-ink/10 bg-white/40'
          : onRetry
            ? 'border-coral/40 bg-coral/10'
            : 'border-ink/15 bg-white/60';

  let calls: { tool?: string; allowed?: boolean; ms?: number; reason?: string; args?: unknown; result?: unknown }[] = [];
  try {
    if (meta) {
      const parsed = JSON.parse(meta) as { calls?: typeof calls };
      if (Array.isArray(parsed.calls)) calls = parsed.calls;
    }
  } catch {
    /* ignore */
  }

  return (
    <div
      className={cn(
        'select-text rounded-2xl border-2 border-dashed px-3 py-2 text-xs font-bold text-ink-soft',
        accent,
      )}
    >
      <p className="whitespace-pre-wrap">{body}</p>
      {kind === 'tool_trace' && calls.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[0.62rem] font-extrabold uppercase tracking-[0.12em]">
            {t('agent.toolTrace')}
          </summary>
          <ul className="mt-2 space-y-2">
            {calls.map((call, i) => (
              <li key={`${call.tool ?? 'tool'}-${i}`} className="rounded-xl bg-cream/80 px-2 py-1.5">
                <p>
                  {call.allowed ? t('agent.toolOk') : t('agent.toolDenied')} · {call.tool} · {call.ms ?? 0}ms
                  {call.reason ? ` · ${call.reason}` : ''}
                </p>
                {call.args != null && (
                  <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap font-mono text-[0.65rem] font-semibold">
                    {typeof call.args === 'string' ? call.args : JSON.stringify(call.args, null, 2)}
                  </pre>
                )}
                {call.result != null && (
                  <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap font-mono text-[0.65rem] font-semibold">
                    {typeof call.result === 'string' ? call.result : JSON.stringify(call.result, null, 2)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {onRetry && (
        <button
          type="button"
          disabled={retrying}
          onClick={onRetry}
          className="btn-secondary mt-2 px-3 py-1 text-xs"
        >
          {retrying ? t('agent.retrying') : t('agent.retry')}
        </button>
      )}
    </div>
  );
}
