import http from 'node:http';
import { createPublicClient, http as httpTransport, toEventSelector, pad, getAddress } from 'viem';

// keccak256 topic hash for the standard ERC-20 Transfer(address,address,uint256) event.
const TRANSFER_EVENT_TOPIC = toEventSelector('Transfer(address,address,uint256)');

// Builds the default RPC-backed verifier: confirms `txHash` mined a
// successful ERC-20 Transfer log on `tokenAddress` paying at least `amount`
// to `vendorAddress`. Tests inject their own `verify` override instead of
// exercising this against a real chain.
function makeDefaultVerifier({ tokenAddress, vendorAddress, rpcUrl }) {
  const publicClient = createPublicClient({ transport: httpTransport(rpcUrl) });
  const asset = getAddress(tokenAddress).toLowerCase();
  const paddedPayTo = pad(getAddress(vendorAddress), { size: 32 }).toLowerCase();

  return async function verify(txHash, amount) {
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
      if (receipt.status !== 'success') return false;

      const want = BigInt(amount);
      return receipt.logs.some((log) => {
        if (log.address.toLowerCase() !== asset) return false;
        if (log.topics[0] !== TRANSFER_EVENT_TOPIC) return false;
        if (log.topics[2]?.toLowerCase() !== paddedPayTo) return false;
        return BigInt(log.data) >= want;
      });
    } catch {
      return false;
    }
  };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      if (!raw) { resolve({}); return; }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

// The x402 402-response payload: a single 'exact' scheme offer paying
// `amount` of `tokenAddress` to `vendorAddress`.
function paymentRequired(res, { tokenAddress, vendorAddress, amount }) {
  sendJson(res, 402, {
    x402Version: 1,
    accepts: [{ scheme: 'exact', network: 'eip155-local', asset: tokenAddress, amount, payTo: vendorAddress }],
  });
}

// Minimal x402 vendor: POST /invoice {jobId, amount} without an X-PAYMENT
// header gets a 402 challenge; retrying with X-PAYMENT: {"txHash"} gets the
// tx verified (via `verify`, or the RPC default) and, if it pays out,
// resolves 200 {paid: true, jobId}. Everything else is a plain 404.
// Binds loopback unless `host` says otherwise — this is a demo endpoint with
// no authentication in front of it.
export function createVendorServer({ port, host, vendorAddress, tokenAddress, rpcUrl, verify }) {
  const verifyPayment = verify ?? makeDefaultVerifier({ tokenAddress, vendorAddress, rpcUrl });

  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/invoice') {
      let body;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, { error: 'invalid JSON body' });
        return;
      }

      const { jobId, amount } = body;
      const paymentHeader = req.headers['x-payment'];

      if (!paymentHeader) {
        paymentRequired(res, { tokenAddress, vendorAddress, amount });
        return;
      }

      let txHash;
      try {
        ({ txHash } = JSON.parse(paymentHeader));
      } catch {
        paymentRequired(res, { tokenAddress, vendorAddress, amount });
        return;
      }

      const paid = await verifyPayment(txHash, amount);
      if (paid) {
        sendJson(res, 200, { paid: true, jobId });
      } else {
        paymentRequired(res, { tokenAddress, vendorAddress, amount });
      }
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  });

  server.listen(port, host ?? '127.0.0.1');
  return server;
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  createVendorServer({
    port: Number(process.env.PORT_VENDOR ?? 4191),
    host: process.env.BIND_HOST ?? '127.0.0.1',
    vendorAddress: process.env.VENDOR_ADDRESS,
    tokenAddress: process.env.TOKEN_ADDRESS,
    rpcUrl: process.env.RPC_URL ?? 'http://127.0.0.1:8545',
  });
}
