import Markdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import type { Components } from 'react-markdown';
import { cn } from '@/lib/utils';

const components: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
  strong: ({ children }) => <strong className="font-extrabold text-ink">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="text-ink-soft">{children}</del>,
  h1: ({ children }) => <p className="mb-1 font-extrabold leading-snug last:mb-0">{children}</p>,
  h2: ({ children }) => <p className="mb-1 font-extrabold leading-snug last:mb-0">{children}</p>,
  h3: ({ children }) => <p className="mb-1 font-extrabold leading-snug last:mb-0">{children}</p>,
  h4: ({ children }) => <p className="mb-1 font-extrabold leading-snug last:mb-0">{children}</p>,
  h5: ({ children }) => <p className="mb-1 font-extrabold leading-snug last:mb-0">{children}</p>,
  h6: ({ children }) => <p className="mb-1 font-extrabold leading-snug last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-0.5 pl-4 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-0.5 pl-4 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-2 border-ink/20 pl-2 text-ink-soft last:mb-0">{children}</blockquote>
  ),
  hr: () => <hr className="my-2 border-ink/15" />,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="underline decoration-coral/60 underline-offset-2">
      {children}
    </a>
  ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-xl bg-white/70 p-2 text-[0.8em] font-normal last:mb-0">{children}</pre>
  ),
  code: ({ className, children }) => {
    const block = Boolean(className);
    if (block) {
      return <code className="font-mono text-[0.9em]">{children}</code>;
    }
    return (
      <code className="rounded-md bg-white/70 px-1 py-0.5 font-mono text-[0.85em] font-bold">{children}</code>
    );
  },
};

export function MarkdownBody({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('chat-md', className)}>
      <Markdown
        remarkPlugins={[remarkBreaks]}
        skipHtml
        unwrapDisallowed
        allowedElements={[
          'p',
          'strong',
          'em',
          'del',
          'code',
          'pre',
          'ul',
          'ol',
          'li',
          'a',
          'h1',
          'h2',
          'h3',
          'h4',
          'h5',
          'h6',
          'blockquote',
          'br',
          'hr',
        ]}
        components={components}
      >
        {text}
      </Markdown>
    </div>
  );
}
