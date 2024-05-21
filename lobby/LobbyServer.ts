import { HttpServer, handleCors } from 'potami';
import { NetworkClientRegistry } from '../network/NetworkClientRegistry.ts';
import { LobbyRegistry } from './LobbyRegistry.ts';
import { LobbiesController } from './http/api/lobbies/lobbies.controller.ts';
import { PingController } from './http/api/ping/ping.controller.ts';
import { handleWebSocketUpgrade } from './http/middleware/handle-web-socket-upgrade.middleware.ts';

export class LobbyServer {
  public static readonly DEFAULT_PORT = 5980;

  #httpServer: HttpServer | undefined;

  async start(port = LobbyServer.DEFAULT_PORT) {
    if (this.#httpServer) {
      await this.stop();
    }

    this.#httpServer = new HttpServer();
    const networkClientRegistry = new NetworkClientRegistry();
    const lobbyRegistry = new LobbyRegistry();

    await this.#httpServer
      .entryMiddleware(handleWebSocketUpgrade(networkClientRegistry, lobbyRegistry), handleCors())
      .controller(new PingController())
      .controller(new LobbiesController(lobbyRegistry, networkClientRegistry))
      .start(port);
  }

  async stop() {
    await this.#httpServer?.stop();
  }
}
