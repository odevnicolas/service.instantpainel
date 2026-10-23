import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { ErpRole, Role } from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';

const IS_PUBLIC = 'isPublic';
const ROLES = 'roles';

/** Route without login (public plate redirect, public page, login). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Only these roles may call the route. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const authUserSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  status: true,
  managerId: true,
  erpRole: true,
} as const;
export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  managerId: string | null;
  erpRole: ErpRole | null;
  impersonatorId?: string;
};
export type TokenPayload = { sub: string; imp?: string };

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<{ user: AuthUser }>().user,
);

/** Global guard: every route needs `Authorization: Bearer <token>` unless marked @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets))
      return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw new UnauthorizedException('Faça login para continuar.');

    let payload: TokenPayload;
    try {
      payload = await this.jwt.verifyAsync<TokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Sua sessão expirou. Entre novamente.');
    }

    // Read on every request so suspending or deleting a user takes effect immediately
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: authUserSelect,
    });
    if (!user || user.status !== 'ACTIVE')
      throw new UnauthorizedException(
        'Sua sessão não é mais válida. Entre novamente.',
      );
    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      managerId: user.managerId,
      erpRole: user.erpRole,
      impersonatorId: payload.imp,
    };

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES,
      targets,
    );
    if (roles && !roles.includes(user.role))
      throw new ForbiddenException('Você não tem permissão para isso.');
    return true;
  }
}
