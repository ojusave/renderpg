export const blueprintId = 'account_ownership_v1' as const;

export const actionIds = [
  'review_account_record',
  'check_ownership_history',
  'verify_requester_authority',
  'request_more_evidence',
  'transfer_account',
  'decline_transfer',
  'escalate',
] as const;

export type ActionId = (typeof actionIds)[number];
export type StageId = 'review' | 'verify' | 'decide' | 'resolution';
export type EvidenceId = 'account_record' | 'ownership_history' | 'requester_authority';
export type EndingId = 'success' | 'escalation' | 'incorrect_transfer' | 'declined';

export interface StageSlot {
  id: StageId;
  label: string;
  actions: ActionId[];
}

/** Authored investigation flow. The model cannot add stages or actions. */
export const accountOwnershipBlueprint: { id: typeof blueprintId; version: 1; stages: StageSlot[] } = {
  id: blueprintId,
  version: 1,
  stages: [
    { id: 'review', label: 'What do you examine first?', actions: ['review_account_record', 'check_ownership_history', 'escalate'] },
    { id: 'verify', label: 'How do you treat the request?', actions: ['verify_requester_authority', 'request_more_evidence', 'transfer_account'] },
    { id: 'decide', label: 'What is your decision?', actions: ['transfer_account', 'decline_transfer', 'escalate'] },
    { id: 'resolution', label: 'Resolution', actions: [] },
  ],
};

export const evidenceIds: EvidenceId[] = ['account_record', 'ownership_history', 'requester_authority'];
export const endingIds: EndingId[] = ['success', 'escalation', 'incorrect_transfer', 'declined'];

export const poolTarget = 3;
export const staleFillMs = 15 * 60 * 1000;
