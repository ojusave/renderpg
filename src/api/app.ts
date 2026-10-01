import Fastify, { type FastifyError } from 'fastify';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { GameService } from '../application/game-service.js';
import { ScenarioService } from '../application/scenario-service.js';
import { AppError } from '../application/errors.js';
import type { GameRepository } from '../application/ports.js';
import { contract, routeSchema } from './contract.js';
import { oktaRequired, verifyEmployeeToken } from './okta.js';

export function buildApp(service: GameService, repo: GameRepository, logging = false, scenarios?: ScenarioService) {
  const app = Fastify({ logger: logging ? { redact: ['req.headers.authorization', 'req.headers.idempotency-key', 'req.headers["x-forwarded-access-token"]'] } : false, bodyLimit: 16384 });
  const ajv = new Ajv2020({ strict: false, allErrors: true, coerceTypes: false });
  const addFormats = addFormatsModule as unknown as (instance: Ajv2020) => void;
  addFormats(ajv);
  app.setValidatorCompiler(({ schema }) => ajv.compile(schema));
  app.setSerializerCompiler(({ schema }) => {
    const validate = ajv.compile(schema);
    return data => { if (!validate(data)) throw new Error('Response violated the API contract'); return JSON.stringify(data); };
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) return reply.code(error.status).send({ code: error.code, message: error.message, retryable: error.retryable });
    const failure = error as Partial<FastifyError>;
    if (failure.validation || failure.statusCode === 400 || failure.statusCode === 415) return reply.code(422).send({ code: 'invalid_request', message: 'Request does not match the API contract.', retryable: false });
    if (failure.statusCode === 413) return reply.code(413).send({ code: 'payload_too_large', message: 'Request body is too large.', retryable: false });
    request.log.error({ event: 'request_failed', requestId: request.id });
    return reply.code(503).send({ code: 'dependency_unavailable', message: 'The service is temporarily unavailable. Retry with the same request key.', retryable: true });
  });
  app.addHook('onRequest', async request => {
    if (!oktaRequired() || request.url.split('?')[0] === '/health') return;
    const header = request.headers['x-forwarded-access-token'];
    await verifyEmployeeToken(Array.isArray(header) ? header[0] : header);
  });
  app.get('/health', { schema: routeSchema('/health', 'get') }, async () => { await repo.health(); return { status: 'ok', ai: service.capabilities }; });
  app.get('/openapi.json', async () => contract);
  const bearer = (authorization?: string) => {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization ?? '');
    if (!match) throw new AppError(401, 'unauthorized', 'A valid session bearer token is required.');
    return match[1]!;
  };
  app.post<{ Body: { prompt: string }; Headers: { 'idempotency-key': string } }>('/games',
    { schema: routeSchema('/games', 'post') }, async (request, reply) => {
      const created = await service.create(request.headers['idempotency-key'], request.body.prompt);
      return 'game' in created ? reply.code(201).send(created) : reply.code(202).send(created);
    });
  app.get<{ Params: { run_id: string } }>('/games/generations/:run_id',
    { schema: routeSchema('/games/generations/{run_id}', 'get') }, async request => service.generation(request.params.run_id));
  app.get<{ Params: { game_id: string } }>('/games/:game_id',
    { schema: routeSchema('/games/{game_id}', 'get') }, async request => service.get(request.params.game_id, bearer(request.headers.authorization)));
  if (scenarios) {
    app.post('/sessions', { schema: routeSchema('/sessions', 'post') }, async () => scenarios.signIn());
    app.get('/sessions/current', { schema: routeSchema('/sessions/current', 'get') }, async request => scenarios.current(bearer(request.headers.authorization)));
    app.post('/sessions/current/begin', { schema: routeSchema('/sessions/current/begin', 'post') }, async request => scenarios.begin(bearer(request.headers.authorization)));
    app.post<{ Body: { action_id: string; expected_version: number }; Headers: { 'idempotency-key': string } }>('/sessions/current/choices',
      { schema: routeSchema('/sessions/current/choices', 'post') }, async request => scenarios.choose(
        bearer(request.headers.authorization), request.headers['idempotency-key'], request.body.action_id, request.body.expected_version));
  }
  app.post<{ Params: { game_id: string }; Body: { text: string; expected_version: number }; Headers: { 'idempotency-key': string } }>('/games/:game_id/turns',
    { schema: routeSchema('/games/{game_id}/turns', 'post') }, async request => {
      if (!request.body.text.trim()) throw new AppError(422, 'invalid_request', 'Command cannot be blank.');
      return service.submit(request.params.game_id, bearer(request.headers.authorization), request.headers['idempotency-key'], request.body.text, request.body.expected_version);
    });
  return app;
}
