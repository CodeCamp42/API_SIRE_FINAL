import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { SunatModule } from './sunat/sunat.module';
import { FacturaModule } from './factura/factura.module';

import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { connection } from './config/redis.connection';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    BullModule.forRootAsync({
      useFactory: () => {
        return {
          connection,
        };
      },
    }),
    PrismaModule,
    SunatModule,
    FacturaModule,
  ],
})
export class AppModule { }
