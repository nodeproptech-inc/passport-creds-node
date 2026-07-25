import { formatUnits } from 'viem';

// House-expense categories the mock rules will consider paying/proposing at
// all; anything else is rejected outright.
const MOCK_ALLOWED_CATEGORIES = ['plumbing', 'electrical', 'cleaning', 'admin'];

// Format an 18-decimal wei bigint as a one-decimal mUSD string, e.g. "120.0".
function fmtMUsd(wei) {
  return Number(formatUnits(wei, 18)).toFixed(1);
}

// Deterministic rules decider: no network calls, always available as the
// ground truth and as the fallback for the openai decider.
async function mockDecide(ticket, context) {
  const { amount, category } = ticket;
  const { perTxCap, casaBudget } = context;

  if (!MOCK_ALLOWED_CATEGORIES.includes(category)) {
    return {
      action: 'reject',
      rationale: `category '${category}' is not an allowed house expense category (${MOCK_ALLOWED_CATEGORIES.join(', ')})`,
      confidence: 0.95,
    };
  }

  const amountStr = fmtMUsd(amount);
  const capStr = fmtMUsd(perTxCap);
  const budgetStr = fmtMUsd(casaBudget);

  if (amount <= perTxCap && amount <= casaBudget) {
    return {
      action: 'pay',
      rationale: `${amountStr} mUSD within per-tx cap ${capStr} and budget ${budgetStr}`,
      confidence: 0.9,
    };
  }

  return {
    action: 'propose',
    rationale: `${amountStr} mUSD exceeds per-tx cap ${capStr} or remaining budget ${budgetStr} — needs owner approval`,
    confidence: 0.7,
  };
}

const OPENAI_SYSTEM_PROMPT = [
  'You are the decision engine for a house concierge agent that pays vendor',
  'tickets out of a shared CASA budget on behalf of a group of co-owners.',
  'Given a ticket and the current spending context, decide whether to pay it',
  'immediately, propose it for owner approval, or reject it.',
  '',
  'Respond with ONLY minified JSON, no prose, no markdown fences, matching',
  'exactly this shape: {"action":"pay|propose|reject","rationale":"string","confidence":0..1}',
].join('\n');

function serializeBigints(value) {
  return JSON.parse(JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

const VALID_ACTIONS = new Set(['pay', 'propose', 'reject']);

async function openaiDecide(ticket, context, opts) {
  try {
    const headers = { 'content-type': 'application/json' };
    if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;

    const res = await fetch(`${opts.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: opts.model,
        messages: [
          { role: 'system', content: OPENAI_SYSTEM_PROMPT },
          {
            role: 'user',
            content: JSON.stringify({ ticket: serializeBigints(ticket), context: serializeBigints(context) }),
          },
        ],
      }),
      // A hung endpoint must not hang the ticket: aborting drops into the
      // catch below, which answers from the mock rules.
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15000),
    });

    if (!res.ok) throw new Error(`openai request failed: ${res.status}`);

    const body = await res.json();
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('openai response missing message content');

    const parsed = JSON.parse(content);
    if (!VALID_ACTIONS.has(parsed.action)) throw new Error(`openai returned invalid action: ${parsed.action}`);
    if (typeof parsed.rationale !== 'string') throw new Error('openai returned invalid rationale');
    if (typeof parsed.confidence !== 'number') throw new Error('openai returned invalid confidence');

    return { action: parsed.action, rationale: parsed.rationale, confidence: parsed.confidence };
  } catch {
    const fallback = await mockDecide(ticket, context);
    return { ...fallback, rationale: `${fallback.rationale} (fallback: mock rules)` };
  }
}

// 0G decentralized-inference decider — deferred to event day. Wiring plan:
//   const broker = await createZGComputeNetworkBroker(wallet);
//   await broker.ledger.depositFund(amount);
//   const meta = await broker.inference.getServiceMetadata(providerAddress);
//   const headers = await broker.inference.getRequestHeaders(providerAddress, request);
//   POST meta.endpoint with headers + the ticket/context prompt;
//   await broker.inference.processResponse(...) to verify the TEE attestation.
// Requires @0gfoundation/0g-compute-ts-sdk, not installed yet.
async function zerogDecide() {
  throw new Error(
    'TODO(event): 0G broker inference — createZGComputeNetworkBroker(wallet) → broker.ledger.depositFund → ' +
      'broker.inference.getServiceMetadata + getRequestHeaders → POST provider endpoint → processResponse for ' +
      'TEE attestation (@0gfoundation/0g-compute-ts-sdk)',
  );
}

// Builds an async decider function `(ticket, context) => decision` for the
// given kind. ticket: {id, description, vendor, amount (bigint wei), category}.
// context: {perTxCap (bigint), casaBudget (bigint)}.
// decision: {action: 'pay'|'propose'|'reject', rationale: string, confidence: number}.
export function makeDecider(kind, opts = {}) {
  if (kind === 'mock') return (ticket, context) => mockDecide(ticket, context);
  if (kind === 'openai') return (ticket, context) => openaiDecide(ticket, context, opts);
  if (kind === 'zerog') return (ticket, context) => zerogDecide(ticket, context, opts);
  throw new Error('unknown decider: ' + kind);
}
