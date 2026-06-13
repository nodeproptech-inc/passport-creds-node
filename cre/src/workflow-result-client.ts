import { CRE_WORKFLOW_CALLBACK_URL } from './config.js';
import type { CREWorkflowResult } from './types.js';

export async function sendWorkflowResultToBackend(result: CREWorkflowResult): Promise<void> {
  const res = await fetch(CRE_WORKFLOW_CALLBACK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(
      `Failed to send workflow result to backend: ${res.status} ${text}`
    );
  }

  const body = (await res.json()) as { received: boolean };
  if (!body.received) {
    throw new Error('Backend did not acknowledge workflow result');
  }
}
