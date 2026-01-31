import { Controller, Get, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { SunatService } from './sunat.service';

@Controller('sunat')
export class SunatController {
  constructor(private readonly sunatService: SunatService) {}

  @Get('facturas/:periodo')
  @HttpCode(HttpStatus.OK)
  async getFacturas(@Param('periodo') periodo: string): Promise<{ 
    success: boolean;
    periodo: string;
    contenido: string;
  }> {
    if (!/^\d{6}$/.test(periodo)) {
      throw new Error('El periodo debe tener formato YYYYMM (ej: 202512)');
    }

    const contenido = await this.sunatService.obtenerReporteFacturacion(periodo);

    return {
      success: true,
      periodo,
      contenido,
    };
  }
}
