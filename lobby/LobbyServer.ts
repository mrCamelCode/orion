import { logger } from '../logging/Logger.ts';
import { NetworkClient } from '../network/NetworkClient.ts';
import { NetworkClientRegistry } from '../network/NetworkClientRegistry.ts';
import {
  ClientWsMethod,
  OutboundMessage,
  ServerWsMethod,
  WsMethod,
  wsMessagePayloadSchemaMap,
} from '../network/network.model.ts';
import { decodeWsMessage, encodeWsMessage, getOutboundMessage } from '../network/network.util.ts';
import { Lobby } from './Lobby.ts';
import { LobbyClient } from './LobbyClient.ts';
import { LobbyRegistry } from './LobbyRegistry.ts';

export class LobbyServer {
  public static readonly DEFAULT_PORT = 5980;

  #httpServer: Deno.HttpServer | undefined;
  #networkClientRegistry = new NetworkClientRegistry();
  #lobbyRegistry = new LobbyRegistry();

  start(port = LobbyServer.DEFAULT_PORT) {
    this.#httpServer = Deno.serve(
      {
        port,
        onListen: () => {
          logger.info('Server ready.');
        },
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
      const { id, item: registeredClient } = this.#networkClientRegistry.register(new NetworkClient(socket));

      logger.info(`A client connected and was registered with the ID ${id}.`);

      socket.send(encodeWsMessage(ServerWsMethod.ClientRegistered, { token: registeredClient.token }));
    });
    socket.addEventListener('close', () => {
      const networkClient = this.#networkClientRegistry.getBySocket(socket);

      if (networkClient) {
        this.#networkClientRegistry.removeById(networkClient.id);
        this.#lobbyRegistry.cleanupNetworkClient(networkClient.item);

        logger.info(`Client with ID ${networkClient.id} disconnected.`);
      } else {
        logger.warn('Unregistered client disconnected.');
      }
    });

    socket.addEventListener('message', (event) => {
      const { data } = event;

      if (typeof data === 'string') {
        const [method, payload] = decodeWsMessage(event.data);

        const validationErrors = this.#validateMessage(method, payload);

        if (validationErrors.length > 0) {
          logger.warn(
            `Client ${
              this.#networkClientRegistry.getBySocket(socket)?.id ?? 'UNKNOWN'
            } sent a message that didn't pass validation.`
          );

          socket.send(
            encodeWsMessage(ServerWsMethod.MessageError, {
              method: method,
              errors: validationErrors,
            })
          );
        } else {
          const handler = this.#handlerMapping[method as ClientWsMethod] as OutboundMessage<any> | undefined;

          const { method: outgoingMethod, payload: outgoingPayload } = handler?.(payload) ?? {};

          if (outgoingMethod && outgoingPayload) {
            socket.send(encodeWsMessage(outgoingMethod as WsMethod, outgoingPayload));
          }
        }
      }
    });
  }

  #handleCreateLobby: OutboundMessage<ClientWsMethod.CreateLobby> = (payload) => {
    const { lobbyName, hostName, token } = payload;

    const { item: networkClient } = this.#networkClientRegistry.getByToken(token) ?? {};
    if (networkClient) {
      if (this.#lobbyRegistry.isNetworkClientInLobby(networkClient)) {
        return getOutboundMessage(ServerWsMethod.CreateLobbyFailure, {
          errors: [`The client is already in a lobby and cannot be the host of a new lobby.`],
        });
      } else {
        const hostLobbyClient = new LobbyClient(hostName, networkClient);

        const { item: newLobby, id: newLobbyId } = this.#lobbyRegistry.register(new Lobby(lobbyName, hostLobbyClient));

        return getOutboundMessage(ServerWsMethod.CreateLobbySuccess, {
          lobbyName: newLobby.name,
          lobbyId: newLobbyId,
        });
      }
    }
  };

  #validateMessage(method: string, payload: any): string[] {
    const errors = [];

    if (!Object.keys(this.#handlerMapping).includes(method as ClientWsMethod)) {
      errors.push(`The method ${method} is unrecognized.`);
    }

    const { error } = wsMessagePayloadSchemaMap[method as WsMethod]?.safeParse(payload) ?? {};
    if (error) {
      errors.push(
        ...[`The message payload was malformed.`, ...error.issues.map((issue) => `${issue.path}: ${issue.message}`)]
      );
    }

    if (payload.token && !this.#networkClientRegistry.getByToken(payload.token)) {
      errors.push(`Invalid token.`);
    }

    return errors;
  }

  readonly #handlerMapping: Record<ClientWsMethod, OutboundMessage<any>> = {
    [ClientWsMethod.Ping]: () => ({
      method: ServerWsMethod.Pong,
      payload: {},
    }),
    [ClientWsMethod.CreateLobby]: this.#handleCreateLobby,
    [ClientWsMethod.JoinLobby]: () => {
      throw new Error('TODO');
    },
    [ClientWsMethod.LeaveLobby]: () => {
      throw new Error('TODO');
    },
  };
}
