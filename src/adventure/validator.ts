import { Ajv2020 } from 'ajv/dist/2020.js';
import type { AdventureDefinition, Effect, Predicate } from './definition.js';
import { adventureSchema } from './schema.js';

export interface ValidationReport { valid: boolean; errors: string[] }

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateSchema = ajv.compile(adventureSchema);
const ids = (values: { id: string }[]) => new Set(values.map(value => value.id));
const duplicates = (values: { id: string }[]) => values.filter((value, index) => values.findIndex(other => other.id === value.id) !== index).map(value => value.id);

function referenceErrors(definition: AdventureDefinition): string[] {
  const errors: string[] = [];
  const locations = ids(definition.locations);
  const entities = ids(definition.entities);
  const facts = ids(definition.sourceFacts);
  const endings = ids(definition.endings);
  const checkPredicate = (predicate: Predicate, owner: string) => {
    if (predicate.kind === 'at' && !locations.has(predicate.locationId)) errors.push(`${owner} references unknown location ${predicate.locationId}`);
    if (predicate.kind === 'has' && !entities.has(predicate.entityId)) errors.push(`${owner} references unknown entity ${predicate.entityId}`);
    if (predicate.kind === 'fact' && !facts.has(predicate.factId)) errors.push(`${owner} references unknown fact ${predicate.factId}`);
  };
  const checkEffect = (effect: Effect, owner: string) => {
    if (effect.kind === 'move' && !locations.has(effect.locationId)) errors.push(`${owner} moves to unknown location ${effect.locationId}`);
    if ((effect.kind === 'take' || effect.kind === 'drop') && !entities.has(effect.entityId)) errors.push(`${owner} references unknown entity ${effect.entityId}`);
    if (effect.kind === 'drop' && !locations.has(effect.locationId)) errors.push(`${owner} drops into unknown location ${effect.locationId}`);
    if (effect.kind === 'reveal' && !facts.has(effect.factId)) errors.push(`${owner} reveals unknown fact ${effect.factId}`);
    if (effect.kind === 'complete' && !endings.has(effect.endingId)) errors.push(`${owner} completes unknown ending ${effect.endingId}`);
  };
  for (const group of [definition.locations, definition.entities, definition.sourceFacts, definition.actions, definition.stages, definition.endings]) {
    for (const duplicate of duplicates(group)) errors.push(`Duplicate id ${duplicate}`);
  }
  if (!locations.has(definition.initialState.locationId)) errors.push('Initial state has an unknown location');
  for (const entityId of definition.initialState.inventory) if (!entities.has(entityId)) errors.push(`Initial inventory references unknown entity ${entityId}`);
  for (const factId of definition.initialState.discoveredFacts) if (!facts.has(factId)) errors.push(`Initial state references unknown fact ${factId}`);
  for (const [entityId, locationId] of Object.entries(definition.initialState.entityLocations)) {
    if (!entities.has(entityId)) errors.push(`Initial state places unknown entity ${entityId}`);
    if (!locations.has(locationId)) errors.push(`Initial state places ${entityId} in unknown location ${locationId}`);
  }
  for (const entity of definition.entities) {
    if (!locations.has(entity.locationId)) errors.push(`Entity ${entity.id} has an unknown location`);
    if (definition.initialState.entityLocations[entity.id] !== entity.locationId && !definition.initialState.inventory.includes(entity.id)) {
      errors.push(`Initial location for ${entity.id} does not match its definition`);
    }
  }
  for (const action of definition.actions) {
    if (action.targetId && !locations.has(action.targetId) && !entities.has(action.targetId)) errors.push(`Action ${action.id} has unknown target ${action.targetId}`);
    for (const fact of action.sourceFactIds) if (!facts.has(fact)) errors.push(`Action ${action.id} references unknown source fact ${fact}`);
    action.requires.forEach(predicate => checkPredicate(predicate, `Action ${action.id}`));
    action.effects.forEach(effect => checkEffect(effect, `Action ${action.id}`));
    for (const effect of action.effects) {
      if (effect.kind === 'take' && !definition.entities.find(entity => entity.id === effect.entityId)?.portable) {
        errors.push(`Action ${action.id} takes non-portable entity ${effect.entityId}`);
      }
    }
  }
  for (const stage of definition.stages) stage.when.forEach(predicate => checkPredicate(predicate, `Stage ${stage.id}`));
  return errors;
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Validates graph structure, references, endings, and prompt provenance. */
export function validateAdventure(value: unknown, sourcePrompt: string): ValidationReport {
  if (!validateSchema(value)) {
    return { valid: false, errors: (validateSchema.errors ?? []).map(error => `${error.instancePath || '/'} ${error.message}`) };
  }
  const definition = value as AdventureDefinition;
  const errors = referenceErrors(definition);
  const prompt = normalized(sourcePrompt);
  for (const fact of definition.sourceFacts) {
    if (!prompt.includes(normalized(fact.sourceExcerpt))) errors.push(`Source excerpt for ${fact.id} does not occur in the prompt`);
  }
  if (!definition.endings.some(ending => ending.result === 'success')) errors.push('Adventure needs a success ending');
  if (!definition.endings.some(ending => ending.result === 'failure')) errors.push('Adventure needs a failure ending');
  return { valid: errors.length === 0, errors };
}
