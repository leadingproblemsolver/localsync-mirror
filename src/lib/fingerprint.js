const STOPWORDS = new Set([
  'the','a','an','is','are','was','were','on','in','at','of','to','for','and','or','but',
  'with','from','by','it','its','this','that','when','while','has','have','had','be','been',
  'being','i','we','you'
]);

export function fingerprintSymptom(text) {
  if (!text) return '';
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2 && !STOPWORDS.has(t))
    .join(' ');
}

export function tokenize(fp) {
  if (!fp) return new Set();
  return new Set(String(fp).split(/\s+/).filter(Boolean));
}

export function overlapScore(aFp, bFp) {
  const a = tokenize(aFp);
  const b = tokenize(bFp);
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function normalizeAction(s) {
  if (s == null) return '';
  return String(s).toLowerCase().trim().replace(/\s+/g, ' ');
}