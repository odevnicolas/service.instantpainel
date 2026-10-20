import { z } from 'zod';

// Validated once at startup: a missing/invalid variable fails fast with a clear message.
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().default(3333),
  PUBLIC_URL: z.url(),
  APP_URL: z.url(),
  LINKS_URL: z.url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must have at least 32 characters'),
  UPLOAD_DIR: z.string().default('./uploads'),
});

export const env = schema.parse(process.env);
