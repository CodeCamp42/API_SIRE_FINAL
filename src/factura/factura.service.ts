import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EstadoFactura, Prisma } from '@prisma/client';
import { CrearFacturaDto, FacturaDto } from './dto/factura.dto';

@Injectable()
export class FacturaService {
  private readonly logger = new Logger(FacturaService.name);

  constructor(private readonly prisma: PrismaService) { }

  // ==================== MÉTODOS EXISTENTES ====================

  async procesarFacturas(data: CrearFacturaDto) {
    const resultados = [];

    for (const facturaDto of data.facturas) {
      try {
        const res = await this.guardarFactura(facturaDto);
        resultados.push(res);
      } catch (error: any) {
        this.logger.error(`Error procesando factura ${facturaDto.serie}-${facturaDto.numero}: ${error.message}`);
        resultados.push({
          success: false,
          error: error.message,
          serie: facturaDto.serie,
          numero: facturaDto.numero
        });
      }
    }

    return resultados;
  }

  // ✅ **MÉTODO MODIFICADO: Ahora marca como REGISTRADO cuando viene de /procesarFactura y guarda archivos**
  async guardarFactura(f: FacturaDto, archivos?: { xml: string; pdf: string; cdr: string; }) {
    await this.prisma.proveedor.upsert({
      where: { rucProveedor: f.rucEmisor },
      update: { razonSocial: this.sanitizeString(f.razonSocial) },
      create: {
        rucProveedor: f.rucEmisor,
        razonSocial: this.sanitizeString(f.razonSocial)
      },
    });

    const numeroNormalizado = this.normalizarNumero(f.numero);
    const numeroComprobante = `${f.serie.toUpperCase()}-${numeroNormalizado}`;

    const existente = await this.prisma.factura.findUnique({
      where: { numeroComprobante },
    });

    let facturaId: number;

    // ✅ **SI YA EXISTE: Actualizar y marcar como REGISTRADO (si no está CONTABILIZADO)**
    if (existente) {
      facturaId = existente.idFactura;
      const [day, month, year] = f.fechaEmision.split('/').map(Number);
      const fechaEmision = new Date(year, month - 1, day);

      // ✅ **IMPORTANTE: Cuando viene de /procesarFactura, significa que el usuario presionó "Registrar"**
      // Por lo tanto, debemos marcar como REGISTRADO (excepto si ya está CONTABILIZADO)
      let nuevoEstado = existente.estado;

      if (existente.estado !== EstadoFactura.CONTABILIZADO) {
        // Si viene de "Registrar", cambiar a REGISTRADO
        nuevoEstado = EstadoFactura.REGISTRADO;
      }

      await this.prisma.factura.update({
        where: { numeroComprobante },
        data: {
          fechaEmision,
          moneda: f.moneda || 'PEN',
          costoTotal: new Prisma.Decimal(Number(f.costoTotal)),
          igv: new Prisma.Decimal(Number(f.igv)),
          importeTotal: new Prisma.Decimal(Number(f.importeTotal)),
          estado: nuevoEstado, // ✅ Cambia a REGISTRADO
        },
      });

      if (f.productos && f.productos.length > 0) {
        await this.prisma.detalleFactura.deleteMany({
          where: { facturaId: existente.idFactura },
        });

        await this.prisma.detalleFactura.createMany({
          data: f.productos.map(p => ({
            facturaId: existente.idFactura,
            descripcion: p.descripcion,
            cantidad: new Prisma.Decimal(Number(p.cantidad)),
            costoUnitario: new Prisma.Decimal(Number(p.costoUnitario)),
            unidadMedida: p.unidadMedida,
          })),
        });
      }

      this.logger.log(`✅ Factura ${numeroComprobante} actualizada y marcada como ${nuevoEstado}`);
    } else {
      // SI NO EXISTE: Crear nueva como CONSULTADO
      const [day, month, year] = f.fechaEmision.split('/').map(Number);
      const fechaEmision = new Date(year, month - 1, day);

      const nuevaFactura = await this.prisma.factura.create({
        data: {
          numeroComprobante,
          serie: f.serie.toUpperCase(),
          numero: numeroNormalizado,
          fechaEmision,
          moneda: f.moneda || 'PEN',
          costoTotal: new Prisma.Decimal(Number(f.costoTotal)),
          igv: new Prisma.Decimal(Number(f.igv)),
          importeTotal: new Prisma.Decimal(Number(f.importeTotal)),
          estado: EstadoFactura.CONSULTADO,
          usuarioId: 1,
          proveedorRuc: f.rucEmisor,
          detalles: {
            create: f.productos.map(p => ({
              descripcion: this.sanitizeString(p.descripcion),
              cantidad: new Prisma.Decimal(Number(p.cantidad)),
              costoUnitario: new Prisma.Decimal(Number(p.costoUnitario)),
              unidadMedida: this.sanitizeString(p.unidadMedida),
            })),
          },
        },
      });
      facturaId = nuevaFactura.idFactura;
    }

    // ✅ **GUARDAR ARCHIVOS EN COMPROBANTE ELECTRÓNICO**
    if (archivos) {
      this.logger.log(`💾 Guardando archivos para factura ${numeroComprobante}...`);
      await this.prisma.comprobanteElectronico.upsert({
        where: { facturaId: facturaId },
        update: {
          xml: archivos.xml,
          pdf: archivos.pdf,
          cdr: archivos.cdr || '', // Puede ser vacío para series 'E'
          fechaRecepcion: new Date(),
          estadoSunat: 'RECIBIDO'
        },
        create: {
          facturaId: facturaId,
          xml: archivos.xml,
          pdf: archivos.pdf,
          cdr: archivos.cdr || '',
          fechaRecepcion: new Date(),
          estadoSunat: 'RECIBIDO'
        }
      });
      this.logger.log(`✅ Archivos guardados exitosamente.`);
    }

    return {
      success: true,
      message: existente ? 'Factura actualizada y registrada' : 'Factura creada',
      id: facturaId,
      numeroComprobante,
      actualizada: !!existente,
      creada: !existente
    };
  }

  async crearDesdeOCR(datos: {
    ruc?: string;
    numero?: string;
    fecha?: string;
    monto?: string;
    usuarioId?: number
  }) {
    this.logger.log('Crear factura desde OCR', {
      resumen: {
        ruc: datos.ruc,
        numero: datos.numero
      }
    });

    if (!datos.ruc) throw new Error('RUC no detectado en la imagen');
    if (!datos.numero) throw new Error('Número de comprobante no detectado en la imagen');

    await this.prisma.proveedor.upsert({
      where: { rucProveedor: datos.ruc },
      update: {},
      create: {
        rucProveedor: datos.ruc,
        razonSocial: 'Proveedor desde OCR'
      },
    });

    let serie = '0000';
    let numero = datos.numero;
    if (datos.numero.includes('-')) {
      const parts = datos.numero.split('-');
      serie = parts[0].toUpperCase();
      numero = parts[1];
    }
    
    const numeroNormalizado = this.normalizarNumero(numero);
    const numeroComprobanteFinal = `${serie}-${numeroNormalizado}`;

    const existente = await this.prisma.factura.findUnique({
      where: { numeroComprobante: numeroComprobanteFinal }
    });

    if (existente) {
      this.logger.warn('Factura ya registrada', {
        id: existente.idFactura,
        numero: datos.numero
      });
      return {
        created: false,
        factura: existente
      };
    }

    const total = datos.monto ? Number(datos.monto) : 0;
    const igv = total * 0.18;
    const costoTotal = total - igv;

    const created = await this.prisma.factura.create({
      data: {
        numeroComprobante: numeroComprobanteFinal,
        serie,
        numero: numeroNormalizado,
        fechaEmision: datos.fecha ? new Date(datos.fecha) : new Date(),
        importeTotal: new Prisma.Decimal(total),
        costoTotal: new Prisma.Decimal(costoTotal),
        igv: new Prisma.Decimal(igv),
        moneda: 'PEN',
        estado: EstadoFactura.CONSULTADO,
        usuarioId: datos.usuarioId ?? 1,
        proveedorRuc: datos.ruc,
      },
    });

    this.logger.log('Factura creada desde OCR', {
      id: created.idFactura
    });

    return {
      created: true,
      factura: created
    };
  }

  async buscarPorNumero(numeroComprobante: string) {
    this.logger.log(`Buscando factura por número: ${numeroComprobante}`);

    // Normalizar por si viene sin ceros (ej: F001-103077)
    let numeroCompNormalizado = numeroComprobante;
    if (numeroComprobante.includes('-')) {
      const [s, n] = numeroComprobante.split('-');
      numeroCompNormalizado = `${s.toUpperCase()}-${this.normalizarNumero(n)}`;
    }

    const factura = await this.prisma.factura.findUnique({
      where: { numeroComprobante: numeroCompNormalizado },
      include: {
        detalles: true,
        proveedor: true,
        comprobanteElectronico: true,
      },
    });

    if (!factura) return null;

    // ✅ **REGLA CORREGIDA: REGISTRADO/CONTABILIZADO tienen prioridad sobre CON_DETALLE**
    let estadoFinal = factura.estado;

    if (factura.estado === EstadoFactura.CONTABILIZADO) {
      estadoFinal = EstadoFactura.CONTABILIZADO;
    } else if (factura.estado === EstadoFactura.REGISTRADO) {
      estadoFinal = EstadoFactura.REGISTRADO;
    } else if (factura.estado === EstadoFactura.CON_DETALLE) {
      estadoFinal = EstadoFactura.CON_DETALLE;
    }

    return {
      ...factura,
      estadoFinal,
    };
  }

  // ==================== MÉTODOS CLAVE ====================

  async guardarProductosFactura(numeroComprobante: string, productos: any[]) {
    this.logger.log(`=== GUARDAR PRODUCTOS FACTURA ===`);
    this.logger.log(`Factura: ${numeroComprobante}`);
    this.logger.log(`Productos a guardar: ${productos.length}`);

    try {
      const factura = await this.prisma.factura.findUnique({
        where: { numeroComprobante },
      });

      if (!factura) {
        throw new Error(`Factura ${numeroComprobante} no encontrada`);
      }

      await this.prisma.detalleFactura.deleteMany({
        where: { facturaId: factura.idFactura },
      });

      this.logger.log(`Productos anteriores eliminados para factura ID: ${factura.idFactura}`);

      const productosCreados = await this.prisma.detalleFactura.createMany({
        data: productos.map(p => ({
          facturaId: factura.idFactura,
          descripcion: p.descripcion || '',
          cantidad: new Prisma.Decimal(Number(p.cantidad) || 0),
          costoUnitario: new Prisma.Decimal(Number(p.costoUnitario) || 0),
          unidadMedida: p.unidadMedida || '',
        })),
        skipDuplicates: false,
      });

      // ✅ **SOLO marcar como CON_DETALLE si está en CONSULTADO**
      let estadoActualizado = false;
      if (factura.estado === EstadoFactura.CONSULTADO) {
        await this.prisma.factura.update({
          where: { numeroComprobante },
          data: { estado: EstadoFactura.CON_DETALLE },
        });
        estadoActualizado = true;
      }

      this.logger.log(`✅ Productos guardados exitosamente`);
      this.logger.log(`📦 Cantidad: ${productosCreados.count}`);
      this.logger.log(`🏷️ Estado actualizado: ${estadoActualizado ? 'Sí' : 'No'}`);

      return {
        success: true,
        productosGuardados: productosCreados.count,
        facturaId: factura.idFactura,
        estadoActualizado,
      };
    } catch (error: any) {
      this.logger.error(`❌ Error guardando productos: ${error.message}`);
      throw error;
    }
  }

  async scrapingCompletado(numeroComprobante: string, productos?: any[]) {
    this.logger.log(`=== SCRAPING COMPLETADO CON PRODUCTOS ===`);
    this.logger.log(`Número de comprobante: ${numeroComprobante}`);
    this.logger.log(`Productos recibidos: ${productos?.length || 0}`);

    try {
      let numeroCompNormalizado = numeroComprobante;
      if (numeroComprobante.includes('-')) {
        const [s, n] = numeroComprobante.split('-');
        numeroCompNormalizado = `${s.toUpperCase()}-${this.normalizarNumero(n)}`;
      }

      const factura = await this.prisma.factura.findUnique({
        where: { numeroComprobante: numeroCompNormalizado },
        include: { detalles: true },
      });

      if (!factura) {
        throw new Error(`Factura ${numeroComprobante} no encontrada`);
      }

      let productosGuardados = 0;
      if (productos && productos.length > 0) {
        const resultado = await this.guardarProductosFactura(numeroComprobante, productos);
        productosGuardados = resultado.productosGuardados;
      }

      // ✅ **SOLO marcar como CON_DETALLE si está en CONSULTADO**
      let estadoFinal: EstadoFactura;

      if (factura.estado === EstadoFactura.REGISTRADO ||
        factura.estado === EstadoFactura.CONTABILIZADO) {
        estadoFinal = factura.estado;
        this.logger.warn(`Factura ya está ${factura.estado}, no se cambia a CON_DETALLE`);
      } else {
        estadoFinal = EstadoFactura.CON_DETALLE;
      }

      const actualizada = await this.prisma.factura.update({
        where: { numeroComprobante },
        data: { estado: estadoFinal },
        include: { detalles: true, proveedor: true },
      });

      this.logger.log(`✅ Factura ${actualizada.numeroComprobante} marcada como ${estadoFinal}`);
      this.logger.log(`📦 Productos guardados: ${productosGuardados}`);

      return {
        success: true,
        factura: actualizada,
        productosGuardados,
        mensaje: estadoFinal === EstadoFactura.CON_DETALLE
          ? 'Estado CON_DETALLE persistido permanentemente'
          : `Factura mantiene estado ${estadoFinal}`,
      };
    } catch (error: any) {
      this.logger.error(`❌ Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // ✅ **MÉTODO CLAVE: Obtener factura para UI con jerarquía correcta**
  async obtenerFacturaParaUI(numeroComprobante: string) {
    this.logger.log(`Obteniendo factura para UI: ${numeroComprobante}`);

    let numeroCompNormalizado = numeroComprobante;
    if (numeroComprobante.includes('-')) {
      const [s, n] = numeroComprobante.split('-');
      numeroCompNormalizado = `${s.toUpperCase()}-${this.normalizarNumero(n)}`;
    }

    const factura = await this.prisma.factura.findUnique({
      where: { numeroComprobante: numeroCompNormalizado },
      include: {
        detalles: true,
        proveedor: true,
        comprobanteElectronico: true,
      },
    });

    if (!factura) {
      throw new Error('Factura no encontrada');
    }

    // ✅ **JERARQUÍA DE ESTADOS (de mayor a menor prioridad):**
    // 1. CONTABILIZADO (máxima prioridad)
    // 2. REGISTRADO 
    // 3. CON_DETALLE
    // 4. CONSULTADO (menor prioridad)
    let estadoFinal = factura.estado;

    if (factura.estado === EstadoFactura.CONTABILIZADO) {
      estadoFinal = EstadoFactura.CONTABILIZADO;
    } else if (factura.estado === EstadoFactura.REGISTRADO) {
      estadoFinal = EstadoFactura.REGISTRADO;
    } else if (factura.estado === EstadoFactura.CON_DETALLE) {
      estadoFinal = EstadoFactura.CON_DETALLE;
    }

    const estadoUI = this.formatearEstadoParaUI(factura.estado);
    const estadoFinalUI = this.formatearEstadoParaUI(estadoFinal);

    return {
      ...factura,
      estado: estadoUI,
      estadoFinal: estadoFinalUI,
      _estadoOriginal: factura.estado,
    };
  }

  // ✅ **MÉTODO CLAVE: Obtener todas las facturas con jerarquía correcta**
  async obtenerFacturasParaUI(usuarioId: number = 1) {
    this.logger.log(`Obteniendo facturas para UI - Usuario: ${usuarioId}`);

    const facturas = await this.prisma.factura.findMany({
      where: { usuarioId },
      include: {
        detalles: true,
        proveedor: true,
      },
      orderBy: { fechaEmision: 'desc' },
    });

    const facturasFormateadas = facturas.map(factura => {
      // ✅ **MISMA JERARQUÍA DE ESTADOS**
      let estadoFinal = factura.estado;

      if (factura.estado === EstadoFactura.CONTABILIZADO) {
        estadoFinal = EstadoFactura.CONTABILIZADO;
      } else if (factura.estado === EstadoFactura.REGISTRADO) {
        estadoFinal = EstadoFactura.REGISTRADO;
      } else if (factura.estado === EstadoFactura.CON_DETALLE) {
        estadoFinal = EstadoFactura.CON_DETALLE;
      }

      return {
        ...factura,
        estado: this.formatearEstadoParaUI(factura.estado),
        estadoFinal: this.formatearEstadoParaUI(estadoFinal),
      };
    });

    return facturasFormateadas;
  }

  // ==================== MÉTODOS EXISTENTES (sin cambios) ====================

  async marcarConDetalle(numeroComprobante: string) {
    this.logger.log(`=== MARCAR CON DETALLE INICIADO ===`);
    this.logger.log(`Factura: ${numeroComprobante}`);

    try {
      let numeroCompNormalizado = numeroComprobante;
      if (numeroComprobante.includes('-')) {
        const [s, n] = numeroComprobante.split('-');
        numeroCompNormalizado = `${s.toUpperCase()}-${this.normalizarNumero(n)}`;
      }

      const facturaExistente = await this.prisma.factura.findUnique({
        where: { numeroComprobante: numeroCompNormalizado },
      });

      if (!facturaExistente) {
        throw new Error(`Factura ${numeroComprobante} no encontrada`);
      }

      this.logger.log(`Estado actual: ${facturaExistente.estado}`);

      if (facturaExistente.estado === EstadoFactura.REGISTRADO ||
        facturaExistente.estado === EstadoFactura.CONTABILIZADO) {
        this.logger.warn(`Factura ya está ${facturaExistente.estado}, no se cambia`);
        return facturaExistente;
      }

      const factura = await this.prisma.factura.update({
        where: { numeroComprobante: numeroCompNormalizado },
        data: { estado: EstadoFactura.CON_DETALLE },
        include: { detalles: true, proveedor: true },
      });

      this.logger.log(`✅ Estado actualizado a: ${factura.estado}`);
      return factura;
    } catch (error: any) {
      this.logger.error(`❌ Error marcando factura con detalle: ${error.message}`);
      throw error;
    }
  }

  async registrarFactura(numeroComprobante: string) {
    this.logger.log(`=== REGISTRAR FACTURA INICIADO ===`);
    this.logger.log(`Factura: ${numeroComprobante}`);

    try {
      let numeroCompNormalizado = numeroComprobante;
      if (numeroComprobante.includes('-')) {
        const [s, n] = numeroComprobante.split('-');
        numeroCompNormalizado = `${s.toUpperCase()}-${this.normalizarNumero(n)}`;
      }

      const factura = await this.prisma.factura.update({
        where: { numeroComprobante: numeroCompNormalizado },
        data: { estado: EstadoFactura.REGISTRADO },
      });

      this.logger.log(`✅ Estado actualizado a: ${factura.estado}`);
      return factura;
    } catch (error: any) {
      this.logger.error(`❌ Error registrando factura: ${error.message}`);
      throw error;
    }
  }

  async obtenerFacturasPorUsuario(usuarioId: number = 1) {
    this.logger.log(`=== OBTENER FACTURAS INICIADO ===`);
    this.logger.log(`Usuario: ${usuarioId}`);

    try {
      const facturas = await this.prisma.factura.findMany({
        where: { usuarioId },
        include: {
          detalles: true,
          proveedor: true,
          comprobanteElectronico: true,
        },
        orderBy: { fechaEmision: 'desc' },
      });

      const facturasConEstado = facturas.map(factura => {
        let estadoFinal = factura.estado;

        // ✅ **MISMA JERARQUÍA**
        if (factura.estado === EstadoFactura.CONTABILIZADO) {
          estadoFinal = EstadoFactura.CONTABILIZADO;
        } else if (factura.estado === EstadoFactura.REGISTRADO) {
          estadoFinal = EstadoFactura.REGISTRADO;
        } else if (factura.estado === EstadoFactura.CON_DETALLE) {
          estadoFinal = EstadoFactura.CON_DETALLE;
        }

        return {
          ...factura,
          estadoFinal,
          _debug: {
            reglaAplicada: 'ESTADO_JERARQUICO'
          }
        };
      });

      const distribucion = facturasConEstado.reduce((acc, f) => {
        acc[f.estadoFinal] = (acc[f.estadoFinal] || 0) + 1;
        return acc;
      }, {});

      this.logger.log(`Total facturas: ${facturasConEstado.length}`);
      this.logger.log(`Distribución: ${JSON.stringify(distribucion)}`);

      return facturasConEstado;
    } catch (error: any) {
      this.logger.error(`❌ Error obteniendo facturas: ${error.message}`);
      throw error;
    }
  }

  async actualizarEstadoFactura(numeroComprobante: string, nuevoEstado: EstadoFactura) {
    this.logger.log(`Actualizando estado de factura ${numeroComprobante} a ${nuevoEstado}`);

    try {
      let numeroCompNormalizado = numeroComprobante;
      if (numeroComprobante.includes('-')) {
        const [s, n] = numeroComprobante.split('-');
        numeroCompNormalizado = `${s.toUpperCase()}-${this.normalizarNumero(n)}`;
      }

      const factura = await this.prisma.factura.update({
        where: { numeroComprobante: numeroCompNormalizado },
        data: {
          estado: nuevoEstado,
        },
      });

      this.logger.log(`Estado actualizado exitosamente`);
      return factura;
    } catch (error: any) {
      this.logger.error(`Error actualizando estado: ${error.message}`);
      throw error;
    }
  }

  async registrarDesdeSunat(datos: any) {
    this.logger.log('=== REGISTRAR FACTURA DESDE SUNAT ===');
    this.logger.log(`Datos: ${JSON.stringify(datos)}`);

    const numeroNormalizado = this.normalizarNumero(datos.numero);
    const numeroComprobante = `${datos.serie.toUpperCase()}-${numeroNormalizado}`;

    const existente = await this.prisma.factura.findUnique({
      where: { numeroComprobante },
    });

    if (existente) {
      this.logger.log(`Factura ${numeroComprobante} ya existe en BD`);
      return existente;
    }

    await this.prisma.proveedor.upsert({
      where: { rucProveedor: datos.rucEmisor },
      update: { razonSocial: this.sanitizeString(datos.razonSocial) },
      create: {
        rucProveedor: datos.rucEmisor,
        razonSocial: this.sanitizeString(datos.razonSocial),
      },
    });

    let fechaEmision: Date;
    try {
      const [day, month, year] = datos.fechaEmision.split('/').map(Number);
      fechaEmision = new Date(year, month - 1, day);
    } catch (error) {
      fechaEmision = new Date();
    }

    const factura = await this.prisma.factura.create({
      data: {
        numeroComprobante,
        serie: datos.serie.toUpperCase(),
        numero: numeroNormalizado,
        fechaEmision,
        moneda: datos.moneda || 'PEN',
        costoTotal: new Prisma.Decimal(Number(datos.costoTotal) || 0),
        igv: new Prisma.Decimal(Number(datos.igv) || 0),
        importeTotal: new Prisma.Decimal(Number(datos.importeTotal) || 0),
        estado: EstadoFactura.CONSULTADO,
        usuarioId: datos.usuarioId || 1,
        proveedorRuc: datos.rucEmisor,
      },
    });

    this.logger.log(`✅ Factura ${numeroComprobante} registrada en BD con ID: ${factura.idFactura}`);
    return factura;
  }

  // ✅ **MÉTODO NUEVO: Obtener archivos base64 antiguos**
  async obtenerArchivoComprobante(numeroComprobante: string, tipo: 'pdf' | 'xml' | 'cdr') {
    this.logger.log(`Obteniendo archivo ${tipo} para factura: ${numeroComprobante}`);

    const factura = await this.prisma.factura.findUnique({
      where: { numeroComprobante },
      include: { comprobanteElectronico: true },
    });

    if (!factura || !factura.comprobanteElectronico) {
      throw new Error(`Archivos no encontrados para la factura ${numeroComprobante}`);
    }

    const contenido = factura.comprobanteElectronico[tipo];
    if (!contenido) {
      throw new Error(`El archivo de tipo ${tipo} no está disponible para esta factura`);
    }

    return {
      base64: contenido,
      nombreArchivo: `${numeroComprobante}.${tipo === 'cdr' ? 'zip' : tipo}`
    };
  }

  // ✅ **HELPER: Normalizar número a 8 dígitos (formato SUNAT)**
  private normalizarNumero(numero: string): string {
    if (!numero) return '';
    // Eliminar cualquier carácter no numérico por si acaso y rellenar con ceros
    const soloNumeros = numero.replace(/\D/g, '');
    return soloNumeros.padStart(8, '0');
  }

  // ✅ **HELPER: Sanitizar strings para evitar errores de codificación (WIN1252/UTF8)**
  private sanitizeString(str: string): string {
    if (!str) return '';
    // Elimina el carácter de reemplazo Unicode (0xef 0xbf 0xbd) y otros caracteres no compatibles
    return str.replace(/\uFFFD/g, '').trim();
  }

  // ✅ **HELPER: Formatear estados para UI**
  private formatearEstadoParaUI(estado: EstadoFactura): string {
    const estadoMap = {
      [EstadoFactura.CONSULTADO]: 'CONSULTADO',
      [EstadoFactura.CON_DETALLE]: 'CON DETALLE',
      [EstadoFactura.REGISTRADO]: 'REGISTRADO',
      [EstadoFactura.CONTABILIZADO]: 'CONTABILIZADO',
    };

    return estadoMap[estado] || estado;
  }
}