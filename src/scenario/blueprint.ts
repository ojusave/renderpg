export const blueprintId = 'decision_case_v1' as const;

export const earlyActionIds = ['look_first', 'act_now', 'refuse', 'verify', 'shortcut', 'hand_off_early'] as const;
export const decideActionIds = ['go_ahead', 'hold_off', 'hand_off'] as const;
export const actionIds = [...earlyActionIds, ...decideActionIds] as const;

export type EarlyActionId = (typeof earlyActionIds)[number];
export type DecideActionId = (typeof decideActionIds)[number];
export type ActionId = (typeof actionIds)[number];
export type StageId = 'intake' | 'investigate' | 'decide' | 'resolution';
export type EvidenceId = 'first_look' | 'check_result';
export type EndingId =
  | 'acted_too_early' | 'refused' | 'handed_off_early'
  | 'success' | 'acted_unchecked'
  | 'held_after_check' | 'held_unchecked'
  | 'handed_off_after_check' | 'handed_off_unchecked';

export interface StageSlot {
  id: StageId;
  actions: ActionId[];
}

/** Authored decision flow for any Slack case. The model writes the words; it cannot add stages or actions. */
export const caseBlueprint: { id: typeof blueprintId; stages: StageSlot[] } = {
  id: blueprintId,
  stages: [
    { id: 'intake', actions: ['look_first', 'act_now', 'refuse'] },
    { id: 'investigate', actions: ['verify', 'shortcut', 'hand_off_early'] },
    { id: 'decide', actions: ['go_ahead', 'hold_off', 'hand_off'] },
    { id: 'resolution', actions: [] },
  ],
};

export const evidenceIds: EvidenceId[] = ['first_look', 'check_result'];
export const endingIds: EndingId[] = [
  'acted_too_early', 'refused', 'handed_off_early', 'success', 'acted_unchecked',
  'held_after_check', 'held_unchecked', 'handed_off_after_check', 'handed_off_unchecked',
];

export const staleFillMs = 15 * 60 * 1000;

function configuredCount(name: string, fallback: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`${name} must be an integer from 1 to ${max}`);
  return value;
}

/** Unclaimed scenarios the pool tries to keep available for a simultaneous burst. */
export function poolTarget(): number {
  return configuredCount('SCENARIO_POOL_TARGET', 100, 500);
}

/** Model fills allowed to run at the same time. */
export function fillConcurrency(): number {
  return configuredCount('SCENARIO_FILL_CONCURRENCY', 8, 32);
}
