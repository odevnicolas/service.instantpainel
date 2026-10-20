import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from './auth';

/**
 * Who sees what:
 * - ADMIN: everything.
 * - RESELLER: its own content, its clients' content (users it manages) and anything shared with it.
 * - CLIENT: its own content and anything shared with it ("Usuários com acesso").
 */
@Injectable()
export class Scope {
  constructor(private readonly prisma: PrismaService) {}

  /** Owner ids whose content `user` controls; null = all (admin). */
  async owners(user: AuthUser): Promise<string[] | null> {
    if (user.role === 'ADMIN') return null;
    if (user.role === 'CLIENT') return [user.id];
    const managed = await this.prisma.user.findMany({
      where: { managerId: user.id },
      select: { id: true },
    });
    return [user.id, ...managed.map((u) => u.id)];
  }

  /** Pages the user can open and edit. */
  async pages(user: AuthUser): Promise<Prisma.PageWhereInput> {
    const owners = await this.owners(user);
    return owners
      ? {
          OR: [
            { ownerId: { in: owners } },
            { access: { some: { userId: user.id } } },
          ],
        }
      : {};
  }

  /** Activated plates ("produtos") the user can see and edit. */
  async plates(user: AuthUser): Promise<Prisma.PlateWhereInput> {
    const owners = await this.owners(user);
    const activated = { activatedAt: { not: null } };
    return owners
      ? {
          ...activated,
          OR: [
            { ownerId: { in: owners } },
            { access: { some: { userId: user.id } } },
          ],
        }
      : activated;
  }

  /** Whether `user` controls content owned by `ownerId` (delete, manage access): owner, its manager or an admin. */
  async controls(user: AuthUser, ownerId: string | null) {
    const owners = await this.owners(user);
    return owners === null || (ownerId !== null && owners.includes(ownerId));
  }

  /** User ids for a list of e-mails ("Usuários com acesso"); unknown e-mails are reported back. */
  async userIds(emails: string[]) {
    const unique = [...new Set(emails)];
    const users = await this.prisma.user.findMany({
      where: { email: { in: unique } },
      select: { id: true, email: true },
    });
    const missing = unique.filter((e) => !users.some((u) => u.email === e));
    return { ids: users.map((u) => u.id), missing };
  }
}
