import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { SunatService } from './sunat.service';
import { Logger } from '@nestjs/common';
import { FacturaService } from '../factura/factura.service';
import { SunatGateway } from './sunat.gateway';
import { FacturaDto } from '../factura/dto/factura.dto';

@Processor('scraping', {
    lockDuration: 120000, // 2 minutos para dar tiempo al scraping de Playwright
})
export class SunatProcessor extends WorkerHost {
    private readonly logger = new Logger(SunatProcessor.name);

    constructor(
        private readonly sunatService: SunatService,
        private readonly facturaService: FacturaService,
        private readonly sunatGateway: SunatGateway,
    ) {
        super();
    }

    async process(job: Job<any, any, string>): Promise<any> {
        this.logger.log(`Processing job ${job.id} of type ${job.name}`);

        switch (job.name) {
            case 'descargar-xml':
                try {
                    const { ruc, usuario_sol, clave_sol, rucEmisor, serie, numero } = job.data;

                    // Emitir estado inicial
                    this.sunatGateway.emitScrapingStatus(job.id, { state: 'active' });

                    const result = await this.sunatService.descargarXmlConScript({
                        ruc,
                        usuario_sol,
                        clave_sol,
                        rucEmisor,
                        serie,
                        numero,
                    });

                    if (result && result.id) {
                        try {
                            this.logger.log(`Persisting invoice ${result.id} to database...`);

                            const [s, n] = result.id.split('-');
                            let formattedDate = result.fechaEmision;
                            if (formattedDate && formattedDate.includes('-')) {
                                const [y, m, d] = formattedDate.split('-');
                                formattedDate = `${d}/${m}/${y}`;
                            }

                            const facturaDto: FacturaDto = {
                                rucEmisor: result.emisor.ruc,
                                serie: s,
                                numero: n,
                                fechaEmision: formattedDate,
                                razonSocial: result.emisor.nombre,
                                tipoDocumento: '01',
                                moneda: result.moneda || 'PEN',
                                costoTotal: result.subtotal,
                                igv: result.igv,
                                importeTotal: result.total,
                                productos: (result.items || []).map(item => ({
                                    descripcion: item.descripcion,
                                    cantidad: item.cantidad,
                                    costoUnitario: item.valorUnitario,
                                    unidadMedida: item.unidad,
                                })),
                            };

                            await this.facturaService.guardarFactura(facturaDto);
                            this.logger.log(`Invoice ${result.id} persisted successfully.`);

                            // Emitir éxito
                            this.sunatGateway.emitScrapingStatus(job.id, { state: 'completed', result });

                        } catch (error) {
                            this.logger.error(`Error persisting invoice ${result.id}: ${error.message}`);
                            // Aún así emitimos el resultado pero con advertencia de persistencia si fuera necesario
                            this.sunatGateway.emitScrapingStatus(job.id, { state: 'completed', result });
                        }
                    }

                    return result;
                } catch (error) {
                    this.logger.error(`Job ${job.id} failed: ${error.message}`);
                    this.sunatGateway.emitScrapingStatus(job.id, { state: 'failed', reason: error.message });
                    throw error;
                }

            default:
                this.logger.warn(`Unknown job name: ${job.name}`);
                break;
        }
    }
}