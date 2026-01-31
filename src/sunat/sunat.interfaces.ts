export interface SunatAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export interface SunatTicketResponse {
  numTicket: string;
  codCar?: string;
  fecProceso?: string;
}

export interface SunatStatusResponse {
  paginacion: {
    page: number;
    perPage: number;
    totalRegistros: number;
  };
  registros: SunatTicketRegistro[];
}

export interface SunatTicketRegistro {
  numTicket: string;
  perTributario: string;
  codProceso: string;
  desProceso?: string;
  codEstadoProceso: string;
  desEstadoProceso?: string;
  fecInicioProceso?: string;
  showReporteDescarga?: string;
  archivoReporte: SunatArchivoReporte[];
  subProcesos?: SunatSubProceso[];
}

export interface SunatSubProceso {
  codTipoSubProceso: string;
  desTipoSubProceso: string;
  codEstado: string;
  numIntentos: number;
}

export interface SunatArchivoReporte {
  codTipoAchivoReporte: string;
  nomArchivoReporte: string;
  nomArchivoContenido: string;
}

export interface DownloadParams {
  nomArchivoReporte: string;
  codTipoArchivoReporte: string;
  perTributario: string;
  codProceso: string;
  numTicket: string;
}

export interface SunatErrorResponse {
  cod: string;
  msg: string;
}

export interface SunatConfig {
  clientId: string;
  clientSecret: string;
  ruc: string;
  usuarioSol: string;
  claveSol: string;
}
