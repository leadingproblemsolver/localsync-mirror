import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getArtifactByIncidentId } from '@/lib/artifactClient';
import { ArrowLeft, Copy, CheckCircle, XCircle, List } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

// Gap #4: human-friendly TTR formatting from raw minutes.
function formatTtr(mins) {
  if (mins == null) return '—';
  const m = Math.round(Number(mins));
  if (!Number.isFinite(m) || m < 1) return '<1m';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r > 0 ? `${h}h ${r}m` : `${h}h`;
}


export default function IncidentReport() {
  const { id } = useParams();
  const { toast } = useToast();
  const [artifact, setArtifact] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!id) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      const art = await getArtifactByIncidentId(id);
      if (art) {
        setArtifact(art);
      } else {
        setNotFound(true);
      }
      setLoading(false);
    };

    load();
  }, [id]);

  const handleCopyMarkdown = () => {
    if (artifact?.markdown_export) {
      navigator.clipboard.writeText(artifact.markdown_export);
      toast({
        description: 'Markdown copied to clipboard',
      });
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-6 w-32 bg-card border border-border animate-pulse" />
        <div className="h-64 bg-card border border-border animate-pulse" />
      </div>
    );
  }

  if (notFound || !artifact) {
    return (
      <div className="text-center py-20">
        <p className="font-mono text-sm text-muted-foreground mb-4">
          Report not available yet.
        </p>
        <Link
          to={`/incident/${id}`}
          className="font-mono text-xs text-primary uppercase tracking-wider hover:underline"
        >
          ← Back to incident
        </Link>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-4 mb-4">
            <Link
              to={`/incident/${id}`}
              className="flex items-center gap-2 font-mono text-xs text-muted-foreground hover:text-foreground transition-colors uppercase tracking-wider"
            >
              <ArrowLeft className="w-3 h-3" />
              Back to incident
            </Link>
            <Link
              to="/"
              className="flex items-center gap-2 font-mono text-xs text-muted-foreground hover:text-foreground transition-colors uppercase tracking-wider"
            >
              <List className="w-3 h-3" />
              All incidents
            </Link>
          </div>
          <h1 className="font-mono text-2xl font-medium text-foreground">
            {artifact.service}
          </h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleCopyMarkdown}
            className="flex items-center gap-2 px-4 py-2 bg-accent border border-border text-foreground font-mono text-xs tracking-wider uppercase hover:border-primary hover:text-primary transition-all"
          >
            <Copy className="w-3 h-3" />
            Copy Markdown
          </button>
        </div>
      </div>


      {/* Meta Info */}
      <div className="border border-border bg-card p-5 mb-6">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="font-mono text-xs text-muted-foreground mb-1">Outcome</div>
            {(() => {
              // G8: rich outcome palette
              const tone = {
                resolved:     { cls: 'text-green-500', Icon: CheckCircle },
                mitigated:    { cls: 'text-teal-400',  Icon: CheckCircle },
                'rolled-back':{ cls: 'text-amber-400', Icon: XCircle },
                escalated:    { cls: 'text-red-500',   Icon: XCircle },
                success:      { cls: 'text-green-500', Icon: CheckCircle },
                failure:      { cls: 'text-red-500',   Icon: XCircle },
              }[artifact.outcome] || { cls: 'text-foreground', Icon: CheckCircle };
              const Icon = tone.Icon;
              return (
                <div className={`flex items-center gap-2 font-mono text-sm font-medium ${tone.cls}`}>
                  <Icon className="w-4 h-4" />
                  {String(artifact.outcome || '').toUpperCase()}
                </div>
              );
            })()}
          </div>
          <div>
            <div className="font-mono text-xs text-muted-foreground mb-1">TTR</div>
            <div className="font-mono text-sm font-medium text-foreground">
              {formatTtr(artifact.ttr_minutes)}
            </div>
          </div>

          <div>
            <div className="font-mono text-xs text-muted-foreground mb-1">Symptom</div>
            <div className="font-mono text-xs text-foreground/70">
              {artifact.symptom}
            </div>
          </div>
        </div>
      </div>

      {/* Intent vs Reality */}
      <div className="border border-border bg-card p-5 mb-6">
        <h2 className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-4">
          Intent vs Reality
        </h2>
        <div className="space-y-4">
          <div>
            <div className="font-mono text-xs text-muted-foreground mb-1">First Intention</div>
            <div className="font-mono text-sm text-foreground bg-card/50 border border-border p-3">
              {artifact.first_intention || 'Not captured'}
            </div>
          </div>
          <div>
            <div className="font-mono text-xs text-muted-foreground mb-1">Suggestion Shown</div>
            <div className="font-mono text-sm text-foreground/70 bg-card/50 border border-border p-3">
              {artifact.suggestion_shown || '—'}
            </div>
          </div>
          {(() => {
            // Gap #11: surface stepwise divergence counts when the
            // artifact carries the richer event_sequence (post-#11 writes).
            const seq = Array.isArray(artifact.event_sequence) ? artifact.event_sequence : [];
            const withSuggestion = seq.filter(e => e && e.suggested);
            const divergedCount = withSuggestion.filter(e => e.diverged).length;
            const hasRich = withSuggestion.length > 0;

            if (artifact.diverged) {
              return (
                <div className="border-l-2 border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
                  <div>
                    <div className="font-mono text-xs text-muted-foreground mb-1">Suggested</div>
                    <div className="font-mono text-sm text-foreground">{artifact.suggestion_shown}</div>
                  </div>
                  <div>
                    <div className="font-mono text-xs text-muted-foreground mb-1">Actual First Action</div>
                    <div className="font-mono text-sm text-foreground">{artifact.actual_first_action}</div>
                  </div>
                  <div className="font-mono text-xs text-amber-500 font-medium">
                    ⚠ Divergence detected{hasRich ? ` — ${divergedCount}/${withSuggestion.length} steps` : ''}
                  </div>
                </div>
              );
            }
            return (
              <div className="font-mono text-xs text-muted-foreground/50 p-3">
                {hasRich
                  ? `All ${withSuggestion.length} suggested checks matched actual actions.`
                  : 'First action matched suggestion.'}
              </div>
            );
          })()}

        </div>
      </div>

      {/* Diagnostic Sequence */}
      <div className="border border-border bg-card p-5 mb-6">
        <h2 className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-4">
          Diagnostic Sequence
        </h2>
        <div className="space-y-2">
          {Array.isArray(artifact.event_sequence) && artifact.event_sequence.map((event, idx) => {
            const shown = Array.isArray(event.suggestions_shown) ? event.suggestions_shown : [];
            const matched = event.matched_rank ?? null;
            return (
              <div key={idx} className="flex gap-3 text-xs">
                <div className="font-mono font-medium text-muted-foreground flex-shrink-0 w-8">
                  [{event.step}]
                </div>
                <div className="flex-1">
                  <div className="font-mono text-sm text-foreground">
                    {event.message}
                    {event.diverged && (
                      <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-amber-500">
                        diverged
                      </span>
                    )}
                    {!event.diverged && matched && matched > 1 && (
                      <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
                        matched rank {matched}
                      </span>
                    )}
                  </div>
                  {event.rationale && (
                    <div className="mt-1 pl-3 border-l border-border/40 font-mono text-xs italic text-muted-foreground/70 whitespace-pre-wrap">
                      <span className="not-italic text-muted-foreground/50 mr-1">why:</span>
                      {event.rationale}
                    </div>
                  )}
                  {shown.length > 0 && (
                    <details className="mt-1">
                      <summary className="font-mono text-[11px] text-muted-foreground/60 cursor-pointer hover:text-muted-foreground select-none">
                        Suggestions shown ({shown.length})
                      </summary>
                      <ol className="mt-1 ml-3 space-y-0.5">
                        {shown.map((s, i) => (
                          <li
                            key={i}
                            className={`font-mono text-[11px] ${
                              matched === i + 1
                                ? 'text-foreground'
                                : 'text-muted-foreground/70'
                            }`}
                          >
                            <span className="text-muted-foreground/40">{i + 1}.</span>{' '}
                            {s}
                            {matched === i + 1 && (
                              <span className="ml-1 text-[10px] uppercase tracking-wider text-green-500">
                                chosen
                              </span>
                            )}
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}
                  {shown.length === 0 && event.suggested && event.diverged && (
                    <div className="font-mono text-xs text-muted-foreground/70 mt-0.5">
                      suggested: {event.suggested}
                    </div>
                  )}
                  <div className="font-mono text-xs text-muted-foreground/50 mt-0.5">
                    {event.timestamp}
                  </div>
                </div>
              </div>
            );
          })}

        </div>
      </div>

      {/* Root Cause */}
      <div className="border border-border bg-card p-5 mb-6">
        <h2 className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-3">
          Root Cause
        </h2>
        <div className="font-mono text-sm text-foreground/80">
          {artifact.root_cause_note || 'Not captured'}
        </div>
      </div>

      {/* Pattern Reinforcement */}
      <div className="border border-border/50 bg-card/30 p-5 mb-6">
        <div className="flex items-start gap-2">
          <div className="font-mono text-xs text-muted-foreground/50 flex-shrink-0 mt-1">
            ✓
          </div>
          <div className="text-xs font-mono text-muted-foreground/70">
            This incident's first action has been recorded into pattern memory for{' '}
            <span className="text-foreground font-medium">{artifact.service}</span>.
          </div>
        </div>
      </div>

      {/* Raw Markdown (hidden, copyable) */}
      <textarea
        value={artifact.markdown_export}
        readOnly
        className="hidden"
        id="markdown-export"
      />
    </div>
  );
}
