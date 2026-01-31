import {
  Injectable,
  HttpException,
  HttpStatus,
  Logger,
  UnauthorizedException,
  GatewayTimeoutException,
  BadGatewayException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import * as AdmZip from 'adm-zip';
import {
  SunatAuthResponse,
  SunatTicketResponse,
  SunatStatusResponse,
  SunatArchivoReporte,
  DownloadParams,
} from './sunat.interfaces';

@Injectable()
export class SunatService {
  private readonly logger = new Logger(SunatService.name);

  private readonly AUTH_BASE_URL = 'https://api-seguridad.sunat.gob.pe/v1/clientessol';
  private readonly SIRE_BASE_URL = 'https://api-sire.sunat.gob.pe/v1/contribuyente/migeigv/libros';

  private accessToken: string | null = null;
  private tokenExpiration: Date | null = null;

  private readonly POLLING_INTERVAL_MS = 3000;
  private readonly POLLING_MAX_ATTEMPTS = 60;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async obtenerReporteFacturacion(periodo: string): Promise<string> {
    this.logger.log(`Iniciando flujo de obtención de reporte para periodo: ${periodo}`);

    try {
      const token = await this.getAccessToken();
      this.logger.log('Autenticación exitosa');

      const ticketResponse = await this.requestExportTicket(token, periodo);
      this.logger.log(`Ticket obtenido: ${ticketResponse.numTicket}`);

      const archivoReporte = await this.pollTicketStatus(
        token,
        ticketResponse.numTicket,
        periodo,
      );
      this.logger.log(`Archivo listo: ${archivoReporte.nomArchivoReporte}`);

      const downloadParams: DownloadParams = {
        nomArchivoReporte: archivoReporte.nomArchivoReporte,
        codTipoArchivoReporte: '00',
        perTributario: periodo,
        codProceso: '10',
        numTicket: ticketResponse.numTicket,
      };
      const zipBuffer = await this.downloadZipFile(token, downloadParams);
      this.logger.log(`ZIP descargado: ${zipBuffer.length} bytes`);

      const contenido = this.extractTextFromZip(zipBuffer);
      this.logger.log(`Contenido extraído: ${contenido.length} caracteres`);

      return contenido;
    } catch (error) {
      this.logger.error('Error en flujo de obtención de reporte', error);
      throw error;
    }
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.tokenExpiration && new Date() < this.tokenExpiration) {
      this.logger.debug('Usando token en cache');
      return this.accessToken;
    }

    const clientId = this.configService.get<string>('SUNAT_CLIENT_ID');
    const clientSecret = this.configService.get<string>('SUNAT_CLIENT_SECRET');
    const ruc = this.configService.get<string>('SUNAT_RUC');
    const usuarioSol = this.configService.get<string>('SUNAT_USUARIO_SOL');
    const claveSol = this.configService.get<string>('SUNAT_CLAVE_SOL');

    if (!clientId || !clientSecret || !ruc || !usuarioSol || !claveSol) {
      throw new HttpException(
        'Configuración de SUNAT incompleta. Verificar variables de entorno.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const url = `${this.AUTH_BASE_URL}/${clientId}/oauth2/token/`;

    const params = new URLSearchParams();
    params.append('grant_type', 'password');
    params.append('scope', 'https://api-sire.sunat.gob.pe');
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);
    params.append('username', `${ruc}${usuarioSol}`);
    params.append('password', claveSol);

    try {
      const response = await firstValueFrom(
        this.httpService.post<SunatAuthResponse>(url, params.toString(), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }),
      );

      const { access_token, expires_in } = response.data;

      this.accessToken = access_token;
      this.tokenExpiration = new Date(Date.now() + (expires_in - 60) * 1000);

      return access_token;
    } catch (error) {
      const errorMessage = error.response?.data?.error_description || error.message;
      this.logger.error('Error de autenticación SUNAT', errorMessage);
      throw new UnauthorizedException(`Error de autenticación SUNAT: ${errorMessage}`);
    }
  }

  private async requestExportTicket(
    token: string,
    periodo: string,
  ): Promise<SunatTicketResponse> {
    const url = `${this.SIRE_BASE_URL}/rce/propuesta/web/propuesta/${periodo}/exportacioncomprobantepropuesta`;

    try {
      const response = await firstValueFrom(
        this.httpService.get<SunatTicketResponse>(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
          params: {
            codTipoArchivo: '0',
            codOrigenEnvio: '2',
          },
        }),
      );

      if (!response.data.numTicket) {
        throw new Error('SUNAT no devolvió numTicket');
      }

      return response.data;
    } catch (error) {
      const errorMessage = error.response?.data?.msg || error.message;
      this.logger.error('Error al solicitar ticket', errorMessage);
      throw new BadGatewayException(
        `Error al solicitar exportación a SUNAT: ${errorMessage}`,
      );
    }
  }

  private async pollTicketStatus(
    token: string,
    numTicket: string,
    periodo: string,
  ): Promise<SunatArchivoReporte> {
    const url = `${this.SIRE_BASE_URL}/rvierce/gestionprocesosmasivos/web/masivo/consultaestadotickets`;

    for (let attempt = 1; attempt <= this.POLLING_MAX_ATTEMPTS; attempt++) {
      this.logger.debug(`Polling intento ${attempt}/${this.POLLING_MAX_ATTEMPTS}`);

      try {
        const response = await firstValueFrom(
          this.httpService.get<SunatStatusResponse>(url, {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/json',
            },
            params: {
              perIni: periodo,
              perFin: periodo,
              page: '1',
              perPage: '20',
              numTicket: numTicket,
            },
          }),
        );

        const registros = response.data.registros;
        
        this.logger.debug(`Respuesta SUNAT: ${JSON.stringify(response.data, null, 2)}`);
        
        if (!registros || registros.length === 0) {
          this.logger.debug('No se encontraron registros aún, esperando...');
          await this.delay(this.POLLING_INTERVAL_MS);
          continue;
        }

        const registro = registros[0];
        const archivoReporte = registro.archivoReporte?.[0];

        if (registro.codEstadoProceso === '06' && archivoReporte) {
          this.logger.log(`Proceso terminado en intento ${attempt}`);
          return archivoReporte;
        }

        if (!archivoReporte) {
          this.logger.debug('Archivo de reporte aún no disponible, esperando...');
          await this.delay(this.POLLING_INTERVAL_MS);
          continue;
        }

        this.logger.debug(`Estado actual: ${registro.codEstadoProceso} (${registro.desEstadoProceso}), esperando...`);
        await this.delay(this.POLLING_INTERVAL_MS);
      } catch (error) {
        if (error.response?.status === 404) {
          await this.delay(this.POLLING_INTERVAL_MS);
          continue;
        }
        throw error;
      }
    }

    throw new GatewayTimeoutException(
      `Timeout esperando respuesta de SUNAT. El proceso no se completó en el tiempo límite.`,
    );
  }

  private async downloadZipFile(
    token: string,
    params: DownloadParams,
  ): Promise<Buffer> {
    const url = `${this.SIRE_BASE_URL}/rvierce/gestionprocesosmasivos/web/masivo/archivoreporte`;

    try {
      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
          params: {
            nomArchivoReporte: params.nomArchivoReporte,
            codTipoArchivoReporte: params.codTipoArchivoReporte,
            perTributario: params.perTributario,
            codProceso: params.codProceso,
            numTicket: params.numTicket,
          },
          responseType: 'arraybuffer',
        }),
      );

      return Buffer.from(response.data);
    } catch (error) {
      const errorMessage = error.response?.data?.msg || error.message;
      this.logger.error('Error al descargar archivo', errorMessage);
      throw new BadGatewayException(
        `Error al descargar archivo de SUNAT: ${errorMessage}`,
      );
    }
  }

  private extractTextFromZip(zipBuffer: Buffer): string {
    try {
      const zip = new AdmZip(zipBuffer);
      const zipEntries = zip.getEntries();

      const txtEntry = zipEntries.find((entry) =>
        entry.entryName.toLowerCase().endsWith('.txt'),
      );

      if (!txtEntry) {
        throw new Error('No se encontró archivo TXT dentro del ZIP');
      }

      this.logger.debug(`Extrayendo archivo: ${txtEntry.entryName}`);

      const content = zip.readAsText(txtEntry, 'utf-8');

      return content;
    } catch (error) {
      this.logger.error('Error al descomprimir archivo', error.message);
      throw new HttpException(
        `Error al procesar archivo ZIP: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
