
import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class SireService {
  // URLs base según manuales de SUNAT
  private readonly AUTH_URL = 'https://api-seguridad.sunat.gob.pe/v1/clientessol/client_id/oauth2/token';
  private readonly SIRE_URL = 'https://api-sire.sunat.gob.pe/v1/contribuyente/migeigv/libros/rce/propuesta/web/propuesta';

  constructor(private readonly httpService: HttpService) {}

  // 1. Obtener Token (Tu método es esencial)

  async obtenerToken(ruc: string, usuarioSol: string, claveSol: string) {
    try {
      const params = new URLSearchParams();
      params.append('grant_type', 'password');
      params.append('scope', 'https://api-sire.sunat.gob.pe');
      params.append('client_id', process.env.SUNAT_CLIENT_ID || '');
      params.append('client_secret', process.env.SUNAT_CLIENT_SECRET || '');
      params.append('username', `${ruc}${usuarioSol}`);
      params.append('password', claveSol);

      const response = await firstValueFrom(
        this.httpService.post(this.AUTH_URL, params.toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        })
      );
      
      return response.data.access_token;
    } catch (error) {
      // ESTO ES CLAVE: Imprime el error real para saber qué dice SUNAT
      console.error('Error detalle SUNAT:', error.response?.data || error.message);
      
      const mensajeSunat = error.response?.data?.error_description || 'Fallo de autenticación con SUNAT';
      throw new HttpException(mensajeSunat, HttpStatus.UNAUTHORIZED);
    }
  }



  // 2. Consultar Propuesta (Fusionado)
  async consultarFacturas(token: string, periodo: string) {
    // La URL recomendada es más precisa para el SIRE moderno
    const url = `${this.SIRE_URL}/${periodo}`;

    try {
      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers: { Authorization: `Bearer ${token}` },
          params: { codTipoArchivo: 0, codOrigenEnvio: 2 }
        })
      );
      return response.data; // Aquí vienen las facturas
    } catch (error) {
      throw new HttpException('Error al obtener propuesta del SIRE', HttpStatus.BAD_GATEWAY);
    }
  }

  // 3. Obtener detalle XML/CDR (Lo que te faltaba y te recomendaron)
  async obtenerXmlCdr(token: string, ruc: string, tipo: string, serie: string, numero: string) {
    const url = `https://api.sunat.gob.pe/v1/contribuyente/see/comprobantes/${ruc}-${tipo}-${serie}-${numero}`;

    try {
      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers: { Authorization: `Bearer ${token}` }
        })
      );
      return response.data; // Retorna el XML base64 o link
    } catch (error) {
      throw new HttpException('No se pudo recuperar el XML/CDR', HttpStatus.NOT_FOUND);
    }
  }
}
