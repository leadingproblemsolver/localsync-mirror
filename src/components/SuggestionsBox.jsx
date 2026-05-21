import { useEffect, useMemo } from 'react';
import { getSuggestions } from '@/lib/suggestions';
import { overlapScore } from '@/lib/fingerprint';
import { canonicalizeService } from '@/lib/service';
import { Lightbulb } from 'lucide-react';

// Laplace-smoothed success rate so high-failure patterns sink.
const successRate = p =>
  ((p.success_count || 0) + 1) /
  ((p.success_count || 0) + (p.failure_count || 0) + 2);

export default function SuggestionsBox({
  symptom,
  service,
  symptomFingerprint = '',
  patterns = [],
  onSuggestionClick,
  onRankedChange,
  hasEvents,
}) {
  const { items, source, serviceHasPatterns } = useMemo(() => {
    // G2: match on canonical_service so `Payments-API` ≡ `payments` ≡ `payment_api`.
    const canon = canonicalizeService(service);
    const forService = patterns.filter(p => {
      const pc = p.canonical_service || canonicalizeService(p.service);
      return pc === canon;
    });
    const scored = forService
      .map(p => ({ p, overlap: overlapScore(symptomFingerprint, p.symptom_fingerprint || '') }))
      .filter(x => x.overlap >= 0.2)
      .sort(
        (a, b) =>
          b.overlap - a.overlap ||
          successRate(b.p) - successRate(a.p) ||
          (b.p.success_count || 0) - (a.p.success_count || 0),
      )
      .slice(0, 3)
      .map(x => x.p.first_action);

    if (scored.length > 0) {
      return { items: scored, source: 'historical', serviceHasPatterns: true };
    }
    return {
      items: getSuggestions(symptom),
      source: 'heuristic',
      serviceHasPatterns: forService.length > 0,
    };
  }, [symptom, service, symptomFingerprint, patterns]);

  const itemsKey = items.join('\u0001');
  useEffect(() => {
    onRankedChange?.({ source, items });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey, source]);

  return (
    <div className="border border-border bg-card/50 p-4 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Lightbulb className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
          {source === 'historical' ? 'From historical incidents' : 'General heuristics'}
        </span>
      </div>

      {source === 'heuristic' && !serviceHasPatterns && (
        <div className="mb-3 font-mono text-xs text-muted-foreground/70 border-l-2 border-amber-400/30 pl-2">
          No history for <span className="text-foreground">{service}</span> yet — falling back to heuristics.
        </div>
      )}

      <ul className="space-y-1.5">
        {items.map((s, i) => (
          <li
            key={i}
            onClick={() => onSuggestionClick?.(s)}
            className="flex items-start gap-2 p-2 cursor-pointer rounded transition-all hover:bg-card/50 hover:border-l-2 hover:border-primary hover:pl-1.5 active:bg-primary/10"
          >
            <span className="font-mono text-xs text-muted-foreground/50 mt-0.5 flex-shrink-0">
              {i + 1}.
            </span>
            <span className="font-mono text-xs text-muted-foreground">{s}</span>
          </li>
        ))}
      </ul>
      {!hasEvents && (
        <div className="mt-3 pt-3 border-t border-border/30 font-mono text-xs text-muted-foreground/50">
          ↑ Click a suggestion to pre-fill your first action
        </div>
      )}
    </div>
  );
}
