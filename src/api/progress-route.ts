import type { FastifyInstance } from 'fastify';
import { AppError } from '../application/errors.js';
import type { ScenarioService } from '../application/scenario-service.js';

const bearer = (authorization?: string) => {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization ?? '');
  if (!match) throw new AppError(401, 'unauthorized', 'A valid session bearer token is required.');
  return match[1]!;
};

/** Streams fill progress for the signed-in session until the task finishes. */
export function registerProgress(app: FastifyInstance, scenarios: ScenarioService): void {
  app.get('/sessions/current/progress', async (request, reply) => {
    const header = request.headers.authorization;
    const token = bearer(Array.isArray(header) ? header[0] : header);
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const abort = new AbortController();
    const stop = () => abort.abort();
    request.raw.on('close', stop);
    const beat = setInterval(() => { if (!abort.signal.aborted) reply.raw.write(': ping\n\n'); }, 15000);
    const write = (payload: unknown) => {
      if (!abort.signal.aborted) reply.raw.write(`event: progress\ndata: ${JSON.stringify(payload)}\n\n`);
    };
    try {
      await scenarios.watch(token, abort.signal, write);
    } catch (error) {
      const message = error instanceof AppError ? error.message : 'Progress is unavailable.';
      if (!abort.signal.aborted) reply.raw.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
    } finally {
      clearInterval(beat);
      request.raw.off('close', stop);
      reply.raw.end();
    }
  });
}
