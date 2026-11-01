/** 全局：一段描述只保留一个主动作，避免多动作导致人体错位。 */
const ACT_GROUPS: Array<[string, RegExp]> = [
  ['penetration', /\b(?:cowgirl|reverse cowgirl|doggy|missionary|piledriver|pile-driver|from behind|penetrat\w*|thrust\w*|riding|rides? him|fucks?|pounding|enters? her)\b/i],
  ['oral', /\b(?:blowjob|oral|deepthroat|sucks? (?:his|the)|licks? (?:his|the) (?:cock|shaft|glans)|mouth receiving)\b/i],
  ['manual', /\b(?:fingering|fingers? (?:her|his)|masturbat\w*|handjob|rubbing her clit)\b/i],
  ['kiss', /\b(?:kiss\w*|making out)\b/i],
];
const EXTRA_PARTNER = /\b(?:another man|other men|other frozen men|one of the other|multiple men|second man|bukkake|group of men)\b/i;

export function clampOneAction(text: string): string {
  const src = String(text || '');
  if (!src.trim()) return src;
  const parts = src.split(/(?<=[.!?])\s+|,\s+/).filter(Boolean);
  const groups = ACT_GROUPS.map(([name, re]) => [name, re] as const)
    .filter(([, re]) => parts.some((p) => re.test(p)));
  if (groups.length < 2) {
    return parts.filter((p) => !EXTRA_PARTNER.test(p)).join(', ');
  }
  const chosen = groups[0][0];
  const keep = parts.filter((p) => {
    if (EXTRA_PARTNER.test(p)) return false;
    const hit = ACT_GROUPS.find(([, re]) => re.test(p));
    return !hit || hit[0] === chosen;
  });
  return keep.join(', ')
    .replace(/[, ]+with (?:her|his) (?:foot|feet|toes|leg|knee|calf)[^,.]*/gi, '')
    .replace(/,\s*,/g, ',').replace(/\s{2,}/g, ' ').trim();
}
