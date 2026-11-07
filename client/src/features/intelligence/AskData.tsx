import { Info, Search } from 'lucide-react';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { AskResultDto } from '@arihant/shared';
import {
  AXIS_TICK,
  BAR_RADIUS_H,
  ChartCard,
  ChartTooltip,
  GRID,
  SERIES,
} from '@/components/charts/chart-kit';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import * as ai from '@/services/api/intelligence';
import { AiBadge, AiButton, useAiCall } from './ai-kit';

const EXAMPLES = [
  'Which of my tasks are overdue?',
  'How many critical tasks are open, by project?',
  'Hours logged by category in the last 30 days',
  'Open risks by severity',
  'Which projects are at risk?',
];

function ResultTable({ r }: { r: AskResultDto }) {
  return (
    <div className="max-h-96 overflow-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
          <tr>
            {r.columns.map((c) => (
              <th key={c} className="border-b px-3 py-2 text-left font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {r.rows.map((row, i) => (
            <tr key={i} className="border-b last:border-0">
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={
                    typeof cell === 'number' ? 'px-3 py-1.5 text-right tabular' : 'px-3 py-1.5'
                  }
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultChart({ r }: { r: AskResultDto }) {
  const { labelColumn, valueColumn } = r.chart!;
  const data = r.rows.map((row) => ({
    label: String(row[labelColumn]),
    value: Number(row[valueColumn]),
  }));
  return (
    <ChartCard
      title={r.columns[valueColumn] ?? 'Value'}
      subtitle={`by ${r.columns[labelColumn]?.toLowerCase()}`}
      table={{ columns: r.columns, rows: r.rows }}
      height={Math.max(160, data.length * 30)}
    >
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24 }}>
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <YAxis
            type="category"
            dataKey="label"
            width={150}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip cursor={{ fill: 'var(--muted)', opacity: 0.6 }} content={<ChartTooltip />} />
          <Bar
            dataKey="value"
            name={r.columns[valueColumn]}
            fill={SERIES[0]}
            radius={BAR_RADIUS_H}
            maxBarSize={18}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/** Ask Your Data: the AI plans the query, the server runs it within your access. */
export function AskDataTool() {
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<AskResultDto | null>(null);
  const call = useAiCall((q: string) => ai.askData(q));
  const ask = (q: string) => {
    setQuestion(q);
    call.mutate(q, { onSuccess: setResult });
  };
  return (
    <div className="space-y-4">
      <form
        className="space-y-3 rounded-xl border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim().length >= 5) ask(question.trim());
        }}
      >
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" aria-hidden />
            <Input
              className="pl-9"
              aria-label="Your question"
              placeholder="Ask about tasks, hours, projects, risks or workload"
              value={question}
              maxLength={500}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </div>
          <AiButton type="submit" busy={call.isPending} disabled={question.trim().length < 5}>
            Ask
          </AiButton>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <Button
              key={ex}
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => ask(ex)}
            >
              {ex}
            </Button>
          ))}
        </div>
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          The AI only works out what to look up. Results come straight from the records you are
          allowed to see, never from the AI.
        </p>
      </form>

      {result ? (
        <section className="space-y-3 rounded-xl border bg-card p-4" aria-label="Answer">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-lg font-semibold">{result.answer}</p>
            <AiBadge />
          </div>
          <p className="text-xs text-muted-foreground">
            <span className="font-medium">Looked up:</span> {result.interpretation}
          </p>
          {result.notes.length ? (
            <ul className="space-y-0.5 text-xs">
              {result.notes.map((n, i) => (
                <li key={i}>• {n}</li>
              ))}
            </ul>
          ) : null}
          {result.rows.length ? (
            result.chart ? (
              <ResultChart r={result} />
            ) : (
              <ResultTable r={result} />
            )
          ) : null}
          <p className="text-xs text-muted-foreground">
            Question interpreted by {result.model}. Check the "Looked up" line matches what you
            meant.
          </p>
        </section>
      ) : null}
    </div>
  );
}
