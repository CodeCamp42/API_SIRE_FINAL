import {
  Injectable,
  HttpException,
  HttpStatus,
  Logger,
  UnauthorizedException,
  GatewayTimeoutException,
  NotFoundException,
  BadGatewayException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { firstValueFrom } from 'rxjs';
import * as AdmZip from 'adm-zip';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
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

  private readonly UNIT_MAP = {
    'GLL': 'US GALON',
    'NIU': 'UNIDAD',
    'LDR': 'LITRO',
    'KGM': 'KILOGRAMO',
    'TNE': 'TONELADA',
    'MTR': 'METRO',
    'ZZ': 'UNIDAD',
    'BX': 'CAJA',
    'DZN': 'DOCENA',
  };

  private readonly AUTH_BASE_URL = 'https://api-seguridad.sunat.gob.pe/v1/clientessol';
  private readonly SIRE_BASE_URL = 'https://api-sire.sunat.gob.pe/v1/contribuyente/migeigv/libros';

  private accessToken: string | null = null;
  private tokenExpiration: Date | null = null;

  private readonly POLLING_INTERVAL_MS = 3000;
  private readonly POLLING_MAX_ATTEMPTS = 60;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @InjectQueue('scraping') private readonly scrapingQueue: Queue,
  ) { }


  async obtenerReportesPorRango(
    periodoInicio: string,
    periodoFin: string,
  ): Promise<Array<{ periodo: string; contenido: any[] }>> {
    const periodos = this.generarPeriodos(periodoInicio, periodoFin);
    this.logger.log(`Obteniendo reportes para ${periodos.length} períodos: ${periodos.join(', ')}`);

    const resultados: Array<{ periodo: string; contenido: any[] }> = [];

    for (const periodo of periodos) {
      try {
        const contenidoTexto = await this.obtenerReporteFacturacion(periodo);

        // Transformamos el string con pipes "|" a un Array de Objetos JSON
        const contenidoParseado = this.parsearContenidoSunat(contenidoTexto);

        resultados.push({ periodo, contenido: contenidoParseado });
      } catch (error) {
        this.logger.warn(`Error obteniendo reporte para periodo ${periodo}: ${error.message}`);
        // Devolvemos un array vacío en contenido si hay error para no romper el Front
        resultados.push({ periodo, contenido: [] });
      }
    }

    return resultados;
  }

  private transformInvoice(parsedXml: any, filenameHint?: string): any | null {
    try {
      // El XML parseado puede tener la raíz 'Invoice' o espacios de nombres
      const invoice = parsedXml?.Invoice || parsedXml;

      // Helper mejorado para extraer valor de objetos xml2js (que pueden tener {_} o ser string directo)
      const getValue = (val: any) => {
        if (val == null) return null;
        if (typeof val !== 'object') return val;
        if (Array.isArray(val)) return getValue(val[0]);
        return val['_'] || val['#text'] || val; // xml2js suele poner el texto en "_"
      };

      // Helper para buscar rutas, ahora usando getValue al final
      const get = (obj: any, paths: string[]) => {
        for (const p of paths) {
          const parts = p.split('.');
          let cur = obj;
          let ok = true;
          for (const part of parts) {
            if (cur == null) { ok = false; break; }
            cur = cur[part];
          }
          if (ok && cur != null) return getValue(cur);
        }
        return null;
      };

      const id = get(invoice, ['cbc:ID']);
      const fechaEmision = get(invoice, ['cbc:IssueDate']);
      const horaEmision = get(invoice, ['cbc:IssueTime']);

      // Emisor
      const supplierParty = invoice['cac:AccountingSupplierParty']?.['cac:Party'];
      const supplierId = get(supplierParty, ['cac:PartyIdentification.cbc:ID']) ||
        get(supplierParty, ['cac:PartyIdentification.ID']); // Fallback sin namespace strict
      const supplierName = get(supplierParty, ['cac:PartyLegalEntity.cbc:RegistrationName']) ||
        get(supplierParty, ['cac:PartyName.cbc:Name']);

      // Receptor
      const customerParty = invoice['cac:AccountingCustomerParty']?.['cac:Party'];
      const customerId = get(customerParty, ['cac:PartyIdentification.cbc:ID']);
      const customerName = get(customerParty, ['cac:PartyLegalEntity.cbc:RegistrationName']) ||
        get(customerParty, ['cac:PartyName.cbc:Name']);

      // Totales
      const totals = invoice['cac:LegalMonetaryTotal'];
      const subtotal = parseFloat(get(totals, ['cbc:LineExtensionAmount']) || 0);
      const igv = parseFloat(get(invoice, ['cac:TaxTotal.cbc:TaxAmount']) || 0);
      const total = parseFloat(get(totals, ['cbc:PayableAmount']) || 0);
      const moneda = get(invoice, ['cbc:DocumentCurrencyCode']);

      // Items
      let lines = invoice['cac:InvoiceLine'];
      if (!lines) lines = [];
      if (!Array.isArray(lines)) lines = [lines];

      const items = lines.map((ln: any) => {
        const qty = parseFloat(get(ln, ['cbc:InvoicedQuantity']) || 0);
        // unitCode está directo en el objeto por mergeAttrs: true
        const unitCode = ln['cbc:InvoicedQuantity']?.['unitCode'] || 'NIU';
        const unidad = this.UNIT_MAP[unitCode] || unitCode;
        const codigo = get(ln, ['cac:Item.cac:SellersItemIdentification.cbc:ID']) || get(ln, ['cac:Item.cbc:ID']);
        const descripcion = get(ln, ['cac:Item.cbc:Description']);
        const valorUnitario = parseFloat(get(ln, ['cac:Price.cbc:PriceAmount']) || 0);

        return {
          cantidad: qty,
          unidad: unidad,
          codigo: codigo,
          descripcion: descripcion,
          valorUnitario: valorUnitario,
          icbper: 0,
        };
      });

      return {
        id,
        fechaEmision,
        horaEmision,
        moneda,
        emisor: {
          ruc: supplierId,
          nombre: supplierName,
        },
        receptor: {
          ruc: customerId,
          nombre: customerName,
        },
        subtotal,
        igv,
        total,
        items,
        archivoXml: filenameHint || '',
      };
    } catch (err) {
      this.logger.warn('transformInvoice: error al mapear XML -> JSON', err.message || err);
      return null;
    }
  }


  private generarPeriodos(periodoInicio: string, periodoFin: string): string[] {
    const periodos: string[] = [];

    let anioActual = parseInt(periodoInicio.substring(0, 4), 10);
    let mesActual = parseInt(periodoInicio.substring(4, 6), 10);

    const anioFin = parseInt(periodoFin.substring(0, 4), 10);
    const mesFin = parseInt(periodoFin.substring(4, 6), 10);

    while (anioActual < anioFin || (anioActual === anioFin && mesActual <= mesFin)) {
      const periodo = `${anioActual}${mesActual.toString().padStart(2, '0')}`;
      periodos.push(periodo);

      mesActual++;
      if (mesActual > 12) {
        mesActual = 1;
        anioActual++;
      }
    }

    return periodos;
  }

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

  /**
   * Ejecuta el script Python `descargaXml.py` en un directorio temporal con las credenciales y params
   * Devuelve un Buffer con el ZIP resultante (todos los archivos descargados zipeados)
   */
  async descargarXmlConScript(options: { rucEmisor: string; serie: string; numero: string; ruc: string; usuario_sol: string; clave_sol: string; timeoutMs?: number; }): Promise<any> {
    const { rucEmisor, serie, numero, ruc, usuario_sol, clave_sol, timeoutMs = 120000 } = options;

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sunat-'));
    const downloadDir = path.join(tmpDir, 'downloads');
    fs.mkdirSync(downloadDir, { recursive: true });

    const scriptPath = path.resolve(process.cwd(), 'src', 'script', 'descargaXml.js');

    const env = Object.assign({}, process.env, {
      SUNAT_RUC: ruc,
      SUNAT_USER: usuario_sol,
      SUNAT_PASS: clave_sol,
      DOWNLOAD_DIR: downloadDir,
      RUC_EMISOR: rucEmisor,
      SERIE: serie,
      NUMERO: numero,
      // Playwright needs to know where to find browsers if installed locally or global
      // but usually standard env inheritance is enough.
    });

    this.logger.log(`Ejecutando script Node.js (Playwright) en ${tmpDir}`);

    return new Promise<any>((resolve, reject) => {
      const proc = spawn('node', [scriptPath], { env, cwd: process.cwd() });
      let stdout = '';
      let stderr = '';

      const timeout = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new GatewayTimeoutException('Timeout ejecutando script de descarga'));
      }, timeoutMs);

      proc.stdout.on('data', (data) => { stdout += data.toString(); this.logger.debug(data.toString()); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); this.logger.error(data.toString()); });

      proc.on('close', async (code) => {
        clearTimeout(timeout);
        this.logger.log(`Script finalizó con código ${code}`);

        try {
          const files = fs.readdirSync(downloadDir);
          this.logger.log(`Archivos detectados en ${downloadDir}: ${files.join(', ')}`);
          
          if (!files || files.length === 0) {
            this.logger.warn('No se encontraron archivos descargados por el script');
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (er) { }
            return reject(new BadGatewayException('No se descargaron archivos'));
          }

          // Priorizar búsqueda de ZIPs y filtrar archivos CDR (R-...)
          const zipFiles = files.filter(f => f.toLowerCase().endsWith('.zip'));
          const xmlFiles = files.filter(f =>
            f.toLowerCase().endsWith('.xml') && !f.toUpperCase().startsWith('R-')
          );

          let xmlContent = '';
          let filename = '';

          if (zipFiles.length > 0) {
            for (const zf of zipFiles) {
              const fullPath = path.join(downloadDir, zf);
              const z = new AdmZip(fullPath);
              const entries = z.getEntries().filter(e =>
                e.entryName.toLowerCase().endsWith('.xml') && !e.entryName.toUpperCase().startsWith('R-')
              );
              if (entries.length > 0) {
                xmlContent = entries[0].getData().toString('utf-8');
                filename = entries[0].entryName;
                break; // Encontrado, salir del loop
              }
            }
          }

          if (!xmlContent && xmlFiles.length > 0) {
            const xf = xmlFiles[0];
            const fullPath = path.join(downloadDir, xf);
            xmlContent = fs.readFileSync(fullPath, 'utf-8');
            filename = xf;
          }

          if (!xmlContent) {
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (er) { }
            return reject(new BadGatewayException('No se encontró contenido XML válido en la descarga'));
          }

          // Parsear XML a JSON
          let parseStringPromise: any = null;
          try {
            const xml2js = require('xml2js');
            parseStringPromise = xml2js.parseStringPromise;
          } catch (err) {
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (er) { }
            return reject(new HttpException('Dependencia xml2js faltante', HttpStatus.INTERNAL_SERVER_ERROR));
          }

          const parsed = await parseStringPromise(xmlContent, { explicitArray: false, mergeAttrs: true });
          const transformed = this.transformInvoice(parsed, filename);

          // Capturar archivos adicionales (PDF, CDR)
          const pdfFiles = files.filter(f => f.toLowerCase().endsWith('.pdf'));
          let pdfBase64 = '';
          if (pdfFiles.length > 0) {
            const pdfPath = path.join(downloadDir, pdfFiles[0]);
            pdfBase64 = fs.readFileSync(pdfPath).toString('base64');
          }

          let cdrBase64 = '';
          // Según instrucción del usuario: Series que comienzan con 'E' no tienen CDR
          if (!serie.toUpperCase().startsWith('E')) {
            const cdrFiles = files.filter(f => 
              f.toLowerCase().endsWith('.zip') && f.toUpperCase().startsWith('R-')
            );
            if (cdrFiles.length > 0) {
              this.logger.log(`Encontrado archivo CDR: ${cdrFiles[0]}`);
              const cdrPath = path.join(downloadDir, cdrFiles[0]);
              cdrBase64 = fs.readFileSync(cdrPath).toString('base64');
            } else {
              this.logger.warn('No se encontró ningún archivo que coincida con el patrón de CDR (R-*.zip)');
            }
          }

          const xmlBase64 = Buffer.from(xmlContent).toString('base64');

          // Cleanup
          try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (er) { }

          resolve({
            transformed,
            files: {
              xml: xmlBase64,
              pdf: pdfBase64,
              cdr: cdrBase64
            }
          });

        } catch (e) {
          this.logger.error('Error procesando archivos del script', e.message || e);
          try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (er) { }
          reject(new BadGatewayException('Error procesando archivos del script'));
        }
      });
    });
  }


  private parsearContenidoSunat(texto: string): any[] {
    if (!texto) return [];

    // 1. Separamos por líneas
    const lineas = texto.split('\n');

    // 2. La primera línea son los encabezados, la saltamos
    // La data real empieza en la línea índice 1
    const registrosRaw = lineas.slice(1);
    const resultados = [];

    for (const linea of registrosRaw) {
      if (!linea.trim() || linea.includes('RUC|Apellidos')) continue;

      const c = linea.split('|');

      // Mapeo basado en la estructura de SUNAT que enviaste
      resultados.push({
        rucEmisor: c[0],
        razonSocialEmisor: c[1],
        periodo: c[2],
        carSunat: c[3],
        fechaEmision: c[4],
        tipoCP: c[6],
        serie: c[7],
        numero: c[9],
        tipoDocReceptor: c[11],
        nroDocReceptor: c[12],
        nombreReceptor: c[13],
        baseGravada: parseFloat(c[14]) || 0,
        igv: parseFloat(c[15]) || 0,
        montoNoGravado: parseFloat(c[20]) || 0,
        total: parseFloat(c[24]) || 0,
        moneda: c[25],
        tipodecambio: parseFloat(c[26]) || 0,
        estado: c[39] // Est. Comp.
      });
    }

    return resultados;
  }


  private async _getLatestXmlContent(): Promise<{ xmlContent: string; jsonContent: any; filename: string }> {
    const scrapingDir = this.configService.get<string>('SCRAPING_DOWNLOAD_DIR')
      || path.join(process.cwd(), 'downloads');

    this.logger.log(`Buscando ZIPs de scraping en: ${scrapingDir}`);

    if (!fs.existsSync(scrapingDir)) {
      throw new NotFoundException('No existe el directorio de descargas del scraping.');
    }

    const files = fs.readdirSync(scrapingDir)
      .map((f) => ({ name: f, full: path.join(scrapingDir, f) }))
      .filter((f) => fs.statSync(f.full).isFile() && f.name.toLowerCase().endsWith('.zip'));

    if (!files || files.length === 0) {
      throw new NotFoundException('No se encontraron archivos ZIP de scraping en el directorio configurado.');
    }

    // Elegir el más reciente por mtime
    files.sort((a, b) => fs.statSync(b.full).mtime.getTime() - fs.statSync(a.full).mtime.getTime());
    const latest = files[0];
    this.logger.log(`Usando ZIP más reciente: ${latest.name}`);

    const zip = new AdmZip(latest.full);
    const entries = zip.getEntries().filter((e) =>
      e.entryName.toLowerCase().endsWith('.xml') && !e.entryName.toUpperCase().startsWith('R-')
    );

    if (!entries || entries.length === 0) {
      throw new NotFoundException('No se encontró archivo XML dentro del ZIP más reciente.');
    }

    const xmlEntry = entries[0];
    const xmlContent = xmlEntry.getData().toString('utf-8');

    // Parsear XML a JSON
    let parseStringPromise: any = null;
    try {
      const xml2js = require('xml2js');
      parseStringPromise = xml2js.parseStringPromise;
    } catch (err) {
      this.logger.error('La dependencia "xml2js" no está instalada. Ejecuta: npm install xml2js');
      throw new HttpException('Dependencia faltante: xml2js. Ejecuta `npm install xml2js` en el backend.', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    const parsed = await parseStringPromise(xmlContent, { explicitArray: false, mergeAttrs: true });
    const transformed = this.transformInvoice(parsed, xmlEntry.entryName);

    return {
      xmlContent,
      jsonContent: transformed,
      filename: xmlEntry.entryName,
    };
  }

  async encolarScraping(data: any) {
    this.logger.log(`Encolando trabajo de scraping para ${data.serie}-${data.numero}`);
    const job = await this.scrapingQueue.add('descargar-xml', data, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: {
        age: 3600, // Mantener por 1 hora
        count: 1000, // O hasta 1000 trabajos
      },
      removeOnFail: {
        age: 24 * 3600, // Mantener por 24 horas si falla
      },
    });

    return {
      success: true,
      jobId: job.id,
      message: 'Trabajo de scraping encolado correctamente',
    };
  }

  async getJobStatus(jobId: string) {
    const job = await this.scrapingQueue.getJob(jobId);

    if (!job) {
      throw new NotFoundException(`Trabajo con ID ${jobId} no encontrado`);
    }

    const state = await job.getState();
    const progress = job.progress;
    const result = job.returnvalue;
    const reason = job.failedReason;

    return {
      id: job.id,
      state,
      progress,
      result,
      reason,
    };
  }

  async vaciarCola() {
    this.logger.log('Vaciando cola de scraping...');
    await this.scrapingQueue.obliterate({ force: true });
    return {
      success: true,
      message: 'Cola de scraping vaciada correctamente (obliterated)',
    };
  }
}
