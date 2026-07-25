import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createVendorServer } from '../vendor/server.js';
import { settleInvoice } from '../lib/x402.js';

const VENDOR_ADDRESS = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'; // test vendor payout address
const ATTACKER_ADDRESS = '0x14dC79964da2C08b23698B3D3cc7Ca32193d9955'; // some other wallet entirely
const TOKEN_ADDRESS = '0x172076E0166D1F9Cc711C77Adf8488051744980C'; // mUSD (from addresses.json)
const AMOUNT = '1000000000000000000'; // 1 mUSD, 18 decimals, wei string

// What the caller (server.js) knows independently of the vendor: the asset and
// the payout wallet it is willing to pay.
const EXPECTED = { asset: TOKEN_ADDRESS, payTo: VENDOR_ADDRESS };

// Starts createVendorServer on an ephemeral port with the given stubbed
// verifier and waits for it to actually be listening before handing back
// its base URL, so callers never race the bind.
async function startVendor(verify) {
  const server = createVendorServer({
    port: 0,
    vendorAddress: VENDOR_ADDRESS,
    tokenAddress: TOKEN_ADDRESS,
    rpcUrl: 'http://127.0.0.1:8545',
    verify,
  });
  await once(server, 'listening');
  const { port } = server.address();
  return { server, vendorUrl: `http://127.0.0.1:${port}` };
}

// A vendor that answers /invoice with exactly the status and body the test
// hands it — the compromised counterparty the client must not trust.
async function startHostileVendor(status, body) {
  const server = http.createServer((_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return { server, vendorUrl: `http://127.0.0.1:${port}` };
}

// A well-formed 402 body, with `over` merged into the single offer.
const challengeBody = (over = {}) => ({
  x402Version: 1,
  accepts: [
    { scheme: 'exact', network: 'eip155-local', asset: TOKEN_ADDRESS, amount: AMOUNT, payTo: VENDOR_ADDRESS, ...over },
  ],
});

// payFn that records every call, so a test can assert it was never reached.
function spyPayFn() {
  const calls = [];
  const fn = async (accept) => {
    calls.push(accept);
    return '0xspy';
  };
  fn.calls = calls;
  return fn;
}

test('POST /invoice with no X-PAYMENT header returns a 402 exact-scheme challenge', async (t) => {
  const { server, vendorUrl } = await startVendor(async () => true);
  t.after(() => server.close());

  const res = await fetch(`${vendorUrl}/invoice`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId: 'job-1', amount: AMOUNT }),
  });

  assert.equal(res.status, 402);
  const body = await res.json();
  assert.equal(body.x402Version, 1);
  assert.equal(body.accepts[0].scheme, 'exact');
  assert.equal(body.accepts[0].payTo, VENDOR_ADDRESS);
  assert.equal(body.accepts[0].asset, TOKEN_ADDRESS);
});

test('settleInvoice pays via payFn on 402 and reports success once verified', async (t) => {
  const { server, vendorUrl } = await startVendor(async () => true);
  t.after(() => server.close());

  const calls = [];
  const payFn = async (accept) => {
    calls.push(accept);
    return '0xabc';
  };

  const result = await settleInvoice({ vendorUrl, jobId: 'job-2', amount: AMOUNT, payFn, expected: EXPECTED });

  assert.deepEqual(result, { paid: true, txHash: '0xabc' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payTo, VENDOR_ADDRESS);
  assert.equal(calls[0].scheme, 'exact');
});

test('settleInvoice reports unpaid when the vendor cannot verify the payment', async (t) => {
  const { server, vendorUrl } = await startVendor(async () => false);
  t.after(() => server.close());

  const result = await settleInvoice({
    vendorUrl,
    jobId: 'job-3',
    amount: AMOUNT,
    payFn: async () => '0xdead',
    expected: EXPECTED,
  });

  assert.equal(result.paid, false);
});

test('settleInvoice never pays when the vendor answers a non-402 status', async (t) => {
  const { server, vendorUrl } = await startHostileVendor(500, challengeBody());
  t.after(() => server.close());

  const payFn = spyPayFn();
  const result = await settleInvoice({ vendorUrl, jobId: 'job-4', amount: AMOUNT, payFn, expected: EXPECTED });

  assert.deepEqual(result, { paid: false, txHash: null, error: 'unexpected status 500' });
  assert.equal(payFn.calls.length, 0);
});

test('settleInvoice never pays a payTo other than the expected recipient', async (t) => {
  const { server, vendorUrl } = await startHostileVendor(402, challengeBody({ payTo: ATTACKER_ADDRESS }));
  t.after(() => server.close());

  const payFn = spyPayFn();
  const result = await settleInvoice({ vendorUrl, jobId: 'job-5', amount: AMOUNT, payFn, expected: EXPECTED });

  assert.deepEqual(result, { paid: false, txHash: null, error: 'challenge mismatch: payTo' });
  assert.equal(payFn.calls.length, 0);
});

test('settleInvoice never pays an amount other than the invoice it asked for', async (t) => {
  const inflated = (BigInt(AMOUNT) * 500n).toString();
  const { server, vendorUrl } = await startHostileVendor(402, challengeBody({ amount: inflated }));
  t.after(() => server.close());

  const payFn = spyPayFn();
  const result = await settleInvoice({ vendorUrl, jobId: 'job-6', amount: AMOUNT, payFn, expected: EXPECTED });

  assert.deepEqual(result, { paid: false, txHash: null, error: 'challenge mismatch: amount' });
  assert.equal(payFn.calls.length, 0);
});

test('settleInvoice never pays a scheme other than exact', async (t) => {
  const { server, vendorUrl } = await startHostileVendor(402, challengeBody({ scheme: 'upto' }));
  t.after(() => server.close());

  const payFn = spyPayFn();
  const result = await settleInvoice({ vendorUrl, jobId: 'job-7', amount: AMOUNT, payFn, expected: EXPECTED });

  assert.deepEqual(result, { paid: false, txHash: null, error: 'challenge mismatch: scheme' });
  assert.equal(payFn.calls.length, 0);
});

test('settleInvoice never pays an asset other than the expected token', async (t) => {
  const { server, vendorUrl } = await startHostileVendor(402, challengeBody({ asset: ATTACKER_ADDRESS }));
  t.after(() => server.close());

  const payFn = spyPayFn();
  const result = await settleInvoice({ vendorUrl, jobId: 'job-8', amount: AMOUNT, payFn, expected: EXPECTED });

  assert.deepEqual(result, { paid: false, txHash: null, error: 'challenge mismatch: asset' });
  assert.equal(payFn.calls.length, 0);
});

test('settleInvoice never pays on a malformed challenge body', async (t) => {
  const { server, vendorUrl } = await startHostileVendor(402, { x402Version: 1, accepts: [] });
  t.after(() => server.close());

  const payFn = spyPayFn();
  const result = await settleInvoice({ vendorUrl, jobId: 'job-9', amount: AMOUNT, payFn, expected: EXPECTED });

  assert.deepEqual(result, { paid: false, txHash: null, error: 'malformed challenge' });
  assert.equal(payFn.calls.length, 0);
});

test('unknown routes return 404 JSON', async (t) => {
  const { server, vendorUrl } = await startVendor(async () => true);
  t.after(() => server.close());

  const res = await fetch(`${vendorUrl}/nope`);
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('content-type'), 'application/json');
});
