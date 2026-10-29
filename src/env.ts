import { z } from 'zod';

// Base URLs without the trailing slash: "https://x.app/" + "/uploads/…" made "//uploads/…", which express doesn't serve
const base = z.url().transform((v) => v.replace(/\/+$/, ''));

// Validated once at startup: a missing/invalid variable fails fast with a clear message.
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().default(3333),
  PUBLIC_URL: base,
  APP_URL: base,
  LINKS_URL: base,
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must have at least 32 characters'),
  UPLOAD_DIR: z.string().default('./uploads'),
});

export const env = schema.parse(process.env);
