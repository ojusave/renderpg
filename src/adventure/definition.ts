export type EndingResult = 'success' | 'partial_success' | 'failure';
export const STAT_IDS = ['energy', 'focus', 'reputation', 'team_trust'] as const;
export type StatId = (typeof STAT_IDS)[number];
export type Stats = Record<StatId, number>;
export type ChoiceTone = 'careful' | 'team' | 'bold' | 'reckless';
export const INITIAL_STATS: Stats = { energy: 72, focus: 64, reputation: 58, team_trust: 70 };

export interface SourceFact {
  id: string;
  text: string;
  sourceExcerpt: string;
}

export interface LocationDefinition {
  id: string;
  name: string;
  description: string;
}

export interface EntityDefinition {
  id: string;
  name: string;
  description: string;
  kind: 'item' | 'character' | 'clue';
  locationId: string;
  portable: boolean;
}

export type Predicate =
  | { kind: 'at'; locationId: string }
  | { kind: 'has'; entityId: string }
  | { kind: 'fact'; factId: string }
  | { kind: 'flag'; flag: string; value: boolean }
  | { kind: 'counter'; counter: string; operator: 'eq' | 'gte' | 'lte'; value: number };

export type Effect =
  | { kind: 'move'; locationId: string }
  | { kind: 'take'; entityId: string }
  | { kind: 'drop'; entityId: string; locationId: string }
  | { kind: 'reveal'; factId: string }
  | { kind: 'setFlag'; flag: string; value: boolean }
  | { kind: 'addCounter'; counter: string; amount: number }
  | { kind: 'adjustStat'; stat: StatId; amount: number }
  | { kind: 'complete'; endingId: string };

export interface ActionDefinition {
  id: string;
  verbs: string[];
  targetId: string | null;
  label: string;
  sourceFactIds: string[];
  requires: Predicate[];
  effects: Effect[];
  successText: string;
  tone?: ChoiceTone;
}

export interface StageDefinition {
  id: string;
  label: string;
  when: Predicate[];
}

export interface EndingDefinition {
  id: string;
  title: string;
  result: EndingResult;
  summary: string;
}

export interface AdventureState {
  locationId: string;
  inventory: string[];
  discoveredFacts: string[];
  entityLocations: Record<string, string>;
  flags: Record<string, boolean>;
  counters: Record<string, number>;
  stats?: Stats;
  statChanges?: Partial<Stats>;
  status: 'active' | 'completed';
  endingId: string | null;
  pendingVerb?: string;
}

export interface AdventureDefinition {
  schemaVersion: 2;
  title: string;
  objective: string;
  opening: string;
  sourceFacts: SourceFact[];
  locations: LocationDefinition[];
  entities: EntityDefinition[];
  actions: ActionDefinition[];
  stages: StageDefinition[];
  endings: EndingDefinition[];
  initialState: AdventureState;
}
