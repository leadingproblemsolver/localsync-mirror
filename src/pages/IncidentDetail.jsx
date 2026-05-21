import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { getSuggestions } from '@/lib/suggestions';
import { timeAgo, formatDuration } from '@/lib/suggestions';
import { fingerprintSymptom } from '@/lib/fingerprint';
import { canonicalizeService } from '@/lib/service';
import { ArrowLeft, Circle } from 'lucide-react';
import SuggestionsBox from '@/components/SuggestionsBox';
import EventTimeline from '@/components/EventTimeline';
import AddEventForm from '@/components/AddEventForm';
import ResolveControls from '@/components/ResolveControls';
import DivergenceSignal from '@/components/DivergenceSignal';
import PendingPostmortem from '@/components/PendingPostmortem';
import ColdStartRepair from '@/components/ColdStartRepair';

// G8: outcome -> visual tone
const OUTCOME_TONE = {
  resolved:     { dot: 'text-green-500',  pill: 'bg-green-500/10 text-green-500',  border: 'border-green-500/30 bg-green-500/5 text-green-500' },
  mitigated:    { dot: 'text-teal-400',   pill: 'bg-teal-400/10 text-teal-400',    border: 'border-teal-400/30 bg-teal-400/5 text-teal-400' },
  'rolled-back':{ dot: 'text-amber-400',  pill: 'bg-amber-400/10 text-amber-400',  border: 'border-amber-400/30 bg-amber-400/5 text-amber-400' },
  escalated:    { dot: 'text-red-500',    pill: 'bg-red-500/10 text-red-500',      border: 'border-red-500/30 bg-red-500/5 text-red-500' },
  // legacy
  success:      { dot: 'text-green-500',  pill: 'bg-green-500/10 text-green-500',  border: 'border-green-500/30 bg-green-500/5 text-green-500' },
  failure:      { dot: 'text-red-500',    pill: 'bg-red-500/10 text-red-500',      border: 'border-red-500/30 bg-red-500/5 text-red-500' },
};

export default function IncidentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [incident, setIncident] = useState(null);
  const [events, setEvents] = useState([]);
  const [patterns, setPatterns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [preFillValue, setPreFillValue] = useState(null);
  const [ranked, setRanked] = useState({ source: 'heuristic', items: [] });

  const load = useCallback(async () => {
    const incRows = await base44.entities.Incident.filter({ id });
    if (!incRows || incRows.length === 0) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    const inc = incRows[0];
    // G2: pattern lookup by canonical_service
    const canon = inc.canonical_service || canonicalizeService(inc.service);
    const [evts, pats] = await Promise.all([
      base44.entities.IncidentEvent.filter({ incident_id: id }),
      base44.entities.Pattern.filter({ canonical_service: canon }, { limit: 100 }),
    ]);
    setIncident(inc);
    setEvents(evts.sort((a, b) => a.step_order - b.step_order));
    setPatterns(pats);
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!incident || incident.status !== 'active') return;
    let delay = 10_000;
    let timer;
    const tick = async () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        try { await load(); } catch (e) { console.error('poll load failed', e); }
        delay = 10_000;
      } else {
        delay = Math.min(delay * 2, 5 * 60_000);
      }
      timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, delay);
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        clearTimeout(timer);
        delay = 10_000;
        tick();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [incident, load]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-6 w-32 bg-card border border-border animate-pulse" />
        <div className="h-24 bg-card border border-border animate-pulse" />
        <div className="h-48 bg-card border border-border animate-pulse" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="text-center py-20">
        <p className="font-mono text-sm text-muted-foreground mb-4">Incident not found.</p>
        <Link to="/" className="font-mono text-xs text-primary uppercase tracking-wider hover:underline">
          Back to all incidents
        </Link>
      </div>
    );
  }

  const isActive = incident.status === 'active';
  const sortedEvents = [...events].sort((a, b) => a.step_order - b.step_order);
  const firstEvent = sortedEvents[0];
  const topSuggestion = getSuggestions(incident.symptom)[0];
  const symptomFingerprint = incident.symptom_fingerprint || fingerprintSymptom(incident.symptom);
  const tone = OUTCOME_TONE[incident.outcome] || OUTCOME_TONE.resolved;

  return (
    <div>
      <Link
        to="/"
        className="flex items-center gap-2 font-mono text-xs text-muted-foreground hover:text-foreground transition-colors mb-8 uppercase tracking-wider"
      >
        <ArrowLeft className="w-3 h-3" />
        All Incidents
      </Link>

      <div className="border border-border bg-card p-5 mb-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <Circle
              className={`w-2 h-2 fill-current flex-shrink-0 mt-0.5 ${
                isActive ? 'text-amber-400' : tone.dot
              }`}
            />
            <h1 className="font-mono text-lg font-medium text-foreground">
              {incident.service}
            </h1>
            <span className={`font-mono text-xs px-2 py-0.5 ${
              isActive ? 'bg-amber-400/10 text-amber-400' : tone.pill
            }`}>
              {isActive ? incident.status : incident.outcome}
            </span>
          </div>
          <div className="text-right text-xs font-mono text-muted-foreground">
            <div>Started {timeAgo(incident.created_date)}</div>
            {!isActive && incident.resolved_at && (
              <div className="mt-0.5">
                TTR: {formatDuration(incident.created_date, incident.resolved_at)}
              </div>
            )}
          </div>
        </div>

        <p className="font-mono text-sm text-foreground/80 leading-relaxed mb-4">
          {incident.symptom}
        </p>

        {!isActive && (
          <div className={`flex items-center gap-2 px-3 py-2 border text-xs font-mono ${tone.border}`}>
            Resolved as <span className="font-medium uppercase ml-1">{incident.outcome}</span>
            {incident.resolved_at && (
              <span className="text-muted-foreground ml-auto">
                {timeAgo(incident.resolved_at)}
              </span>
            )}
          </div>
        )}

        {/* G7: post-resolution pending-postmortem editor */}
        {!isActive && incident.rca_status === 'pending' && (
          <PendingPostmortem incident={incident} onUpdated={load} />
        )}

        {!isActive && <DivergenceSignal events={events} />}

        {isActive && <ColdStartRepair incident={incident} onRepaired={load} />}
      </div>

      {/* G6: live divergence nudge while still active */}
      {isActive && events.length >= 2 && (
        <DivergenceSignal events={events} mode="live" incidentId={id} />
      )}

      <SuggestionsBox
        symptom={incident.symptom}
        service={incident.service}
        symptomFingerprint={symptomFingerprint}
        patterns={patterns}
        onSuggestionClick={setPreFillValue}
        onRankedChange={setRanked}
        hasEvents={events.length > 0}
      />

      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <span className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
            Decision Trace
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            {sortedEvents.length} {sortedEvents.length === 1 ? 'step' : 'steps'}
          </span>
        </div>
        <EventTimeline events={events} />
      </div>

      {isActive && (
        <>
          <div className="border-t border-border pt-6 mb-6">
            <div className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-3">
              Log Action
            </div>
            <AddEventForm
              incidentId={id}
              isFirstEvent={events.length === 0}
              topSuggestion={topSuggestion}
              topSuggestions={ranked.items}
              onEventAdded={load}
              onPreFillValueChange={setPreFillValue}
              preFillValue={preFillValue}
              initialStepOrder={events.length + 1}
              currentStepCount={incident.step_count ?? sortedEvents.length}
            />
          </div>

          <div className="border-t border-border pt-6">
            <div className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-3">
              Resolve Incident
            </div>
            <ResolveControls
              incidentId={id}
              service={incident.service}
              firstEvent={firstEvent}
              patterns={patterns}
              symptomFingerprint={symptomFingerprint}
              isTest={incident.is_test === true}
              onResolved={load}
            />
          </div>
        </>
      )}
    </div>
  );
}
