import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';
import { AppError } from '../application/errors.js';

const ISSUER = 'https://render.okta.com';
type Jwk = JsonWebKey & { kid?: string };
let cached: { url: string; keys: Jwk[] } | undefined;

/** Forgets a cached Okta key set so tests can point at a new server. */
export function resetOktaKeys(): void {
  cached = undefined;
}

/** Reports whether this process must require a Render employee token. */
export function oktaRequired(): boolean {
  return process.env.OKTA_AUTH === 'on';
}

function decode(part: string): string {
  return Buffer.from(part, 'base64url').toString();
}

async function signingKeys(): Promise<Jwk[]> {
  const url = process.env.OKTA_JWKS_URL ?? `${ISSUER}/oauth2/v1/keys`;
  if (cached?.url === url) return cached.keys;
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new AppError(401, 'unauthorized', 'A Render sign-in is required.');
  const body = await response.json() as { keys?: Jwk[] };
  const keys = body.keys ?? [];
  cached = { url, keys };
  return keys;
}

/** Returns the employee email from a Render-forwarded Okta access token. */
export async function verifyEmployeeToken(token: string | undefined): Promise<string> {
  if (!token) throw new AppError(401, 'unauthorized', 'A Render sign-in is required.');
  try {
    const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
    if (!encodedHeader || !encodedPayload || !encodedSignature) throw new Error('malformed');
    const header = JSON.parse(decode(encodedHeader)) as { alg?: string; kid?: string };
    const payload = JSON.parse(decode(encodedPayload)) as { iss?: string; sub?: string; exp?: number };
    if (header.alg !== 'RS256') throw new Error('algorithm');
    if (payload.iss !== (process.env.OKTA_ISSUER ?? ISSUER)) throw new Error('issuer');
    if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) throw new Error('expired');
    const jwk = (await signingKeys()).find(key => key.kid === header.kid);
    if (!jwk) throw new Error('key');
    const valid = verify(
      'RSA-SHA256',
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      createPublicKey({ key: jwk, format: 'jwk' }),
      Buffer.from(encodedSignature, 'base64url'),
    );
    if (!valid) throw new Error('signature');
    if (!payload.sub?.endsWith('@render.com')) throw new AppError(401, 'unauthorized', 'This game is limited to Render employees.');
    return payload.sub;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(401, 'unauthorized', 'A Render sign-in is required.');
  }
}
