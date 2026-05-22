import { useEffect, useMemo } from 'react';
import { getSuggestions } from '@/lib/suggestions';
import { overlapScore } from '@/lib/fingerprint';
import { canonicalizeService } from '@/lib/service';
import { Lightbulb } from 'lucide-react';

// Laplace-smoothed success rate so high-failure patterns sink.
const successRate = p =>
  ((p.success_count || 0) + 1) /
  ((p.success_count || 0) + (p.failure_count || 0) + 2);

// Recency weight: exponential decay with ~21d half-life.
// last_seen_at is the canonical recency stamp (added in 0006); fall back
// to updated_at / created_date for rows written before the migration.
const DAY_MS = 86_400_000;
function recencyWeight(p) {
  const stamp = p.last_seen_at || p.updated_at || p.created_date;
  if (!stamp) return 0.5;
  const ageDays = Math.max(0, (Date.now() - new Date(stamp).getTime()) / DAY_MS);
  return Math.exp(-ageDays / 30); // ~half-life 21d
}

function rankScore(p, overlap) {
  return overlap * 0.6 + successRate(p) * 0.3 + recencyWeight(p) * 0.1;
}

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
      .map(p => {
        const overlap = overlapScore(symptomFingerprint, p.symptom_fingerprint || '');
        return { p, overlap, score: rankScore(p, overlap) };
      })
      .filter(x => x.overlap >= 0.2)
      .sort(
        (a, b) =>
          b.score - a.score ||
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
