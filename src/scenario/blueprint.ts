export const blueprintId = 'account_ownership_v4' as const;

export const earlyActionIds = ['open_record', 'transfer_now', 'turn_away', 'trace_owner', 'take_word', 'escalate_early'] as const;
export const decideActionIds = ['transfer_account', 'decline_transfer', 'escalate'] as const;
export const actionIds = [...earlyActionIds, ...decideActionIds] as const;

export type EarlyActionId = (typeof earlyActionIds)[number];
export type DecideActionId = (typeof decideActionIds)[number];
export type ActionId = (typeof actionIds)[number];
export type StageId = 'intake' | 'investigate' | 'decide' | 'resolution';
export type EvidenceId = 'account_record' | 'owner_trace';
/** Scene text shown right before a question, so the player knows why each option is tempting. */
export type SetupId = 'investigate' | 'decide_verified' | 'decide_unverified';
export type EndingId =
  | 'transferred_too_early' | 'turned_away' | 'escalated_early'
  | 'success' | 'unverified_transfer'
  | 'declined_verified' | 'declined_unverified'
  | 'escalated_verified' | 'escalated_unverified';

export interface StageSlot {
  id: StageId;
  label: string;
  actions: ActionId[];
}

/** Authored investigation flow. The model writes the words; it cannot add stages or actions. */
export const accountOwnershipBlueprint: { id: typeof blueprintId; version: 4; stages: StageSlot[] } = {
  id: blueprintId,
  version: 4,
  stages: [
    { id: 'intake', label: 'What do you do first?', actions: ['open_record', 'transfer_now', 'turn_away'] },
    { id: 'investigate', label: 'The customer wants the account moved without a check. What do you do?', actions: ['trace_owner', 'take_word', 'escalate_early'] },
    { id: 'decide', label: 'What do you do with the account?', actions: ['transfer_account', 'decline_transfer', 'escalate'] },
    { id: 'resolution', label: 'Resolution', actions: [] },
  ],
};

export const evidenceIds: EvidenceId[] = ['account_record', 'owner_trace'];
export const setupIds: SetupId[] = ['investigate', 'decide_verified', 'decide_unverified'];
export const endingIds: EndingId[] = [
  'transferred_too_early', 'turned_away', 'escalated_early', 'success', 'unverified_transfer',
  'declined_verified', 'declined_unverified', 'escalated_verified', 'escalated_unverified',
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
