const id = { type: 'string', pattern: '^[a-z][a-z0-9_-]{0,63}$' };
const text = { type: 'string', minLength: 1, maxLength: 1200 };
const shortText = { type: 'string', minLength: 1, maxLength: 200 };
const predicate = {
  oneOf: [
    { type: 'object', additionalProperties: false, required: ['kind', 'locationId'], properties: { kind: { const: 'at' }, locationId: id } },
    { type: 'object', additionalProperties: false, required: ['kind', 'entityId'], properties: { kind: { const: 'has' }, entityId: id } },
    { type: 'object', additionalProperties: false, required: ['kind', 'factId'], properties: { kind: { const: 'fact' }, factId: id } },
    { type: 'object', additionalProperties: false, required: ['kind', 'flag', 'value'], properties: { kind: { const: 'flag' }, flag: id, value: { type: 'boolean' } } },
    { type: 'object', additionalProperties: false, required: ['kind', 'counter', 'operator', 'value'], properties: {
      kind: { const: 'counter' }, counter: id, operator: { enum: ['eq', 'gte', 'lte'] }, value: { type: 'integer', minimum: -20, maximum: 20 },
    } },
  ],
};
const effect = {
  oneOf: [
    { type: 'object', additionalProperties: false, required: ['kind', 'locationId'], properties: { kind: { const: 'move' }, locationId: id } },
    { type: 'object', additionalProperties: false, required: ['kind', 'entityId'], properties: { kind: { const: 'take' }, entityId: id } },
    { type: 'object', additionalProperties: false, required: ['kind', 'entityId', 'locationId'], properties: { kind: { const: 'drop' }, entityId: id, locationId: id } },
    { type: 'object', additionalProperties: false, required: ['kind', 'factId'], properties: { kind: { const: 'reveal' }, factId: id } },
    { type: 'object', additionalProperties: false, required: ['kind', 'flag', 'value'], properties: { kind: { const: 'setFlag' }, flag: id, value: { type: 'boolean' } } },
    { type: 'object', additionalProperties: false, required: ['kind', 'counter', 'amount'], properties: { kind: { const: 'addCounter' }, counter: id, amount: { type: 'integer', minimum: -5, maximum: 5 } } },
    { type: 'object', additionalProperties: false, required: ['kind', 'stat', 'amount'], properties: {
      kind: { const: 'adjustStat' }, stat: { enum: ['energy', 'focus', 'reputation', 'team_trust'] }, amount: { type: 'integer', minimum: -20, maximum: 20 },
    } },
    { type: 'object', additionalProperties: false, required: ['kind', 'endingId'], properties: { kind: { const: 'complete' }, endingId: id } },
  ],
};
const array = (items: unknown, minItems = 0, maxItems = 30) => ({ type: 'array', items, minItems, maxItems });

export const adventureSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'title', 'objective', 'opening', 'sourceFacts', 'locations', 'entities', 'actions', 'stages', 'endings', 'initialState'],
  properties: {
    schemaVersion: { const: 2 },
    title: shortText,
    objective: text,
    opening: text,
    sourceFacts: array({ type: 'object', additionalProperties: false, required: ['id', 'text', 'sourceExcerpt'], properties: { id, text, sourceExcerpt: text } }, 1, 12),
    locations: array({ type: 'object', additionalProperties: false, required: ['id', 'name', 'description'], properties: { id, name: shortText, description: text } }, 2, 8),
    entities: array({ type: 'object', additionalProperties: false, required: ['id', 'name', 'description', 'kind', 'locationId', 'portable'], properties: {
      id, name: shortText, description: text, kind: { enum: ['item', 'character', 'clue'] }, locationId: id, portable: { type: 'boolean' },
    } }, 1, 16),
    actions: array({ type: 'object', additionalProperties: false, required: ['id', 'verbs', 'targetId', 'label', 'sourceFactIds', 'requires', 'effects', 'successText'], properties: {
      id, verbs: array(id, 1, 5), targetId: { anyOf: [id, { type: 'null' }] }, label: shortText,
      sourceFactIds: array(id, 1, 6), requires: array(predicate, 0, 8), effects: array(effect, 1, 12), successText: text,
      tone: { enum: ['careful', 'team', 'bold', 'reckless'] },
    } }, 4, 24),
    stages: array({ type: 'object', additionalProperties: false, required: ['id', 'label', 'when'], properties: {
      id, label: shortText, when: array(predicate, 0, 8),
    } }, 1, 8),
    endings: array({ type: 'object', additionalProperties: false, required: ['id', 'title', 'result', 'summary'], properties: {
      id, title: shortText, result: { enum: ['success', 'partial_success', 'failure'] }, summary: text,
    } }, 2, 5),
    initialState: {
      type: 'object', additionalProperties: false,
      required: ['locationId', 'inventory', 'discoveredFacts', 'entityLocations', 'flags', 'counters', 'status', 'endingId'],
      properties: {
        locationId: id, inventory: array(id, 0, 16), discoveredFacts: array(id, 0, 12),
        entityLocations: { type: 'object', additionalProperties: id },
        flags: { type: 'object', additionalProperties: { type: 'boolean' } },
        counters: { type: 'object', additionalProperties: { type: 'integer', minimum: -20, maximum: 20 } },
        stats: { type: 'object', additionalProperties: false, required: ['energy', 'focus', 'reputation', 'team_trust'], properties: {
          energy: { type: 'integer', minimum: 0, maximum: 100 }, focus: { type: 'integer', minimum: 0, maximum: 100 },
          reputation: { type: 'integer', minimum: 0, maximum: 100 }, team_trust: { type: 'integer', minimum: 0, maximum: 100 },
        } },
        status: { const: 'active' }, endingId: { type: 'null' },
      },
    },
  },
} as const;
