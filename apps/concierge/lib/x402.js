// x402 client: POSTs an invoice to the vendor; if the vendor answers 402
// (payment required), pays via the injected `payFn` (returns a txHash) and
// retries once with the X-PAYMENT header attached. `payFn` is injected so
// callers/tests never need a real chain here.
//
// The vendor is untrusted: its 402 body names both the recipient and the sum.
// Every field is therefore checked against what the caller already knows —
// `expected` {asset, payTo} and the invoice `amount` it asked for — before a
// single wei moves. Anything else (non-402 status, unparseable body, mismatched
// offer) returns unpaid *without* calling payFn.

const sameAddress = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

// Returns the name of the first field that does not match what we asked for,
// or null when the offer is exactly the one we are willing to pay.
function mismatchedField(accept, { amount, expected }) {
  if (accept.scheme !== 'exact') return 'scheme';
  if (!sameAddress(accept.asset, expected?.asset)) return 'asset';
  if (!sameAddress(accept.payTo, expected?.payTo)) return 'payTo';
  try {
    if (BigInt(accept.amount) !== BigInt(amount)) return 'amount';
  } catch {
    return 'amount';
  }
  return null;
}

export async function settleInvoice({ vendorUrl, jobId, amount, payFn, expected }) {
  const body = JSON.stringify({ jobId, amount });

  const first = await fetch(`${vendorUrl}/invoice`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });

  if (first.status === 200) {
    return { paid: true, txHash: null };
  }
  if (first.status !== 402) {
    return { paid: false, txHash: null, error: `unexpected status ${first.status}` };
  }

  let challenge;
  try {
    challenge = await first.json();
  } catch {
    return { paid: false, txHash: null, error: 'malformed challenge' };
  }

  const accept = Array.isArray(challenge?.accepts) ? challenge.accepts[0] : null;
  if (!accept || typeof accept !== 'object') {
    return { paid: false, txHash: null, error: 'malformed challenge' };
  }

  const mismatch = mismatchedField(accept, { amount, expected });
  if (mismatch) {
    return { paid: false, txHash: null, error: `challenge mismatch: ${mismatch}` };
  }

  const txHash = await payFn(accept);

  const retry = await fetch(`${vendorUrl}/invoice`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-payment': JSON.stringify({ txHash }),
    },
    body,
  });

  return { paid: retry.status === 200, txHash };
}
