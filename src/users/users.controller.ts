import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthService, hashPassword } from '../auth/auth.service';
import { CurrentUser, Roles, type AuthUser } from '../common/auth';
import { ZodPipe, email, listQuery, paginate, password } from '../common/zod';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';

const name = z.string().trim().min(1).max(100);
const role = z.enum(['CLIENT', 'RESELLER']); // admins are created by the seed only
const listBody = listQuery.extend({ role: role.optional() });
const createBody = z.object({
  name,
  email,
  password,
  role: role.default('CLIENT'),
});
const linkBody = z.object({ email });
const updateBody = z.object({
  name: name.optional(),
  role: role.optional(),
  password: password.optional(),
});

const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  status: true,
  _count: { select: { pages: true } },
} as const;
const view = ({
  _count,
  ...u
}: Prisma.UserGetPayload<{ select: typeof userSelect }>) => ({
  ...u,
  pages: _count.pages,
});

/** "Usuários" screen: an admin manages everyone, a reseller manages its clients. */
@Controller('users')
@Roles('ADMIN', 'RESELLER')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  async list(
    @CurrentUser() me: AuthUser,
    @Query(new ZodPipe(listBody)) q: z.output<typeof listBody>,
  ) {
    const where: Prisma.UserWhereInput = {
      ...(me.role === 'ADMIN' ? { id: { not: me.id } } : { managerId: me.id }),
      ...(q.role && { role: q.role }),
      ...(q.search && {
        OR: [
          { name: { contains: q.search, mode: 'insensitive' } },
          { email: { contains: q.search, mode: 'insensitive' } },
        ],
      }),
    };
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: userSelect,
        orderBy: { name: 'asc' },
        ...paginate(q),
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items: items.map(view), total };
  }

  @Post()
  async create(
    @CurrentUser() me: AuthUser,
    @Body(new ZodPipe(createBody)) body: z.output<typeof createBody>,
  ) {
    if (me.role !== 'ADMIN' && body.role !== 'CLIENT')
      throw new ForbiddenException('Revendedores só podem criar clientes.');
    try {
      const user = await this.prisma.user.create({
        data: {
          name: body.name,
          email: body.email,
          role: body.role,
          passwordHash: await hashPassword(body.password),
          managerId: me.id,
        },
        select: userSelect,
      });
      return view(user);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        throw new ConflictException(
          'Já existe um usuário com este e-mail. Use "Relacionar usuário existente".',
        );
      throw e;
    }
  }

  /** "Relacionar usuário existente": takes over a user that nobody manages yet. */
  @Post('link')
  async link(
    @CurrentUser() me: AuthUser,
    @Body(new ZodPipe(linkBody)) body: z.output<typeof linkBody>,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { email: body.email },
    });
    if (!user) throw new NotFoundException('Nenhum usuário com este e-mail.');
    if (user.id === me.id || user.role === 'ADMIN')
      throw new BadRequestException('Este usuário não pode ser relacionado.');
    if (me.role !== 'ADMIN' && user.role !== 'CLIENT')
      throw new ForbiddenException(
        'Revendedores só podem relacionar clientes.',
      );
    if (user.managerId === me.id)
      throw new ConflictException('Este usuário já está relacionado a você.');
    if (user.managerId && me.role !== 'ADMIN')
      throw new ConflictException(
        'Este usuário já é gerenciado por outra conta.',
      );
    return view(
      await this.prisma.user.update({
        where: { id: user.id },
        data: { managerId: me.id },
        select: userSelect,
      }),
    );
  }

  @Patch(':id')
  async update(
    @CurrentUser() me: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateBody)) body: z.output<typeof updateBody>,
  ) {
    await this.managed(me, id);
    if (body.role && me.role !== 'ADMIN')
      throw new ForbiddenException(
        'Só administradores mudam o nível de um usuário.',
      );
    const data: Prisma.UserUpdateInput = { name: body.name, role: body.role };
    if (body.password) data.passwordHash = await hashPassword(body.password);
    return view(
      await this.prisma.user.update({
        where: { id },
        data,
        select: userSelect,
      }),
    );
  }

  @Post(':id/suspend')
  async suspend(
    @CurrentUser() me: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.managed(me, id);
    return view(
      await this.prisma.user.update({
        where: { id },
        data: { status: 'SUSPENDED' },
        select: userSelect,
      }),
    );
  }

  @Post(':id/activate')
  async activate(
    @CurrentUser() me: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.managed(me, id);
    return view(
      await this.prisma.user.update({
        where: { id },
        data: { status: 'ACTIVE' },
        select: userSelect,
      }),
    );
  }

  /** Deletes the user and the pages it owns; its plates stay, without owner. */
  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() me: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.managed(me, id);
    await this.prisma.user.delete({ where: { id } });
  }

  /** "Logar como": a short session as the managed user (token carries who started it). */
  @Post(':id/impersonate')
  async impersonate(
    @CurrentUser() me: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const user = await this.managed(me, id);
    if (user.status !== 'ACTIVE')
      throw new BadRequestException('Este usuário está suspenso.');
    return this.auth.token(
      { sub: user.id, imp: me.impersonatorId ?? me.id },
      2 * 60 * 60,
    );
  }

  /** The target user, if `me` manages it (admins manage everyone but themselves). */
  private async managed(me: AuthUser, id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (
      !user ||
      user.id === me.id ||
      (me.role !== 'ADMIN' && user.managerId !== me.id)
    )
      throw new NotFoundException('Usuário não encontrado.');
    if (user.role === 'ADMIN')
      throw new ForbiddenException(
        'Administradores não podem ser alterados por aqui.',
      );
    return user;
  }
}
