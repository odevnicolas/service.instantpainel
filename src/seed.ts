import 'dotenv/config';
import { hashPassword } from './auth/auth.service';
import { PrismaService } from './prisma.service';

/** Creates the first admin from ADMIN_EMAIL / ADMIN_PASSWORD. Safe to re-run: an existing user is left untouched. */
async function seed() {
  const {
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    ADMIN_NAME = 'Administrador',
  } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD)
    throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD in .env');

  const prisma = new PrismaService();
  const email = ADMIN_EMAIL.trim().toLowerCase();
  const admin = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      name: ADMIN_NAME,
      role: 'ADMIN',
      passwordHash: await hashPassword(ADMIN_PASSWORD),
    },
    update: {},
  });
  console.log(`Admin ready: ${admin.email} (${admin.role})`);
  await prisma.$disconnect();
}
void seed();
