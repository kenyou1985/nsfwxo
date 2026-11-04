export type DaotaiWorkflowId = '2110330160000516098' | '2117221178451431425';

export const DAOTAI_WORKFLOWS: Array<{
  id: DaotaiWorkflowId;
  label: string;
  short: string;
  maxRefs: number;
  segDuration: number;
}> = [
  { id: '2110330160000516098', label: '导演台 H3 (det16)', short: 'det16', maxRefs: 5, segDuration: 15 },
  { id: '2117221178451431425', label: 'Chain 多段拼接 · 每段30s', short: 'Chain30s', maxRefs: 6, segDuration: 30 },
];

const KEY = 'nsfwxo:daotai:default_workflow';

export function getDefaultDaotaiWorkflow(): DaotaiWorkflowId {
  try {
    const v = localStorage.getItem(KEY);
    if (v === '2110330160000516098' || v === '2117221178451431425') return v;
  } catch {}
  return '2110330160000516098';
}

export function setDefaultDaotaiWorkflow(id: DaotaiWorkflowId) {
  try { localStorage.setItem(KEY, id); } catch {}
}

export function daotaiWorkflowMeta(id?: string) {
  return DAOTAI_WORKFLOWS.find(w => w.id === id) || DAOTAI_WORKFLOWS[0];
}
