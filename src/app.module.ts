import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { AuthGuard } from './common/auth';
import { Scope } from './common/scope';
import { env } from './env';
import { OrdersController } from './orders/orders.controller';
import { PagesController } from './pages/pages.controller';
import { PlatesController } from './plates/plates.controller';
import { PrismaService } from './prisma.service';
import { PublicController } from './public/public.controller';
import { StatsService } from './stats/stats.service';
import { UploadsController } from './uploads/uploads.controller';
import { UsersController } from './users/users.controller';

// One module: the API is small; split into feature modules when a part grows its own dependencies.
@Module({
  imports: [
    JwtModule.register({ global: true, secret: env.JWT_SECRET }),
    // Default limit per IP; login has a stricter one (see AuthController)
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 300 }],
      errorMessage:
        'Muitas tentativas seguidas. Aguarde um minuto e tente de novo.',
    }),
  ],
  controllers: [
    AuthController,
    UsersController,
    PagesController,
    PlatesController,
    PublicController,
    UploadsController,
    OrdersController,
  ],
  providers: [
    PrismaService,
    Scope,
    AuthService,
    StatsService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
