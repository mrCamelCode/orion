import { HttpServer, handleCors } from 'potami';
import { logger } from '../logging/Logger.ts';
import { NetworkClientRegistry } from '../network/NetworkClientRegistry.ts';
import { LobbyRegistry } from './LobbyRegistry.ts';
import { LobbiesController } from './http/api/lobbies/lobbies.controller.ts';
import { PingController } from './http/api/ping/ping.controller.ts';
import { handleWebSocketUpgrade } from './http/middleware/handle-web-socket-upgrade.middleware.ts';
import { UdpHandler } from './udp/UdpHandler.ts';

export class LobbyServer {
  public static readonly DEFAULT_HTTP_PORT = 5980;
  public static readonly DEFAULT_UDP_PORT = 5990;

  #httpServer: HttpServer | undefined;
  #udpServer: Deno.DatagramConn | undefined;

  async start(httpPort = LobbyServer.DEFAULT_HTTP_PORT, updPort = LobbyServer.DEFAULT_UDP_PORT) {
    const networkClientRegistry = new NetworkClientRegistry();
    const lobbyRegistry = new LobbyRegistry(updPort);

    await this.#startHttpServer(httpPort, lobbyRegistry, networkClientRegistry);
    this.#startUdpServer(updPort, lobbyRegistry, networkClientRegistry);
  }

  async stop() {
    await this.#stopHttpServer();
    this.#stopUdpServer();
  }

  async #startHttpServer(port: number, lobbyRegistry: LobbyRegistry, networkClientRegistry: NetworkClientRegistry) {
    if (this.#httpServer) {
      await this.#stopHttpServer();
    }

    this.#httpServer = new HttpServer();

    await this.#httpServer
      .entryMiddleware(handleWebSocketUpgrade(networkClientRegistry, lobbyRegistry), handleCors())
      .controller(new PingController())
      .controller(new LobbiesController(lobbyRegistry, networkClientRegistry))
      .start(port);

    logger.info('HTTP server is ready.');
  }

  #startUdpServer(port: number, lobbyRegistry: LobbyRegistry, networkClientRegistry: NetworkClientRegistry) {
    if (this.#udpServer) {
      this.#stopUdpServer();
    }

    this.#udpServer = Deno.listenDatagram({ port, transport: 'udp' });

    const processDatagrams = async () => {
      if (this.#udpServer) {
        const udpHandler = new UdpHandler(lobbyRegistry, networkClientRegistry);

        logger.info('UDP listener is ready.');

        for await (const incomingDatagram of this.#udpServer) {
          if (!this.#udpServer) {
            break;
          }

          udpHandler.handle(incomingDatagram);
        }
      }
    };

    processDatagrams();
  }

  async #stopHttpServer() {
    await this.#httpServer?.stop();
  }

  #stopUdpServer() {
    this.#udpServer?.close();
    this.#udpServer = undefined;
  }
}
