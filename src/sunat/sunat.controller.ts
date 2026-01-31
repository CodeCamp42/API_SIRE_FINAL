import { Controller, Get, Query, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
import { SunatService } from './sunat.service';

@Controller('sunat')
export class SunatController {
  constructor(private readonly sunatService: SunatService) {}

  @Get('facturas')
  @HttpCode(HttpStatus.OK)
  async getFacturas(
    @Query('periodoInicio') periodoInicio: string,
    @Query('periodoFin') periodoFin: string,
  ): Promise<{
    success: boolean;
    periodoInicio: string;
    periodoFin: string;
    resultados: Array<{
      periodo: string;
      contenido: string;
    }>;
  }> {
    if (!/^\d{6}$/.test(periodoInicio)) {
      throw new BadRequestException('periodoInicio debe tener formato YYYYMM (ej: 202501)');
    }

    if (!/^\d{6}$/.test(periodoFin)) {
      throw new BadRequestException('periodoFin debe tener formato YYYYMM (ej: 202512)');
    }

    if (periodoInicio > periodoFin) {
      throw new BadRequestException('periodoInicio debe ser menor o igual a periodoFin');
    }

    const resultados = await this.sunatService.obtenerReportesPorRango(periodoInicio, periodoFin);

    return {
      success: true,
      periodoInicio,
      periodoFin,
      resultados,
    };
  }
}
