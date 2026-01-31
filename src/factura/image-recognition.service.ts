import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import * as tesseract from 'node-tesseract-ocr';

@Injectable()
export class ImageRecognitionService {
  private readonly logger = new Logger(ImageRecognitionService.name);

  private readonly tesseractConfig = {
    lang: 'spa',
    oem: 1,
    psm: 3,
  } as any;

  async analizarImagen(buffer: Buffer) {
    this.logger.log('Iniciando OCR local');
    try {
      const texto = await tesseract.recognize(buffer, this.tesseractConfig);
      if (!texto || texto.trim().length === 0) {
        this.logger.warn('OCR no devolvió texto');
        throw new Error('No se detectó texto en la imagen');
      }

      this.logger.debug('Texto OCR extraído', { length: texto.length });

      // Parsers sencillos: RUC (11 dígitos), número serie-correlativo, fecha y monto
      const rucMatch = texto.match(/(\d{11})/);
      const numeroMatch = texto.match(/([A-Z0-9]{1,4}[-\s]?\d{1,6})/i);
      const fechaMatch = texto.match(/(\d{4}-\d{2}-\d{2})|(\d{2}[\/\-]\d{2}[\/\-]\d{4})/);
      const montoMatch = texto.match(/(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})/g);

      const ruc = rucMatch?.[1] ?? null;
      let numero = numeroMatch?.[1] ?? null;
      if (numero) numero = numero.replace(/\s+/g, '');

      let fecha = fechaMatch ? fechaMatch[0] : null;
      if (fecha && fecha.includes('/')) {
        const parts = fecha.split('/');
        fecha = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
      }

      let monto: string | null = null;
      if (montoMatch && montoMatch.length > 0) {
        monto = montoMatch[montoMatch.length - 1].replace(/\./g, '').replace(/,/g, '.');
      }

      const result = { ruc, numero, fecha, monto };
      this.logger.log('Datos extraídos de la imagen', result);
      return result;
    } catch (error: any) {
      this.logger.error('Error en OCR local', error?.stack || error?.message || error);
      if (error.message?.includes('ENOENT') || error.message?.includes('EPIPE')) {
        throw new InternalServerErrorException('Tesseract OCR no está instalado en el sistema');
      }
      throw new InternalServerErrorException(error.message || 'Error procesando la imagen');
    }
  }
}