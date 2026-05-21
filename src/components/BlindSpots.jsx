import { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { rcaLabel } from '@/lib/rca';
import { Lightbulb, Loader2 } from 'lucide-react';

/**
 * G9: Blind-spot recommendations panel. Lists active rows from
 * blind_spot_recommendations. Org scoping is enforced by RLS.
 */
export default function BlindSpots() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState({}); // id -> bool

  const load = useCallback(async () => {
    try {
      const rows = await base44.entities.BlindSpotRecommendation.filter(
        { status: 'active' },
        { orderBy: '-predicted_impact_pct', limit: 10 },
      );
      setItems(rows);
    } catch (e) {
      // Table may not exist on older DBs; fail quietly.
      console.warn('BlindSpots load failed', e?.message || e);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function setStatus(id, status) {
    setPending(p => ({ ...p, [id]: true }));
    try {
      await base44.entities.BlindSpotRecommendation.update(id, {
        status,
        resolved_at: new Date().toISOString(),
      });
      setItems(arr => arr.filter(x => x.id !== id));
    } catch (e) {
      console.error('BlindSpots update failed', e);
    } finally {
      setPending(p => {
        const next = { ...p };
        delete next[id];
        return next;
      });
    }
  }

  if (loading) return null;
  if (items.length === 0) return null;

  return (
    <div className="border border-border bg-card/40 p-4 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Lightbulb className="w-3.5 h-3.5 text-primary" />
        <span className="font-mono text-xs text-foreground uppercase tracking-wider">
          Blind spots
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {items.length} recommendation{items.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="space-y-2">
        {items.map(r => (
          <div key={r.id} className="flex items-start justify-between gap-3 border border-border/60 bg-background p-3">
            <div className="min-w-0 flex-1">
              <div className="font-mono text-xs text-foreground">
                <span className="text-primary">{r.canonical_service}</span>
                {' · '}
                <span>{rcaLabel(r.rca_category)}</span>
              </div>
              <p className="font-mono text-xs text-muted-foreground mt-1">
                {r.incident_count} incidents in last 90d share this category — predicted impact{' '}
                <span className="text-foreground">{r.predicted_impact_pct}%</span> of incidents on this service.
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <button
                onClick={() => setStatus(r.id, 'actioned')}
                disabled={!!pending[r.id]}
                className="px-2 py-1 border border-green-500/30 text-green-500 font-mono text-xs uppercase tracking-wider hover:bg-green-500/10 transition-all disabled:opacity-40"
              >
                {pending[r.id] ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Actioned'}
              </button>
              <button
                onClick={() => setStatus(r.id, 'dismissed')}
                disabled={!!pending[r.id]}
                className="px-2 py-1 border border-border text-muted-foreground font-mono text-xs uppercase tracking-wider hover:text-foreground transition-all disabled:opacity-40"
              >
                Dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
