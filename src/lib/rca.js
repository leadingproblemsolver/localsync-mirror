// G9 — Lightweight RCA categorization. Pure, no LLM.
// Returns one of: deploy | config | dependency | capacity | data | unknown
const RULES = [
  { cat: 'deploy',     re: /\b(deploy|release|rollback|revert|ship(ped)?|build|merge|hotfix|migration)\b/i },
  { cat: 'config',     re: /\b(config|flag|env|environment variable|toggle|setting|secret|credential|cert(ificate)?|dns|tls)\b/i },
  { cat: 'dependency', re: /\b(upstream|downstream|3rd[- ]?party|third[- ]?party|vendor|sdk|library|dependency|outage|aws|gcp|azure|stripe|datadog|github)\b/i },
  { cat: 'capacity',   re: /\b(cpu|memory|oom|heap|disk|quota|throttl(e|ing)|rate ?limit|saturation|pool exhausted|too many connections|capacity|scale|autoscal)/i },
  { cat: 'data',       re: /\b(query|index|migration data|corrupt|schema|null|deadlock|lock(ed)?|race|stale cache|cache miss|replication|backfill|missing row)\b/i },
];

export function categorizeRca(text) {
  if (!text) return 'unknown';
  const s = String(text);
  for (const { cat, re } of RULES) {
    if (re.test(s)) return cat;
  }
  return 'unknown';
}

export const RCA_CATEGORIES = ['deploy', 'config', 'dependency', 'capacity', 'data', 'unknown'];

export function rcaLabel(cat) {
  return {
    deploy:     'Deploy / release',
    config:     'Config / environment',
    dependency: 'Upstream / dependency',
    capacity:   'Capacity / saturation',
    data:       'Data / query',
    unknown:    'Uncategorized',
  }[cat] || cat;
}
