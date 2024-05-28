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

  #httpPort: number = -1;
  #udpPort: number = -1;

  #networkClientRegistry: NetworkClientRegistry | undefined;
  #lobbyRegistry: LobbyRegistry | undefined;

  /**
   * The port the server is listening for HTTP messages on.
   *
   * Will be -1 until the server is `start`ed.
   */
  get httpPort() {
    return this.#httpPort;
  }

  /**
   * The port the server is listening for UDP messages on.
   *
   * Will be -1 until the server is `start`ed.
   */
  get udpPort() {
    return this.#udpPort;
  }

  async start(httpPort = LobbyServer.DEFAULT_HTTP_PORT, updPort = LobbyServer.DEFAULT_UDP_PORT) {
    this.#networkClientRegistry = new NetworkClientRegistry();
    this.#lobbyRegistry = new LobbyRegistry(updPort);

    await this.#startHttpServer(httpPort, this.#lobbyRegistry, this.#networkClientRegistry);
    this.#startUdpServer(updPort, this.#lobbyRegistry, this.#networkClientRegistry);

    this.#httpPort = httpPort;
    this.#udpPort = updPort;

    logger.info('🌠 Orion is ready.');
  }

  async stop() {
    this.#httpPort = -1;
    this.#udpPort = -1;

    logger.info('🌠 Orion is shutting down...');

    this.#stopUdpServer();
    await this.#stopHttpServer();

    logger.info('🌠 Orion successfully shut down. Good night!');
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
    this.#lobbyRegistry?.cleanup();
    this.#networkClientRegistry?.cleanup();

    /*
     * Calling `stop` was giving me really weird behaviour where very specific
     * situations were causing the stop to hang. I'm pretty convinced the bug
     * is in Deno itself, because Potami's method here just calls the `shutdown`
     * method on the underlying HTTP server, which is all Deno API. Aborting
     * doesn't seem to give me the hanging issue, so I assume there's something
     * wonky with the attempt at a graceful shutdown. Aborting is fine (the
     * LobbyServer cleans itself up pretty well and logs and whatnot), so I don't
     * necessarily need the graceful shutdown.
     *
     * There are some issues (like [this one](https://github.com/denoland/deno/issues/22387))
     * that may potentially be part of the issue? I notice the `serverWebSocket`
     * resource hangs around longer than it probably should, even though I'm
     * closing all the sockets as I'm able. The bug may be fixed with Deno 2, but
     * currently on Deno 1.43.6, it appears to be bugged, so we'll use `abort`
     * for the time being.
     */
    await this.#httpServer?.abort();
  }

  #stopUdpServer() {
    this.#udpServer?.close();
    this.#udpServer = undefined;
  }
}
