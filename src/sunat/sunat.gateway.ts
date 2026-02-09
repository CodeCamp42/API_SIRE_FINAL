import { WebSocketGateway, WebSocketServer, OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, } from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
    cors: {
        origin: '*',
    },
})
export class SunatGateway
    implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer() server: Server;
    private logger: Logger = new Logger('SunatGateway');

    afterInit(server: Server) {
        this.logger.log('WebSocket Gateway Inicializado');
    }

    handleConnection(client: Socket, ...args: any[]) {
        this.logger.log(`Cliente conectado: ${client.id}`);
    }

    handleDisconnect(client: Socket) {
        this.logger.log(`Cliente desconectado: ${client.id}`);
    }

    /**
     * Envía una notificación de estado de scraping a todos los clientes conectados.
     * En una versión más avanzada, podríamos usar 'rooms' para enviar solo al usuario dueño del job.
     */
    emitScrapingStatus(jobId: string, data: { state: string; result?: any; reason?: string }) {
        this.logger.log(`Emitiendo evento 'scraping_status' para el job: ${jobId}`);
        this.server.emit('scraping_status', {
            jobId,
            ...data,
        });
    }
}