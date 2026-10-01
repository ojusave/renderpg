import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import { GameService } from '../src/application/game-service.js';
import { OfflineAI } from '../src/adapters/offline-ai.js';
import { buildApp } from '../src/api/app.js';
import { resetOktaKeys } from '../src/api/okta.js';
import { MemoryRepository } from './helpers.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });
jwk.kid = 'test';

function employeeToken(subject: string, expiresIn = 300): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'https://render.okta.com',
    sub: subject,
    exp: Math.floor(Date.now() / 1000) + expiresIn,
  })).toString('base64url');
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

test('the game API accepts only a Render employee token when Okta is on', async t => {
  const keys = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>(resolve => keys.listen(0, '127.0.0.1', resolve));
  const port = (keys.address() as { port: number }).port;
  const previous = { auth: process.env.OKTA_AUTH, jwks: process.env.OKTA_JWKS_URL };
  process.env.OKTA_AUTH = 'on';
  process.env.OKTA_JWKS_URL = `http://127.0.0.1:${port}/keys`;
  resetOktaKeys();
  const repo = new MemoryRepository();
  const app = buildApp(new GameService(repo, new OfflineAI(), 's'.repeat(32)), repo);
  t.after(async () => {
    process.env.OKTA_AUTH = previous.auth;
    process.env.OKTA_JWKS_URL = previous.jwks;
    resetOktaKeys();
    await app.close();
    await new Promise<void>(resolve => keys.close(() => resolve()));
  });

  assert.equal((await app.inject({ url: '/health' })).statusCode, 200);
  assert.equal((await app.inject({ url: '/games/game-1' })).statusCode, 401);
  assert.equal((await app.inject({
    url: '/games/game-1',
    headers: { 'x-forwarded-access-token': employeeToken('visitor@example.com') },
  })).json().message, 'This game is limited to Render employees.');
  const employee = employeeToken('alex@render.com');
  const created = await app.inject({
    method: 'POST', url: '/games',
    headers: { 'idempotency-key': randomUUID(), 'x-forwarded-access-token': employee },
    payload: { prompt: 'A Render teammate investigates a failed deploy and should inspect the available evidence before responding.' },
  });
  assert.equal(created.statusCode, 201, created.body);
  const allowed = await app.inject({
    url: `/games/${created.json().game.id}`,
    headers: { 'x-forwarded-access-token': employee },
  });
  assert.equal(allowed.statusCode, 401);
  assert.match(allowed.json().message, /session bearer token/);
});
