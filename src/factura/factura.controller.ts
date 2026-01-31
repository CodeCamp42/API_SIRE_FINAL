import { Controller, Post, UseInterceptors, UploadedFile, BadRequestException, Logger } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImageRecognitionService } from './image-recognition.service';
import { FacturaService } from './factura.service';

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
			const creada = await this.facturaService.crearDesdeOCR({
				ruc: datos.ruc,
				numero: datos.numero,
				fecha: datos.fecha,
				monto: datos.monto,
				usuarioId: 1,
			});
			return { mensaje: 'Factura creada', id: creada.idFactura, datosDetectados: datos };
		} catch (error: any) {
			this.logger.error('Error guardando factura desde OCR', error?.stack || error?.message || error);
			throw new BadRequestException(error?.message || 'Error al crear factura');
		}
	}
}
