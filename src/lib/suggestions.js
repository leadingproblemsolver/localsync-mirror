export function getSuggestions(symptom) {
  const lower = (symptom || '').toLowerCase();
  if (lower.includes('latency') || lower.includes('slow') || lower.includes('timeout')) {
    return [
      'Check DB connection pool utilization',
      'Inspect Redis memory usage',
      'Review recent deploy diff',
    ];
  }
  if (lower.includes('error') || lower.includes('5xx') || lower.includes('exception')) {
    return [
      'Check application error logs',
      'Review deploy history for breaking changes',
      'Inspect upstream dependency health',
    ];
  }
  if (lower.includes('memory') || lower.includes('oom') || lower.includes('heap')) {
    return [
      'Check pod memory limits and current usage',
      'Look for memory leak in recent code changes',
      'Review GC metrics',
    ];
  }
  if (lower.includes('cpu') || lower.includes('load')) {
    return [
      'Check for runaway processes or infinite loops',
      'Review recent traffic patterns',
      'Inspect query performance',
    ];
  }
  return [
    'Check service health dashboard',
    'Review recent deployments',
    'Inspect dependency status',
  ];
}

export function timeAgo(isoString) {
  if (!isoString) return '';
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function formatDuration(start, end) {
  if (!start || !end) return null;
  const diff = new Date(end).getTime() - new Date(start).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}