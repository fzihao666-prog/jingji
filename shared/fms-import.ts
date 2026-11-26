export type FmsInputKey = 'score' | 'left' | 'right' | 'clearing' | 'clearingLeft' | 'clearingRight';
export type FmsObservation = Partial<{ score: number; left: number; right: number; clearing: '阴性' | '阳性'; clearingLeft: '阴性' | '阳性'; clearingRight: '阴性' | '阳性' }>;

const bilateral = new Set(['fms_hurdle_step', 'fms_inline_lunge', 'fms_shoulder_mobility', 'fms_active_straight_leg_raise', 'fms_rotary_stability']);
const clearing = new Set(['fms_shoulder_mobility', 'fms_trunk_stability_pushup', 'fms_rotary_stability']);

export function fmsInputFields(code: string, label: string) {
  const fields: Array<{ key: FmsInputKey; header: string }> = bilateral.has(code)
    ? [{ key: 'left', header: `${label}（左）` }, { key: 'right', header: `${label}（右）` }]
    : [{ key: 'score', header: label }];
  if (code === 'fms_shoulder_mobility') fields.push(
    { key: 'clearingLeft', header: `${label}（左侧疼痛排查）` },
    { key: 'clearingRight', header: `${label}（右侧疼痛排查）` },
  );
  else if (clearing.has(code)) fields.push({ key: 'clearing', header: `${label}（疼痛排查）` });
  return fields;
}

export function fmsFinalScore(code: string, observation: FmsObservation, optionalClearing = false): number | null {
  if (code === 'fms_shoulder_mobility') {
    if (observation.clearingLeft === '阳性' || observation.clearingRight === '阳性') return 0;
    if (!optionalClearing && (observation.clearingLeft !== '阴性' || observation.clearingRight !== '阴性')) return null;
  } else if (clearing.has(code)) {
    if (observation.clearing === '阳性') return 0;
    if (!optionalClearing && observation.clearing !== '阴性') return null;
  }
  if (!bilateral.has(code)) return observation.score ?? null;
  return observation.left === undefined || observation.right === undefined ? null : Math.min(observation.left, observation.right);
}
