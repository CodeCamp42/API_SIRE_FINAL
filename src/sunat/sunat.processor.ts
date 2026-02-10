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

                    const { transformed, files } = await this.sunatService.descargarXmlConScript({
                        ruc,
                        usuario_sol,
                        clave_sol,
                        rucEmisor,
                        serie,
                        numero,
                    });

                    if (transformed && transformed.id) {
                        try {
                            this.logger.log(`Persisting invoice ${transformed.id} to database...`);

                            const [s, n] = transformed.id.split('-');
                            let formattedDate = transformed.fechaEmision;
                            if (formattedDate && formattedDate.includes('-')) {
                                const [y, m, d] = formattedDate.split('-');
                                formattedDate = `${d}/${m}/${y}`;
                            }

                            const facturaDto: FacturaDto = {
                                rucEmisor: transformed.emisor.ruc,
                                serie: s,
                                numero: n,
                                fechaEmision: formattedDate,
                                razonSocial: transformed.emisor.nombre,
                                tipoDocumento: '01',
                                moneda: transformed.moneda || 'PEN',
                                costoTotal: transformed.subtotal,
                                igv: transformed.igv,
                                importeTotal: transformed.total,
                                productos: (transformed.items || []).map(item => ({
                                    descripcion: item.descripcion,
                                    cantidad: item.cantidad,
                                    costoUnitario: item.valorUnitario,
                                    unidadMedida: item.unidad,
                                })),
                            };

                            await this.facturaService.guardarFactura(facturaDto, files);
                            this.logger.log(`Invoice ${transformed.id} persisted successfully with files.`);

                            // Emitir éxito
                            this.sunatGateway.emitScrapingStatus(job.id, { state: 'completed', result: transformed });

                        } catch (error) {
                            this.logger.error(`Error persisting invoice ${transformed.id}: ${error.message}`);
                            // Aún así emitimos el resultado pero con advertencia de persistencia si fuera necesario
                            this.sunatGateway.emitScrapingStatus(job.id, { state: 'completed', result: transformed });
                        }
                    }

                    return transformed;
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