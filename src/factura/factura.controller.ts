import { 
  Controller, 
  Post, 
  UseInterceptors, 
  UploadedFile, 
  BadRequestException, 
  Logger, 
  Body, 
  Get, 
  Param, 
  NotFoundException, 
  Put 
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImageRecognitionService } from './image-recognition.service';
import { FacturaService } from './factura.service';
import { CrearFacturaDto } from './dto/factura.dto';
import { PrismaService } from '../prisma/prisma.service';

@Controller('factura')
export class FacturaController {
  private readonly logger = new Logger(FacturaController.name);

  constructor(
    private readonly imageService: ImageRecognitionService,
    private readonly facturaService: FacturaService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('reconocer')
  @UseInterceptors(FileInterceptor('file'))
  async reconocerYGuardar(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No se envió archivo');

    this.logger.log('Archivo recibido para reconocimiento', { 
      filename: file.originalname, 
      size: file.size 
    });
    
    const datos = await this.imageService.analizarImagen(file.buffer);

    try {
      const resultado = await this.facturaService.crearDesdeOCR({
        ruc: datos.ruc,
        numero: datos.numero,
        fecha: datos.fecha,
        monto: datos.monto,
        usuarioId: 1,
      });
      
      if (resultado.created === false) {
        return { 
          mensaje: 'Factura ya registrada', 
          id: resultado.factura.idFactura, 
          datosDetectados: datos 
        };
      }
      
      return { 
        mensaje: 'Factura creada', 
        id: resultado.factura.idFactura, 
        datosDetectados: datos 
      };
    } catch (error: any) {
      this.logger.error('Error guardando factura desde OCR', error?.stack || error?.message || error);
      throw new BadRequestException(error?.message || 'Error al crear factura');
    }
  }

  @Post('procesarFactura')
  async procesarFactura(@Body() data: CrearFacturaDto) {
    this.logger.log('Petición recibida en procesarFactura', { 
      count: data.facturas?.length 
    });
    
    const resultados = await this.facturaService.procesarFacturas(data);
    
    return {
      message: 'Proceso de facturas completado',
      resultados,
    };
  }

  @Get('ui/:numeroComprobante')
  async obtenerFacturaParaUI(@Param('numeroComprobante') numeroComprobante: string) {
    this.logger.log(`=== OBTENER FACTURA PARA UI ===`);
    this.logger.log(`Factura: ${numeroComprobante}`);
    
    try {
      const factura = await this.facturaService.obtenerFacturaParaUI(numeroComprobante);
      
      return {
        success: true,
        message: 'Factura obtenida para UI',
        factura,
        nota: 'Estados formateados para mostrar en la interfaz',
      };
    } catch (error: any) {
      throw new NotFoundException(`Factura ${numeroComprobante} no encontrada`);
    }
  }

  @Get('ui/usuario/:usuarioId')
  async obtenerFacturasUsuarioParaUI(@Param('usuarioId') usuarioId: string) {
    this.logger.log(`=== OBTENER FACTURAS PARA UI ===`);
    this.logger.log(`Usuario: ${usuarioId}`);
    
    const facturas = await this.facturaService.obtenerFacturasParaUI(parseInt(usuarioId));
    
    // Estadísticas
    const distribucion = facturas.reduce((acc, f) => {
      acc[f.estadoFinal] = (acc[f.estadoFinal] || 0) + 1;
      return acc;
    }, {});
    
    this.logger.log(`Total facturas para UI: ${facturas.length}`);
    this.logger.log(`Distribución: ${JSON.stringify(distribucion)}`);
    
    return {
      success: true,
      message: 'Facturas obtenidas para UI',
      count: facturas.length,
      distribucionEstados: distribucion,
      facturas,
      nota: 'Estados formateados: "CON DETALLE" (con espacio)',
    };
  }

  @Get('ui/usuario/:usuarioId/con-detalle')
  async obtenerFacturasConDetalleParaUI(@Param('usuarioId') usuarioId: string) {
    this.logger.log(`Obteniendo facturas CON DETALLE para UI: ${usuarioId}`);
    
    const facturas = await this.facturaService.obtenerFacturasParaUI(parseInt(usuarioId));
    
    // Filtrar solo las que tienen CON DETALLE
    const facturasConDetalle = facturas.filter(f => 
      f.estadoFinal === 'CON DETALLE' || f.estado === 'CON DETALLE'
    );
    
    return {
      success: true,
      message: 'Facturas con detalle obtenidas para UI',
      count: facturasConDetalle.length,
      estado: 'CON DETALLE',
      facturas: facturasConDetalle,
    };
  }

  @Put('scraping-completado/:facturaId')
  async scrapingCompletado(
    @Param('facturaId') facturaId: string,
    @Body() body?: { productos?: any[] }
  ) {
    this.logger.log('=== ENDPOINT SCRAPING-COMPLETADO LLAMADO ===');
    this.logger.log(`Factura ID: ${facturaId}`);
    this.logger.log(`Productos recibidos: ${body?.productos?.length || 0}`);
    this.logger.log(`Timestamp: ${new Date().toISOString()}`);
    
    const resultado = await this.facturaService.scrapingCompletado(facturaId, body?.productos);
    
    if (!resultado.success) {
      throw new BadRequestException(resultado.error || 'Error marcando scraping como completado');
    }
    
    this.logger.log(`✅ Scraping marcado como completado para factura ${facturaId}`);
    this.logger.log(`📦 Productos guardados: ${resultado.productosGuardados || 0}`);
    
    // Formatear estado para respuesta
    const estadoFormateado = resultado.factura.estado.replace('_', ' ');
    
    return {
      message: 'Scraping marcado como completado',
      timestamp: new Date().toISOString(),
      factura: {
        ...resultado.factura,
        estado: estadoFormateado,
      },
      estado: estadoFormateado,
      productosGuardados: resultado.productosGuardados || 0,
      advertencia: 'Este estado se mantendrá permanente (CON DETALLE)',
    };
  }

  @Post('guardar-productos/:numeroComprobante')
  async guardarProductosFactura(
    @Param('numeroComprobante') numeroComprobante: string,
    @Body() body: { productos: any[] }
  ) {
    this.logger.log('=== GUARDAR PRODUCTOS FACTURA ===');
    this.logger.log(`Factura: ${numeroComprobante}`);
    this.logger.log(`Productos recibidos: ${body.productos.length}`);
    
    try {
      const resultado = await this.facturaService.guardarProductosFactura(numeroComprobante, body.productos);
      
      return {
        success: true,
        message: 'Productos guardados exitosamente',
        productosGuardados: resultado.productosGuardados,
        facturaId: resultado.facturaId,
        estadoActualizado: resultado.estadoActualizado,
      };
    } catch (error: any) {
      this.logger.error(`Error guardando productos: ${error.message}`);
      return {
        success: false,
        message: error.message,
      };
    }
  }

  @Put(':numeroComprobante/detalle')
  async marcarConDetalle(@Param('numeroComprobante') numeroComprobante: string) {
    this.logger.log(`=== MARCAR CON DETALLE ===`);
    this.logger.log(`Factura: ${numeroComprobante}`);
    this.logger.log(`Timestamp: ${new Date().toISOString()}`);
    
    const factura = await this.facturaService.marcarConDetalle(numeroComprobante);
    
    if (!factura) {
      throw new NotFoundException(`Factura ${numeroComprobante} no encontrada`);
    }
    
    // Formatear estado para respuesta
    const estadoFormateado = factura.estado.replace('_', ' ');
    
    this.logger.log(`✅ Estado actualizado a: ${factura.estado}`);
    
    return {
      message: 'Factura marcada con detalle',
      timestamp: new Date().toISOString(),
      factura: {
        ...factura,
        estado: estadoFormateado,
      },
      advertencia: 'Este estado (CON DETALLE) se mantendrá permanentemente',
    };
  }

  @Put(':numeroComprobante/registrar')
  async registrarFactura(@Param('numeroComprobante') numeroComprobante: string) {
    this.logger.log(`=== REGISTRAR FACTURA ===`);
    this.logger.log(`Factura: ${numeroComprobante}`);
    this.logger.log(`Timestamp: ${new Date().toISOString()}`);
    
    const factura = await this.facturaService.registrarFactura(numeroComprobante);
    
    if (!factura) {
      throw new NotFoundException(`Factura ${numeroComprobante} no encontrada`);
    }
    
    this.logger.log(`✅ Estado actualizado a: ${factura.estado}`);
    
    return {
      message: 'Factura registrada',
      timestamp: new Date().toISOString(),
      factura,
    };
  }

  @Get('usuario/:usuarioId')
  async obtenerFacturasUsuario(@Param('usuarioId') usuarioId: string) {
    this.logger.log(`=== OBTENER TODAS LAS FACTURAS ===`);
    this.logger.log(`Usuario: ${usuarioId}`);
    this.logger.log(`Timestamp: ${new Date().toISOString()}`);
    
    const facturas = await this.facturaService.obtenerFacturasPorUsuario(parseInt(usuarioId));
    
    // Log de distribución
    const distribucion = facturas.reduce((acc, f) => {
      acc[f.estadoFinal] = (acc[f.estadoFinal] || 0) + 1;
      return acc;
    }, {});
    
    this.logger.log(`Total facturas obtenidas: ${facturas.length}`);
    this.logger.log(`Distribución de estados: ${JSON.stringify(distribucion)}`);
    
    return {
      message: 'Facturas obtenidas',
      timestamp: new Date().toISOString(),
      count: facturas.length,
      distribucionEstados: distribucion,
      facturas,
      nota: 'Los estados CON_DETALLE se mantienen permanentemente',
    };
  }

  @Post('registrar-desde-sunat')
  async registrarFacturaDesdeSunat(@Body() body: any) {
    this.logger.log('=== REGISTRAR FACTURA DESDE SUNAT ===');
    this.logger.log(`Datos recibidos: ${JSON.stringify(body)}`);
    
    try {
      const factura = await this.facturaService.registrarDesdeSunat(body);
      
      return {
        success: true,
        idFactura: factura.idFactura,
        numeroComprobante: factura.numeroComprobante,
        message: 'Factura registrada en BD',
      };
    } catch (error: any) {
      this.logger.error(`Error registrando factura: ${error.message}`);
      return {
        success: false,
        message: error.message,
      };
    }
  }
}