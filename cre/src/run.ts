import { runPassportCredsWorkflow } from './main.js';

async function main() {
  const args = process.argv.slice(2);
  const verificationIdFlag = args.indexOf('--verificationId');

  if (verificationIdFlag === -1 || !args[verificationIdFlag + 1]) {
    console.error('Usage: node dist/run.js --verificationId <id>');
    process.exit(1);
  }

  const verificationId = args[verificationIdFlag + 1];

  try {
    const result = await runPassportCredsWorkflow({ verificationId });
    console.log('\n[CRE] Result:');
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[CRE] Workflow failed:', message);
    process.exit(1);
  }
}

main();
