import path from 'node:path';
import { defineConfig } from 'prisma/config';
import 'dotenv/config';

export default defineConfig({
  schema: path.join(__dirname, 'prisma/schema.prisma'),
  migrate: {
    async adapter(env: NodeJS.ProcessEnv) {
      const { PrismaPg } = await import('@prisma/adapter-pg');
      const { Pool } = await import('pg');
      const pool = new Pool({ connectionString: env['DATABASE_URL'] });
      return new PrismaPg(pool);
    },
  },
});
