import { Module } from '@nestjs/common';
import { FacturaController } from './factura.controller';
import { FacturaService } from './factura.service';
import { ImageRecognitionService } from './image-recognition.service';

@Module({
  controllers: [FacturaController],
  providers: [FacturaService, ImageRecognitionService],
  exports: [FacturaService]
})
export class FacturaModule { }
