import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { createRiffServer } from './server.mjs';

const server = createRiffServer();
let port;
before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});
after(() => new Promise((resolve) => server.close(resolve)));

function request({ headers = {}, path = '/', method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, headers, path, method }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('serves the app through both loopback hostnames', async () => {
  for (const host of [`127.0.0.1:${port}`, `localhost:${port}`]) {
    const res = await request({ headers: { Host: host, Origin: `http://${host}`, 'Sec-Fetch-Site': 'same-origin' } });
    assert.equal(res.status, 200);
    assert.match(res.body, /RIFF/);
  }
});

test('rejects foreign Host and Origin before starting an audio download', async () => {
  for (const headers of [
    { Host: `attacker.example:${port}` },
    { Origin: 'https://attacker.example' },
    { Origin: 'null' },
    { 'Sec-Fetch-Site': 'cross-site' },
    { 'Sec-Fetch-Site': 'same-site' },
  ]) {
    const res = await request({ headers, path: '/api/audio?url=https://youtu.be/abcdefghijk' });
    assert.equal(res.status, 403);
  }
});

test('a malformed request URL returns 400 without taking down the server', async () => {
  assert.equal((await request({ path: 'http://[' })).status, 400);
  assert.equal((await request()).status, 200);
});

test('keeps missing routes, unsupported methods, and input errors distinct', async () => {
  assert.equal((await request({ path: '/missing' })).status, 404);
  assert.equal((await request({ method: 'POST' })).status, 405);
  assert.equal((await request({ path: '/api/audio?url=invalid' })).status, 400);
});
