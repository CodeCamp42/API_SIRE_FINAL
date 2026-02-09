import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { SunatController } from './sunat.controller';
import { SunatService } from './sunat.service';

import { BullModule } from '@nestjs/bullmq';
import { SunatProcessor } from './sunat.processor';
import { SunatGateway } from './sunat.gateway';
import { FacturaModule } from '../factura/factura.module';

@Module({
  imports: [
    HttpModule.register({
      timeout: 30000,
      maxRedirects: 5,
    }),
    ConfigModule,
    BullModule.registerQueue({
      name: 'scraping',
    }),
    FacturaModule,
  ],
  controllers: [SunatController],
  providers: [SunatService, SunatProcessor, SunatGateway],
  exports: [SunatService],
})
export class SunatModule { }
