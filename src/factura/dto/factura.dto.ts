
export class ProductoDto {
  descripcion: string;
  cantidad: string | number;
  costoUnitario: string | number;
  unidadMedida?: string;
}

export class FacturaDto {
  id?: number;
  rucEmisor: string;
  serie: string;
  numero: string;
  fechaEmision: string;
  razonSocial: string;
  tipoDocumento: string;
  moneda: string;
  costoTotal: string | number;
  igv: string | number;
  importeTotal: string | number;
  productos: ProductoDto[];
}

export class CrearFacturaDto {
  facturas: FacturaDto[];
}
