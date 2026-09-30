import { createHash } from 'node:crypto';
import type { AdventureDefinition } from '../adventure/definition.js';
import type { AICapabilities, GameAI } from '../application/ports.js';
import { assignStatEffects } from '../game/stats.js';
import type { InterpretedCommand } from '../game/types.js';

// Explicit offline adapter. It never claims that a model was called.
export class OfflineAI implements GameAI {
  readonly capabilities: AICapabilities = { mode: 'offline', natural_language: false, generation: true, narration: false };

  async generate(prompt: string, variationSeed: string): Promise<AdventureDefinition> {
    const variant = createHash('sha256').update(variationSeed).digest()[0]! % 2;
    const excerpt = prompt.trim().slice(0, 1000);
    const hub = variant ? 'Incident Bridge' : 'Operations Hub';
    const dashboard = variant ? 'Signal Observatory' : 'Render Dashboard';
    return assignStatEffects({
      schemaVersion: 2,
      title: variant ? 'The Signal in the Static' : 'The Render Daybook',
      objective: 'Understand the supplied Render situation and choose a sound response.',
      opening: `A new day-to-day Render case has arrived: ${excerpt}`,
      sourceFacts: [{ id: 'source_case', text: excerpt, sourceExcerpt: excerpt }],
      locations: [
        { id: 'ops_hub', name: hub, description: 'The case brief and a teammate are ready for review.' },
        { id: 'dashboard', name: dashboard, description: 'The relevant service signals wait for a careful investigation.' },
      ],
      entities: [
        { id: 'case_brief', name: 'case brief', description: 'The exact source situation.', kind: 'clue', locationId: 'ops_hub', portable: false },
        { id: 'teammate', name: 'teammate', description: 'A collaborator who can help frame the case.', kind: 'character', locationId: 'ops_hub', portable: false },
        { id: 'service_console', name: 'service console', description: 'A safe simulation of the operational decision.', kind: 'item', locationId: 'dashboard', portable: false },
      ],
      actions: [
        { id: 'read_brief', verbs: ['read', 'inspect', 'examine'], targetId: 'case_brief', label: 'Read the case brief', sourceFactIds: ['source_case'],
          requires: [{ kind: 'at', locationId: 'ops_hub' }], effects: [{ kind: 'reveal', factId: 'source_case' }], successText: `The brief confirms: ${excerpt}` },
        { id: 'consult', verbs: ['ask', 'consult'], targetId: 'teammate', label: 'Consult the teammate', sourceFactIds: ['source_case'],
          requires: [{ kind: 'at', locationId: 'ops_hub' }], effects: [{ kind: 'setFlag', flag: 'consulted', value: true }], successText: 'Your teammate recommends grounding every decision in the case details.' },
        { id: 'go_dashboard', verbs: ['go', 'enter'], targetId: 'dashboard', label: `Go to the ${dashboard}`, sourceFactIds: ['source_case'],
          requires: [{ kind: 'at', locationId: 'ops_hub' }], effects: [{ kind: 'move', locationId: 'dashboard' }], successText: `You enter the ${dashboard}.` },
        { id: 'go_hub', verbs: ['go', 'return'], targetId: 'ops_hub', label: `Return to the ${hub}`, sourceFactIds: ['source_case'],
          requires: [{ kind: 'at', locationId: 'dashboard' }], effects: [{ kind: 'move', locationId: 'ops_hub' }], successText: `You return to the ${hub}.` },
        { id: 'investigate', verbs: ['inspect', 'investigate', 'examine'], targetId: 'service_console', label: 'Investigate the service console', sourceFactIds: ['source_case'],
          requires: [{ kind: 'at', locationId: 'dashboard' }, { kind: 'fact', factId: 'source_case' }],
          effects: [{ kind: 'setFlag', flag: 'ready', value: true }], successText: 'You connect the simulated signals to the source case and prepare a grounded response.' },
        { id: 'resolve', verbs: ['resolve', 'respond'], targetId: 'service_console', label: 'Apply the grounded response', sourceFactIds: ['source_case'],
          requires: [{ kind: 'at', locationId: 'dashboard' }, { kind: 'flag', flag: 'ready', value: true }],
          effects: [{ kind: 'complete', endingId: 'grounded_success' }], successText: 'You act on the evidence and close the simulated case.' },
        { id: 'guess', verbs: ['guess', 'rush'], targetId: 'service_console', label: 'Rush an unsupported response', sourceFactIds: ['source_case'],
          requires: [{ kind: 'at', locationId: 'dashboard' }], effects: [{ kind: 'complete', endingId: 'unsupported_failure' }],
          successText: 'You act without examining the case, and the simulation records the avoidable mistake.' },
      ],
      stages: [
        { id: 'orient', label: 'Understand the case', when: [] },
        { id: 'investigate', label: 'Investigate the Render situation', when: [{ kind: 'fact', factId: 'source_case' }] },
        { id: 'respond', label: 'Choose the response', when: [{ kind: 'flag', flag: 'ready', value: true }] },
      ],
      endings: [
        { id: 'grounded_success', title: 'Grounded Resolution', result: 'success', summary: 'You used the supplied facts to make a defensible decision.' },
        { id: 'unsupported_failure', title: 'The Confident Guess', result: 'failure', summary: 'You acted before gathering the available context.' },
      ],
      initialState: {
        locationId: 'ops_hub', inventory: [], discoveredFacts: [],
        entityLocations: { case_brief: 'ops_hub', teammate: 'ops_hub', service_console: 'dashboard' },
        flags: {}, counters: {}, status: 'active', endingId: null,
      },
    });
  }

  async interpret(_text: string, _context: string, _vocabulary: { verbs: string[]; targets: string[] }): Promise<InterpretedCommand> {
    return { verb: 'unknown', target: '' };
  }
  async narrate(_facts: string, _context: string) { return ''; }
}
