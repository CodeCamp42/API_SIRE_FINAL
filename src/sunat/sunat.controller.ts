import { Controller, Get, Query, HttpCode, HttpStatus, BadRequestException, Post, Body, Res, Param } from '@nestjs/common';
import { Response } from 'express';
import { SunatService } from './sunat.service';

@Controller('sunat')
export class SunatController {
  constructor(private readonly sunatService: SunatService) { }


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
      contenido: any[]; // <-- CAMBIO: De 'string' a 'any[]' para permitir el JSON
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

    // El servicio ahora devuelve un objeto estructurado, no un texto plano
    const resultados = await this.sunatService.obtenerReportesPorRango(periodoInicio, periodoFin);

    return {
      success: true,
      periodoInicio,
      periodoFin,
      resultados, // TypeScript ahora aceptará esto porque los tipos coinciden
    };
  }


  /*@Post('descargar-xml')
    async descargarXmlPorScript(@Body() body: { rucEmisor: string; serie: string; numero: string; ruc: string; usuario_sol: string; clave_sol: string; }) {
      const { rucEmisor, serie, numero, ruc, usuario_sol, clave_sol } = body;
      if (!rucEmisor || !serie || !numero || !ruc || !usuario_sol || !clave_sol) {
        throw new BadRequestException('Faltan parámetros: rucEmisor, serie, numero, ruc, usuario_sol, clave_sol');
      }
  
      const resultado = await this.sunatService.descargarXmlConScript({ rucEmisor, serie, numero, ruc, usuario_sol, clave_sol });
      return resultado;
    }*/

  @Post('descargar-xml')
  async descargarXmlPorScript(@Body() body: { rucEmisor: string; serie: string; numero: string; ruc: string; usuario_sol: string; clave_sol: string; }) {
    const { rucEmisor, serie, numero, ruc, usuario_sol, clave_sol } = body;
    if (!rucEmisor || !serie || !numero || !ruc || !usuario_sol || !clave_sol) {
      throw new BadRequestException('Faltan parámetros: rucEmisor, serie, numero, ruc, usuario_sol, clave_sol');
    }

    // Ahora encola un trabajo en lugar de ejecutarlo síncronamente
    return await this.sunatService.encolarScraping({ rucEmisor, serie, numero, ruc, usuario_sol, clave_sol });
  }

  @Get('job/:id')
  async getJobStatus(@Param('id') id: string) {
    return await this.sunatService.getJobStatus(id);
  }

  @Post('limpiar-cola')
  @HttpCode(HttpStatus.OK)
  async limpiarCola() {
    return await this.sunatService.vaciarCola();
  }
}
