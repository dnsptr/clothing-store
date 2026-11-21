import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('read-only CDEK check keeps OAuth credentials out of URLs and creates no shipment', { timeout: 15_000 }, async (t) => {
  const requests = [];
  let rejectAuth = false;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({ url: request.url, method: request.method, body: Buffer.concat(chunks).toString(), userAgent: request.headers['user-agent'] });

    let payload;
    if (request.url.startsWith('/v2/oauth/token')) {
      if (rejectAuth) {
        response.writeHead(401, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ message: 'denied fixture-secret' }));
        return;
      }
      payload = { access_token: 'fixture-access', expires_in: 3600 };
    } else if (request.url.startsWith('/v2/location/cities')) {
      payload = [{ city: 'Москва' }];
    } else if (request.url === '/v2/calculator/tarifflist') {
      payload = { tariff_codes: [{ tariff_code: 136 }, { tariff_code: 137 }] };
    } else if (request.url === '/v2/calculator/tariff') {
      payload = { delivery_sum: 150 };
    } else {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(payload));
  });
  t.after(() => server.close());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.notEqual(typeof address, 'string');

  const runCheck = async () => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../medusa-prototype/scripts/check-cdek.mjs', import.meta.url))], {
      env: {
        ...process.env,
        CDEK_API_BASE_URL: `http://127.0.0.1:${address.port}/v2`,
        CDEK_CLIENT_ID: 'fixture-id',
        CDEK_CLIENT_SECRET: 'fixture-secret',
        CDEK_FROM_CITY_CODE: '44',
        CDEK_TO_CITY_CODE: '137',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    const killTimer = setTimeout(() => child.kill(), 10_000);
    const [exitCode] = await once(child, 'close');
    clearTimeout(killTimer);
    return { exitCode, stdout, stderr };
  };
  const { exitCode, stdout, stderr } = await runCheck();

  assert.equal(exitCode, 0, stderr);
  const auth = requests.filter(({ url }) => url.startsWith('/v2/oauth/token'));
  assert.equal(auth.length, 1);
  assert.equal(auth[0].url, '/v2/oauth/token');
  assert.equal(auth[0].method, 'POST');
  const fields = new URLSearchParams(auth[0].body);
  assert.equal(fields.get('grant_type'), 'client_credentials');
  assert.equal(fields.get('client_id'), 'fixture-id');
  assert.equal(fields.get('client_secret'), 'fixture-secret');
  assert.match(stdout, /Tariff 137: OK/);
  assert.doesNotMatch(stdout + stderr, /fixture-secret/);
  assert.ok(requests.every(({ url }) => !url.startsWith('/v2/orders')));
  assert.ok(requests.every(({ userAgent }) => userAgent === 'MarioMikkeDeliveryCheck/1.0'));
  rejectAuth = true;
  requests.length = 0;
  const denied = await runCheck();
  assert.notEqual(denied.exitCode, 0);
  assert.match(denied.stderr, /OAuth: CDEK returned HTTP 401/);
  assert.doesNotMatch(denied.stderr, /fixture-secret/);
  assert.equal(requests.length, 1);
});
