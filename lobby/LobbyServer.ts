import { NetworkClient } from '../client/NetworkClient.ts';
import { NetworkClientRegistry } from '../client/NetworkClientRegistry.ts';
import { logger } from '../logging/Logger.ts';
import { LobbyRegistry } from './LobbyRegistry.ts';
import { LobbyClientWsMethod, LobbyServerWsMethod } from './lobby.model.ts';

export class LobbyServer {
  public static readonly DEFAULT_PORT = 5980;

  #httpServer: Deno.HttpServer | undefined;
  #networkClientRegistry = new NetworkClientRegistry();
  #lobbyRegistry = new LobbyRegistry();

  start(port = LobbyServer.DEFAULT_PORT) {
    this.#httpServer = Deno.serve(
      {
        port,
      },
      this.#handleHttpRequest
    );
  }

  async stop() {
    logger.info('Server is stopping.');

    await this.#httpServer?.shutdown();
  }

  #handleHttpRequest: Deno.ServeHandler = (req) => {
    if (req.headers.get('upgrade') === 'websocket') {
      const { socket, response } = Deno.upgradeWebSocket(req);

      socket.addEventListener('open', () => {});

      this.#registerWebSocketMessageHandlers(socket);

      return response;
    }

    // TODO: This makes it so the server doesn't service any other
    // HTTP requests besides an upgrade request. If we add
    // the ability to make HTTP requests down the line
    // (like maybe for seeing all the currently available public
    //  lobbies), this will have to be removed.
    return new Response(undefined, { status: 501 });
  };

  #registerWebSocketMessageHandlers(socket: WebSocket): void {
    socket.addEventListener('open', () => {
      const { id } = this.#networkClientRegistry.register(new NetworkClient(socket));

      logger.info(`A client connected and was registered with the ID ${id}.`);
    });
    socket.addEventListener('close', () => {
      const networkClient = this.#networkClientRegistry.getBy(({ item }) => item.socket === socket);

      if (networkClient) {
        this.#networkClientRegistry.removeById(networkClient.id);

        logger.info(`Client with ID ${networkClient.id} disconnected.`);
      } else {
        logger.warn('Unregistered client disconnected.');
      }
    });

    socket.addEventListener('message', (event) => {
      const { data } = event;

      if (typeof data === 'string') {
        const [method, payload] = data.split(':');

        switch (method) {
          case LobbyClientWsMethod.Ping:
            socket.send(`${LobbyServerWsMethod.Pong}:${LobbyServerWsMethod.Pong}`);
            break;
          default:
            logger.warn(`Received message with unknown method: ${method}`);
            break;
        }
      }
    });
  }
}
