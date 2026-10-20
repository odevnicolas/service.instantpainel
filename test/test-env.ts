import { config } from 'dotenv';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// e2e runs against the separate instantpainel_test database (created by docker/init.sql), never the dev one
config({ quiet: true });
process.env.DATABASE_URL = process.env.DATABASE_URL!.replace(
  /\/instantpainel(\?|$)/,
  '/instantpainel_test$1',
);
process.env.UPLOAD_DIR = join(tmpdir(), 'instantpainel-e2e-uploads');
