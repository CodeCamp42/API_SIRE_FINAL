import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EstadoFactura } from '@prisma/client';

@Injectable()
export class FacturaService {
	private readonly logger = new Logger(FacturaService.name);
	constructor(private readonly prisma: PrismaService) {}

	async crearDesdeOCR(datos: { ruc?: string; numero?: string; fecha?: string; monto?: string; usuarioId?: number }) {
		this.logger.log('Crear factura desde OCR', { resumen: { ruc: datos.ruc, numero: datos.numero } });

		if (!datos.ruc) throw new Error('RUC no detectado en la imagen');
		if (!datos.numero) throw new Error('Número de comprobante no detectado en la imagen');

		// Asegurar proveedor
		await this.prisma.proveedor.upsert({
			where: { rucProveedor: datos.ruc },
			update: {},
			create: { rucProveedor: datos.ruc, razonSocial: 'Proveedor desde OCR' }
		});

		// Crear factura
		const created = await this.prisma.factura.create({
			data: {
				numeroComprobante: datos.numero,
				fechaEmision: datos.fecha ? new Date(datos.fecha) : new Date(),
				total: datos.monto ? Number(datos.monto) : 0,
				estado: EstadoFactura.CONSULTADO,
				usuarioId: datos.usuarioId ?? 1,
				proveedorRuc: datos.ruc,
			}
		});

		this.logger.log('Factura creada desde OCR', { id: created.idFactura });
		return created;
	}
}
