import { CircleHelp, Play } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { AQL_FIELDS, AQL_FUNCTIONS, checkAql } from '@arihant/shared';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

const KEYWORDS = ['AND', 'OR', 'NOT', 'IN', 'NOT IN', 'IS EMPTY', 'IS NOT EMPTY', 'ORDER BY'];
const WORDS = [
  ...Object.keys(AQL_FIELDS).map((f) => ({ text: f, hint: AQL_FIELDS[f]!.label })),
  ...AQL_FUNCTIONS.map((f) => ({ text: `${f}()`, hint: 'function' })),
  ...KEYWORDS.map((k) => ({ text: k, hint: 'keyword' })),
];

/** Query editor with live syntax checking, word suggestions and a field reference. */
export function AqlEditor({
  value,
  onChange,
  onRun,
  running,
}: {
  value: string;
  onChange: (v: string) => void;
  onRun: () => void;
  running?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const check = useMemo(() => checkAql(value), [value]);

  // The word being typed at the caret.
  const before = value.slice(0, caret);
  const word = /[A-Za-z]+$/.exec(before)?.[0] ?? '';
  const suggestions =
    word.length >= 1
      ? WORDS.filter(
          (w) =>
            w.text.toLowerCase().startsWith(word.toLowerCase()) &&
            w.text.toLowerCase() !== word.toLowerCase(),
        ).slice(0, 6)
      : [];

  const insert = (text: string) => {
    const start = caret - word.length;
    const next = `${value.slice(0, start)}${text} ${value.slice(caret)}`;
    onChange(next);
    const pos = start + text.length + 1;
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <textarea
          ref={ref}
          aria-label="Query"
          aria-invalid={!check.ok}
          aria-describedby="aql-status"
          spellCheck={false}
          rows={2}
          value={value}
          placeholder='project = TRD AND status IN ("To Do", "In Progress") ORDER BY priority DESC'
          onChange={(e) => {
            onChange(e.target.value);
            setCaret(e.target.selectionStart);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              if (check.ok) onRun();
            }
          }}
          className={cn(
            'min-h-16 flex-1 resize-y rounded-lg border bg-card px-3 py-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
            !check.ok && 'border-destructive',
          )}
        />
        <div className="flex flex-col gap-1.5">
          <Button onClick={onRun} disabled={!check.ok || running}>
            <Play /> Search
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <CircleHelp /> Fields
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="max-h-96 w-96 overflow-y-auto text-xs">
              <p className="mb-2 font-medium">Fields</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                {Object.entries(AQL_FIELDS).map(([k, f]) => (
                  <div key={k} className="contents">
                    <dt className="font-mono">{k}</dt>
                    <dd className="text-muted-foreground">{f.help}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 mb-1 font-medium">Operators</p>
              <p className="text-muted-foreground">
                = != &gt; &gt;= &lt; &lt;= ~ (contains) !~ IN (…) NOT IN (…) IS EMPTY, IS NOT EMPTY.
                Join with AND, OR, NOT and brackets; finish with ORDER BY field ASC|DESC.
              </p>
              <p className="mt-3 mb-1 font-medium">Functions</p>
              <p className="font-mono text-muted-foreground">
                {AQL_FUNCTIONS.map((f) => `${f}()`).join(' ')}
              </p>
              <p className="mt-2 text-muted-foreground">
                Relative dates: -7d, +2w, -1m. Results only ever include tasks you are allowed to
                see.
              </p>
            </PopoverContent>
          </Popover>
        </div>
      </div>
      <div className="flex min-h-5 flex-wrap items-center gap-1.5 text-xs">
        {suggestions.map((s) => (
          <button
            key={s.text}
            type="button"
            onClick={() => insert(s.text)}
            className="rounded border bg-muted/50 px-1.5 py-0.5 font-mono hover:bg-muted"
            title={s.hint}
          >
            {s.text}
          </button>
        ))}
        <span
          id="aql-status"
          role={check.ok ? undefined : 'alert'}
          className={cn('ml-auto', check.ok ? 'text-muted-foreground' : 'text-destructive')}
        >
          {check.ok
            ? 'Ctrl + Enter to search'
            : `${check.message} (at character ${check.position + 1})`}
        </span>
      </div>
    </div>
  );
}
