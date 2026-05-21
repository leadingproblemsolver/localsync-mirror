import { useState, useEffect } from 'react';
import { computeDivergence } from '@/lib/divergence';
import { AlertTriangle, X } from 'lucide-react';

/**
 * mode='postmortem' (default): summary panel rendered on resolved incidents.
 * mode='live': inline nudge during an active incident as soon as a diverged
 *              step is recorded. Dismissible per-incident via localStorage.
 */
export default function DivergenceSignal({ events, mode = 'postmortem', incidentId }) {
  const d = computeDivergence(events);
  const firstDiv = d.perStep.find(p => p.diverged);
  const storageKey = incidentId ? `divnudge:dismissed:${incidentId}` : null;
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (mode !== 'live' || !storageKey) return;
    try {
      setDismissed(localStorage.getItem(storageKey) === '1');
    } catch { /* SSR / disabled storage */ }
  }, [mode, storageKey]);

  if (mode === 'live') {
    if (dismissed || !firstDiv) return null;
    return (
      <div className="border border-amber-400/30 bg-amber-400/5 px-3 py-2.5 mb-4 flex items-start gap-2">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-mono text-xs text-amber-400 uppercase tracking-wider">
            Trace diverged at step {firstDiv.step}
          </div>
          <p className="font-mono text-xs text-muted-foreground mt-1">
            Suggested: <span className="text-foreground/80">{firstDiv.suggested}</span>
          </p>
          <p className="font-mono text-xs text-muted-foreground">
            You did: <span className="text-foreground/80">{firstDiv.actual}</span>
          </p>
        </div>
        <button
          onClick={() => {
            setDismissed(true);
            try { storageKey && localStorage.setItem(storageKey, '1'); } catch { /* noop */ }
          }}
          className="text-muted-foreground/60 hover:text-foreground transition-colors flex-shrink-0"
          aria-label="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  if (d.total === 0) return null;
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
