import type { AdventureGenerator } from '../application/ports.js';
import type { AdventureDefinition } from './definition.js';
import { repairAdventure } from './repair.js';
import { assignStatEffects } from '../game/stats.js';
import { simulateAdventure, type SimulationReport } from './simulator.js';
import { validateAdventure, type ValidationReport } from './validator.js';

export interface CompiledAdventure {
  definition: AdventureDefinition;
  validation: ValidationReport & { simulation: SimulationReport };
}

/** Generates, validates, and proves a playable adventure before publication. */
export class AdventureCompiler {
  constructor(private generator: AdventureGenerator, private report: (event: string) => void = () => {}) {}

  async compile(prompt: string, variationSeed: string): Promise<CompiledAdventure> {
    let feedback: string[] | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      const started = Date.now();
      const definition = assignStatEffects(repairAdventure(await this.generator.generate(prompt, variationSeed, feedback)));
      this.report(`generation_attempt_ms: ${Date.now() - started}`);
      const validation = validateAdventure(definition, prompt);
      const simulation = validation.valid
        ? simulateAdventure(definition)
        : { valid: false, reachableEndings: [], exploredStates: 0, errors: [] };
      if (validation.valid && simulation.valid) return { definition, validation: { ...validation, simulation } };
      feedback = [...validation.errors, ...simulation.errors];
      this.report(`${attempt < 2 ? 'generation_repair_requested' : 'generation_invalid'}: ${feedback.join(' | ')}`);
    }
    throw new Error(`Adventure generation failed validation: ${feedback?.join('; ')}`);
  }
}
