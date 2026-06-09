import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { validateEnv } from './config/env.validation';
import { UploadsModule } from './common/uploads/uploads.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { AdminSetupModule } from './modules/admin-setup/admin-setup.module';
import { AdminUsersModule } from './modules/admin-users/admin-users.module';
import { AdminRatingConfigModule } from './modules/admin-rating-config/admin-rating-config.module';
import { AdminFaceCardsModule } from './modules/admin-face-cards/admin-face-cards.module';
import { AdminTextReactionsModule } from './modules/admin-text-reactions/admin-text-reactions.module';
import { MeModule } from './modules/me/me.module';
import { CardBacksModule } from './modules/card-backs/card-backs.module';
import { RatingModule } from './modules/rating/rating.module';
import { HighlightsModule } from './modules/highlights/highlights.module';
import { ProfileModule } from './modules/profile/profile.module';
import { GamesModule } from './modules/games/games.module';
import { LobbiesModule } from './modules/lobbies/lobbies.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : {
                target: 'pino-pretty',
                options: { singleLine: true, colorize: true, translateTime: 'SYS:HH:MM:ss' },
              },
        redact: {
          paths: [
            'req.headers.cookie',
            'req.headers.authorization',
            '*.password',
            '*.passwordHash',
          ],
          remove: true,
        },
      },
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 120,
      },
    ]),
    PrismaModule,
    UploadsModule,
    RedisModule,
    HealthModule,
    AuthModule,
    AdminSetupModule,
    AdminUsersModule,
    AdminRatingConfigModule,
    AdminFaceCardsModule,
    AdminTextReactionsModule,
    MeModule,
    CardBacksModule,
    RatingModule,
    HighlightsModule,
    ProfileModule,
    GamesModule,
    LobbiesModule,
  ],
})
export class AppModule {}
