import { Controller, Post, UseInterceptors, UploadedFile, BadRequestException, Logger, Body, Get, Param, NotFoundException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImageRecognitionService } from './image-recognition.service';
import { FacturaService } from './factura.service';
import { CrearFacturaDto } from './dto/factura.dto';

@Controller('factura')
export class FacturaController {
	private readonly logger = new Logger(FacturaController.name);
	constructor(
		private readonly imageService: ImageRecognitionService,
		private readonly facturaService: FacturaService,
	) {}

	@Post('reconocer')
	@UseInterceptors(FileInterceptor('file'))
	async reconocerYGuardar(@UploadedFile() file: Express.Multer.File) {
		if (!file) throw new BadRequestException('No se envió archivo');

		this.logger.log('Archivo recibido para reconocimiento', { filename: file.originalname, size: file.size });
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
				return { mensaje: 'Factura ya registrada', id: resultado.factura.idFactura, datosDetectados: datos };
			}
			return { mensaje: 'Factura creada', id: resultado.factura.idFactura, datosDetectados: datos };
		} catch (error: any) {
			this.logger.error('Error guardando factura desde OCR', error?.stack || error?.message || error);
			throw new BadRequestException(error?.message || 'Error al crear factura');
		}
	}

	@Post('procesarFactura')
	async procesarFactura(@Body() data: CrearFacturaDto) {
		this.logger.log('Petición recibida en procesarFactura', { count: data.facturas?.length });
		const resultados = await this.facturaService.procesarFacturas(data);
		return {
			message: 'Proceso de facturas completado',
			resultados,
		};
	}

	@Get(':numeroComprobante')
	async obtenerFactura(@Param('numeroComprobante') numeroComprobante: string) {
		this.logger.log(`Petición GET recibida para factura: ${numeroComprobante}`);
		const factura = await this.facturaService.buscarPorNumero(numeroComprobante);

		if (!factura) {
			throw new NotFoundException(`Factura con número ${numeroComprobante} no encontrada`);
		}

		return factura;
	}
}
