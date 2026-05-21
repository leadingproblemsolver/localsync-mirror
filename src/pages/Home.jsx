import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { timeAgo, formatDuration } from '@/lib/suggestions';
import { FEATURE_FLAGS } from '@/lib/feature-flags';
import { isStale, staleAgeMs, formatStaleAge } from '@/lib/staleness';
import BlindSpots from '@/components/BlindSpots';
import { Plus, Circle, AlertTriangle, FileWarning } from 'lucide-react';

// G8: visual tone per outcome
const OUTCOME_DOT = {
  resolved: 'text-green-500',
  mitigated: 'text-teal-400',
  'rolled-back': 'text-amber-400',
  escalated: 'text-red-500',
  success: 'text-green-500',
  failure: 'text-red-500',
};
const OUTCOME_PILL = {
  resolved: 'bg-green-500/10 text-green-500',
  mitigated: 'bg-teal-400/10 text-teal-400',
  'rolled-back': 'bg-amber-400/10 text-amber-400',
  escalated: 'bg-red-500/10 text-red-500',
  success: 'bg-green-500/10 text-green-500',
  failure: 'bg-red-500/10 text-red-500',
};

export default function Home() {
  const [incidents, setIncidents] = useState([]);
  const [filter, setFilter] = useState('active');
  const [staleOnly, setStaleOnly] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    const inc = await base44.entities.Incident.list('-created_date', 50);
    setIncidents(inc);
    setLoading(false);
  }

  const sorted = useMemo(
    () =>
      [...incidents].sort((a, b) => {
        if (a.status === 'active' && b.status !== 'active') return -1;
        if (a.status !== 'active' && b.status === 'active') return 1;
        return new Date(b.created_date).getTime() - new Date(a.created_date).getTime();
      }),
    [incidents],
  );

  const p3 = FEATURE_FLAGS.P3_COLD_START_REPAIR;
  const staleCount = useMemo(
    () => (p3 ? sorted.filter(i => isStale(i)).length : 0),
    [sorted, p3],
  );

  const baseFiltered =
    filter === 'active' ? sorted.filter(i => i.status === 'active') : sorted;
  const filtered = p3 && staleOnly ? baseFiltered.filter(i => isStale(i)) : baseFiltered;

  useEffect(() => {
    if (!p3 || staleCount === 0) setStaleOnly(false);
  }, [p3, staleCount]);

  // G7: resolved incidents with pending postmortem past their prompt-due
  const pendingPostmortems = useMemo(
    () => sorted.filter(i =>
      i.status === 'resolved' &&
      i.rca_status === 'pending' &&
      i.rca_prompt_due &&
      new Date(i.rca_prompt_due).getTime() <= Date.now()
    ),
    [sorted],
  );

  return (
    <div>
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="font-mono text-xl font-medium tracking-tight text-foreground">
            Incident Memory
          </h1>
          <p className="text-muted-foreground text-sm mt-1 font-mono">
            Operational decision traces
          </p>
        </div>
        <Link
          to="/incident/new"
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground font-mono text-xs tracking-wider uppercase hover:bg-primary/90 transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          New Incident
        </Link>
      </div>

      {/* G9 */}
      <BlindSpots />

      {/* G7: pending postmortem prompts */}
      {pendingPostmortems.length > 0 && (
        <div className="border border-amber-400/30 bg-amber-400/5 p-4 mb-6">
          <div className="flex items-center gap-2 mb-2">
            <FileWarning className="w-3.5 h-3.5 text-amber-400" />
            <span className="font-mono text-xs text-amber-400 uppercase tracking-wider">
              Pending postmortems
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {pendingPostmortems.length}
            </span>
          </div>
          <div className="space-y-1">
            {pendingPostmortems.slice(0, 5).map(i => (
              <Link
                key={i.id}
                to={`/incident/${i.id}`}
                className="block font-mono text-xs text-foreground/80 hover:text-foreground"
              >
                <span className="text-amber-400">→</span> {i.service} — {i.symptom}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-1 mb-6 border-b border-border pb-4">
        {['active', 'all'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`font-mono text-xs tracking-wider uppercase px-3 py-1.5 transition-all ${
              filter === f
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {f}
          </button>
        ))}
        {p3 && staleCount > 0 && (
          <button
            onClick={() => setStaleOnly(s => !s)}
            className={`ml-auto flex items-center gap-1.5 font-mono text-xs tracking-wider uppercase px-3 py-1.5 transition-all border ${
              staleOnly
                ? 'bg-amber-400/10 text-amber-400 border-amber-400/30'
                : 'text-amber-400 border-amber-400/20 hover:bg-amber-400/10'
            }`}
            title="Show stale incidents only"
          >
            <AlertTriangle className="w-3 h-3" />
            {staleCount} stale
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-20 bg-card border border-border animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="border border-border p-8 text-center">
          <p className="font-mono text-sm text-muted-foreground">
            {staleOnly
              ? 'No stale incidents.'
              : filter === 'active'
                ? 'No active incidents. Good.'
                : 'No incidents recorded yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-px">
          {filtered.map(incident => {
            const count = incident.step_count ?? 0;
            const isActive = incident.status === 'active';
            const stale = p3 && isStale(incident);
            const dot = isActive ? 'text-amber-400' : (OUTCOME_DOT[incident.outcome] || 'text-green-500');
            const pill = isActive
              ? 'bg-amber-400/10 text-amber-400'
              : (OUTCOME_PILL[incident.outcome] || 'bg-green-500/10 text-green-500');
            const pendingRca = !isActive && incident.rca_status === 'pending';
            return (
              <Link
                key={incident.id}
                to={`/incident/${incident.id}`}
                className="block bg-card border border-border hover:border-primary/50 hover:bg-accent/30 transition-all p-4 group"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="mt-1.5 flex-shrink-0">
                      <Circle className={`w-2 h-2 fill-current ${dot}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-3 mb-1 flex-wrap">
                        <span className="font-mono text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                          {incident.service}
                        </span>
                        <span className={`font-mono text-xs px-1.5 py-0.5 ${pill}`}>
                          {isActive ? incident.status : incident.outcome}
                        </span>
                        {pendingRca && (
                          <span className="font-mono text-xs px-1.5 py-0.5 bg-amber-400/10 text-amber-400 border border-amber-400/30 uppercase tracking-wider">
                            postmortem pending
                          </span>
                        )}
                        {stale && (
                          <span className="font-mono text-xs px-1.5 py-0.5 bg-amber-400/10 text-amber-400 border border-amber-400/30 uppercase tracking-wider">
                            stale {formatStaleAge(staleAgeMs(incident))}
                          </span>
                        )}
                      </div>
                      <p className="text-muted-foreground text-xs font-mono truncate">
                        {incident.symptom}
                      </p>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="font-mono text-xs text-muted-foreground">
                      {timeAgo(incident.created_date)}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground mt-1">
                      {count} {count === 1 ? 'step' : 'steps'}
                    </div>
                    {!isActive && incident.resolved_at && (
                      <div className="font-mono text-xs text-muted-foreground/60 mt-1">
                        TTR: {formatDuration(incident.created_date, incident.resolved_at)}
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
