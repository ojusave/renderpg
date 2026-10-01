export const blueprintId = 'account_ownership_v3' as const;

export const actionIds = [
  'open_record',
  'transfer_now',
  'turn_away',
  'trace_owner',
  'take_word',
  'escalate_early',
  'transfer_account',
  'decline_transfer',
  'escalate',
] as const;

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
export const accountOwnershipBlueprint: { id: typeof blueprintId; version: 3; stages: StageSlot[] } = {
  id: blueprintId,
  version: 3,
  stages: [
    { id: 'intake', label: 'What do you do first?', actions: ['open_record', 'transfer_now', 'turn_away'] },
    { id: 'investigate', label: 'How do you identify the rightful owner?', actions: ['trace_owner', 'take_word', 'escalate_early'] },
    { id: 'decide', label: 'What is your decision?', actions: ['transfer_account', 'decline_transfer', 'escalate'] },
    { id: 'resolution', label: 'Resolution', actions: [] },
  ],
};

export const evidenceIds: EvidenceId[] = ['account_record', 'owner_trace'];
export const setupIds: SetupId[] = ['investigate', 'decide_verified', 'decide_unverified'];
export const endingIds: EndingId[] = [
  'transferred_too_early', 'turned_away', 'escalated_early', 'success', 'unverified_transfer',
  'declined_verified', 'declined_unverified', 'escalated_verified', 'escalated_unverified',
];

export const poolTarget = 3;
export const staleFillMs = 15 * 60 * 1000;
