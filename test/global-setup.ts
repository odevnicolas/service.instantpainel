import { execSync } from 'node:child_process';
import './test-env';

/** Brings the test database to the latest migration before the suite. */
export default function globalSetup() {
  if (!process.env.DATABASE_URL?.includes('instantpainel_test'))
    throw new Error('e2e must run on the test database');
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });
}
