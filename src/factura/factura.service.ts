import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EstadoFactura } from '@prisma/client';
import { CrearFacturaDto, FacturaDto } from './dto/factura.dto';

@Injectable()
// Comentario para forzar refresco de tipos en el editor
export class FacturaService {
	private readonly logger = new Logger(FacturaService.name);
	constructor(private readonly prisma: PrismaService) {}

	async procesarFacturas(data: CrearFacturaDto) {
		const resultados = [];

		for (const facturaDto of data.facturas) {
			try {
				const res = await this.guardarFactura(facturaDto);
				resultados.push(res);
			} catch (error) {
				this.logger.error(`Error procesando factura ${facturaDto.serie}-${facturaDto.numero}: ${error.message}`);
				resultados.push({ success: false, error: error.message, serie: facturaDto.serie, numero: facturaDto.numero });
			}
		}

		return resultados;
	}

	private async guardarFactura(f: FacturaDto) {
		// 1. Asegurar proveedor
		await this.prisma.proveedor.upsert({
			where: { rucProveedor: f.rucEmisor },
			update: { razonSocial: f.razonSocial },
			create: { rucProveedor: f.rucEmisor, razonSocial: f.razonSocial },
		});

		const numeroComprobante = `${f.serie}-${f.numero}`;

		// 2. Verificar duplicado
		const existente = await this.prisma.factura.findUnique({
			where: { numeroComprobante },
		});

		if (existente) {
			return { success: false, message: 'Factura ya existe', id: existente.idFactura, numeroComprobante };
		}

		// 3. Parsear fecha (DD/MM/YYYY)
		const [day, month, year] = f.fechaEmision.split('/').map(Number);
		const fechaEmision = new Date(year, month - 1, day);

		// 4. Crear factura con detalles
		const nuevaFactura = await this.prisma.factura.create({
			data: {
				numeroComprobante,
				serie: f.serie,
				numero: f.numero,
				fechaEmision,
				moneda: f.moneda || 'PEN',
				costoTotal: Number(f.costoTotal),
				igv: Number(f.igv),
				importeTotal: Number(f.importeTotal),
				estado: EstadoFactura.CONSULTADO,
				usuarioId: 1, // Usuario por defecto por ahora
				proveedorRuc: f.rucEmisor,
				detalles: {
					create: f.productos.map(p => ({
						descripcion: p.descripcion,
						cantidad: Number(p.cantidad),
						costoUnitario: Number(p.costoUnitario),
						unidadMedida: p.unidadMedida,
					})),
				},
			} as any,
			include: { detalles: true } as any,
		});

		return { success: true, id: nuevaFactura.idFactura, numeroComprobante };
	}

	async crearDesdeOCR(datos: { ruc?: string; numero?: string; fecha?: string; monto?: string; usuarioId?: number }) {
		this.logger.log('Crear factura desde OCR', { resumen: { ruc: datos.ruc, numero: datos.numero } });

		if (!datos.ruc) throw new Error('RUC no detectado en la imagen');
		if (!datos.numero) throw new Error('Número de comprobante no detectado en la imagen');

		// Asegurar proveedor
		await this.prisma.proveedor.upsert({
			where: { rucProveedor: datos.ruc },
			update: {},
			create: { rucProveedor: datos.ruc, razonSocial: 'Proveedor desde OCR' },
		});

		// Comprobar si ya existe una factura con ese número
		const existente = await this.prisma.factura.findUnique({ where: { numeroComprobante: datos.numero } });
		if (existente) {
			this.logger.warn('Factura ya registrada', { id: existente.idFactura, numero: datos.numero });
			return { created: false, factura: existente } as { created: boolean; factura: any };
		}

		// Intentar separar serie y numero
		let serie = '0000';
		let numero = datos.numero;
		if (datos.numero.includes('-')) {
			const parts = datos.numero.split('-');
			serie = parts[0];
			numero = parts[1];
		}

		const total = datos.monto ? Number(datos.monto) : 0;
		const igv = total * 0.18; // Estimación simple
		const costoTotal = total - igv;

		// Crear factura
		const created = await this.prisma.factura.create({
			data: {
				numeroComprobante: datos.numero,
				serie,
				numero,
				fechaEmision: datos.fecha ? new Date(datos.fecha) : new Date(),
				importeTotal: total,
				costoTotal,
				igv,
				moneda: 'PEN',
				estado: EstadoFactura.CONSULTADO,
				usuarioId: datos.usuarioId ?? 1,
				proveedorRuc: datos.ruc,
			} as any,
		});

		this.logger.log('Factura creada desde OCR', { id: created.idFactura });
		return { created: true, factura: created } as { created: boolean; factura: any };
	}

	async buscarPorNumero(numeroComprobante: string) {
		this.logger.log(`Buscando factura por número: ${numeroComprobante}`);
		return await this.prisma.factura.findUnique({
			where: { numeroComprobante },
			include: {
				detalles: true,
				proveedor: true,
				comprobanteElectronico: true,
			},
		});
	}
}
