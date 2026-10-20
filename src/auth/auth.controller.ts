import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { compare } from 'bcryptjs';
import { z } from 'zod';
import { CurrentUser, Public, type AuthUser } from '../common/auth';
import { ZodPipe, email, password } from '../common/zod';
import { PrismaService } from '../prisma.service';
import { AuthService, hashPassword } from './auth.service';

const loginBody = z.object({
  email,
  password: z.string().min(1).max(200),
  remember: z.boolean().default(false),
});
const nameBody = z.object({ name: z.string().trim().min(1).max(100) });
const passwordBody = z.object({
  current: z.string().min(1).max(200),
  next: password,
});

@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  // Brute-force brake: 5 attempts per minute per IP
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('auth/login')
  @HttpCode(200)
  login(@Body(new ZodPipe(loginBody)) body: z.output<typeof loginBody>) {
    return this.auth.login(body.email, body.password, body.remember);
  }

  /** Logged user ("Minha conta", sidebar). `impersonating` is set while an admin/reseller uses "Logar como". */
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    const { impersonatorId, ...rest } = user;
    return { ...rest, impersonating: Boolean(impersonatorId) };
  }

  @Patch('me')
  async rename(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(nameBody)) body: z.output<typeof nameBody>,
  ) {
    const {
      id,
      email: mail,
      name,
      role,
    } = await this.prisma.user.update({
      where: { id: user.id },
      data: { name: body.name },
    });
    return { id, email: mail, name, role };
  }

  @Post('me/password')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(passwordBody)) body: z.output<typeof passwordBody>,
  ) {
    const { passwordHash } = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true },
    });
    if (!(await compare(body.current, passwordHash)))
      throw new BadRequestException('A senha atual está incorreta.');
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(body.next) },
    });
  }
}
