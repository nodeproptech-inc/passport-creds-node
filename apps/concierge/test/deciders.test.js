import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDecider } from '../lib/deciders.js';

const ctx = { perTxCap: 200n * 10n ** 18n, casaBudget: 500n * 10n ** 18n };
const t = (amount, category = 'plumbing') =>
  ({ id: 1, description: 'x', vendor: 'plumber', amount: BigInt(amount) * 10n ** 18n, category });

test('mock decider pays routine under caps', async () => {
  const d = await makeDecider('mock')(t(120), ctx);
  assert.equal(d.action, 'pay');
  assert.ok(d.rationale.length > 0);
});

test('mock decider proposes above per-tx cap', async () => {
  assert.equal((await makeDecider('mock')(t(4500), ctx)).action, 'propose');
});

test('mock decider proposes above remaining budget', async () => {
  const d = await makeDecider('mock')(t(150), { ...ctx, casaBudget: 100n * 10n ** 18n });
  assert.equal(d.action, 'propose');
});

test('mock decider rejects unknown category', async () => {
  assert.equal((await makeDecider('mock')(t(10, 'jewelry'), ctx)).action, 'reject');
});

test('mock decider rationale states the comparison used', async () => {
  const d = await makeDecider('mock')(t(120), ctx);
  assert.match(d.rationale, /120\.0/);
  assert.match(d.rationale, /200\.0/);
  assert.match(d.rationale, /500\.0/);
  assert.ok(d.confidence >= 0 && d.confidence <= 1);
});

test('zerog decider is an explicit event-time stub', async () => {
  await assert.rejects(() => makeDecider('zerog')(t(10), ctx), /TODO\(event\)/);
});

test('unknown decider kind throws', () => {
  assert.throws(() => makeDecider('bogus-kind'), /unknown decider: bogus-kind/);
});

test('openai decider parses a well-formed strict-JSON reply', async (t2) => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '{"action":"pay","rationale":"looks fine","confidence":0.8}' } }],
      }),
    };
  };
  t2.after(() => { globalThis.fetch = originalFetch; });

  const decide = makeDecider('openai', { baseUrl: 'https://api.example.com/v1', model: 'gpt-test', apiKey: 'sk-test' });
  const d = await decide(t(120), ctx);
  assert.deepEqual(d, { action: 'pay', rationale: 'looks fine', confidence: 0.8 });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.example.com/v1/chat/completions');
  assert.equal(calls[0].init.headers.authorization, 'Bearer sk-test');
  const sentBody = JSON.parse(calls[0].init.body);
  assert.equal(sentBody.model, 'gpt-test');
});

test('openai decider omits Authorization header when no apiKey given', async (t2) => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push(init);
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"action":"pay","rationale":"ok","confidence":0.6}' } }] }),
    };
  };
  t2.after(() => { globalThis.fetch = originalFetch; });

  const decide = makeDecider('openai', { baseUrl: 'https://api.example.com/v1', model: 'gpt-test' });
  await decide(t(120), ctx);
  assert.equal(calls[0].headers.authorization, undefined);
});

test('openai decider falls back to mock on network error', async (t2) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network down'); };
  t2.after(() => { globalThis.fetch = originalFetch; });

  const decide = makeDecider('openai', { baseUrl: 'https://api.example.com/v1', model: 'gpt-test' });
  const d = await decide(t(120), ctx);
  assert.equal(d.action, 'pay');
  assert.match(d.rationale, / \(fallback: mock rules\)$/);
});

test('openai decider falls back to mock when the endpoint hangs past the timeout', async (t2) => {
  const originalFetch = globalThis.fetch;
  let sentSignal = null;
  // Never resolves on its own — only the request's own abort signal ends it,
  // exactly like a real endpoint that stopped answering.
  globalThis.fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      sentSignal = init.signal;
      init.signal.addEventListener('abort', () => reject(init.signal.reason));
    });
  // AbortSignal.timeout's timer is unref'd: with a stubbed fetch there is
  // nothing else pending, so the loop would drain before it fires. The real
  // server is held open by its HTTP listener; this stands in for that.
  const keepAlive = setInterval(() => {}, 5);
  t2.after(() => { globalThis.fetch = originalFetch; clearInterval(keepAlive); });

  const decide = makeDecider('openai', { baseUrl: 'https://api.example.com/v1', model: 'gpt-test', timeoutMs: 25 });
  const d = await decide(t(120), ctx);
  assert.ok(sentSignal instanceof AbortSignal, 'the request must carry an abort signal');
  assert.equal(sentSignal.aborted, true);
  assert.equal(d.action, 'pay');
  assert.match(d.rationale, / \(fallback: mock rules\)$/);
});

test('openai decider falls back to mock on a non-OK HTTP response', async (t2) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  t2.after(() => { globalThis.fetch = originalFetch; });

  const decide = makeDecider('openai', { baseUrl: 'https://api.example.com/v1', model: 'gpt-test' });
  const d = await decide(t(4500), ctx);
  assert.equal(d.action, 'propose');
  assert.match(d.rationale, / \(fallback: mock rules\)$/);
});

test('openai decider falls back to mock on malformed JSON reply content', async (t2) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: 'not json at all' } }] }),
  });
  t2.after(() => { globalThis.fetch = originalFetch; });

  const decide = makeDecider('openai', { baseUrl: 'https://api.example.com/v1', model: 'gpt-test' });
  const d = await decide(t(4500), ctx);
  assert.equal(d.action, 'propose');
  assert.match(d.rationale, / \(fallback: mock rules\)$/);
});

test('openai decider falls back to mock on an invalid action value', async (t2) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: '{"action":"maybe","rationale":"idk","confidence":0.5}' } }],
    }),
  });
  t2.after(() => { globalThis.fetch = originalFetch; });

  const decide = makeDecider('openai', { baseUrl: 'https://api.example.com/v1', model: 'gpt-test' });
  const d = await decide(t(10, 'jewelry'), ctx);
  assert.equal(d.action, 'reject');
  assert.match(d.rationale, / \(fallback: mock rules\)$/);
});
