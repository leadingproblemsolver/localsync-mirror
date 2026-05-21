import { computeDivergence } from '@/lib/divergence';

export default function DivergenceSignal({ events }) {
  const d = computeDivergence(events);
  if (d.total === 0) return null;

  const firstDiv = d.perStep.find(p => p.diverged);

  return (
    <div className="border border-border/50 bg-card/30 p-3 mt-4">
      <div className="flex items-center justify-between mb-2">
        <div className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
          Divergence signal
        </div>
        <div className="font-mono text-xs text-muted-foreground">
          {d.diverged}/{d.total} steps diverged
        </div>
      </div>
      {d.diverged === 0 ? (
        <p className="font-mono text-xs text-muted-foreground">
          All suggested checks matched the actual actions taken.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="font-mono text-xs text-muted-foreground/50 mb-1">
              Suggested (step {firstDiv.step})
            </div>
            <p className="font-mono text-xs text-muted-foreground">{firstDiv.suggested}</p>
          </div>
          <div>
            <div className="font-mono text-xs text-muted-foreground/50 mb-1">Actual</div>
            <p className="font-mono text-xs text-foreground">{firstDiv.actual}</p>
          </div>
        </div>
      )}
    </div>
  );
}
