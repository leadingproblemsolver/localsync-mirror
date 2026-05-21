import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { fingerprintSymptom } from '@/lib/fingerprint';
import { canonicalizeService } from '@/lib/service';
import { ArrowLeft, Loader2 } from 'lucide-react';

export default function NewIncident() {
  const navigate = useNavigate();
  const [service, setService] = useState('');
  const [symptom, setSymptom] = useState('');
  const [isTest, setIsTest] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState({ service: null, symptom: null });

  async function handleSubmit(e) {
    e.preventDefault();
    const errs = {};
    if (!service.trim()) errs.service = 'Required';
    if (!symptom.trim()) errs.symptom = 'Required';
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    setSubmitting(true);
    // G2: stamp canonical_service alongside the display name so the pattern
    // engine collapses `Payments-API`, `payments`, and `payment_api`.
    const payload = {
      service: service.trim(),
      canonical_service: canonicalizeService(service),
      symptom: symptom.trim(),
      status: 'active',
      symptom_fingerprint: fingerprintSymptom(symptom),
      is_test: isTest,
      step_count: 0,
    };
    // org_id is auto-stamped by base44Client.entities.Incident.create
    const incident = await base44.entities.Incident.create(payload);
    navigate(`/incident/${incident.id}`);
  }

  return (
    <div className="max-w-lg">
      <Link
        to="/"
        className="flex items-center gap-2 font-mono text-xs text-muted-foreground hover:text-foreground transition-colors mb-8 uppercase tracking-wider"
      >
        <ArrowLeft className="w-3 h-3" />
        All Incidents
      </Link>

      <div className="mb-8">
        <h1 className="font-mono text-xl font-medium tracking-tight text-foreground">
          New Incident
        </h1>
        <p className="text-muted-foreground text-sm mt-1 font-mono">
          Capture the diagnostic context before you begin.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block font-mono text-xs text-muted-foreground uppercase tracking-wider mb-2">
            Service
          </label>
          <input
            type="text"
            value={service}
            onChange={e => { setService(e.target.value); setErrors(p => ({ ...p, service: null })); }}
            placeholder="e.g. payments-api, auth-service, redis-cluster"
            className={`w-full bg-card border px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary transition-colors ${
              errors.service ? 'border-destructive' : 'border-border'
            }`}
            autoFocus
          />
          {service && (
            <p className="font-mono text-xs text-muted-foreground/60 mt-1">
              Canonical bucket: <span className="text-foreground/80">{canonicalizeService(service) || '—'}</span>
            </p>
          )}
          {errors.service && (
            <p className="font-mono text-xs text-destructive mt-1">{errors.service}</p>
          )}
        </div>

        <div>
          <label className="block font-mono text-xs text-muted-foreground uppercase tracking-wider mb-2">
            Symptom
          </label>
          <textarea
            value={symptom}
            onChange={e => { setSymptom(e.target.value); setErrors(p => ({ ...p, symptom: null })); }}
            placeholder="Describe what you are observing. Be specific."
            rows={4}
            className={`w-full bg-card border px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary transition-colors resize-none ${
              errors.symptom ? 'border-destructive' : 'border-border'
            }`}
          />
          {errors.symptom && (
            <p className="font-mono text-xs text-destructive mt-1">{errors.symptom}</p>
          )}
        </div>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={isTest}
            onChange={e => setIsTest(e.target.checked)}
            className="w-3.5 h-3.5 accent-primary"
          />
          <span className="font-mono text-xs text-muted-foreground">
            Test incident (won't train patterns).
          </span>
        </label>

        <button
          type="submit"
          disabled={submitting}
          className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground font-mono text-xs tracking-wider uppercase hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Creating...
            </>
          ) : (
            'Start Incident'
          )}
        </button>
      </form>
    </div>
  );
}
