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
import { decodeWsMessage, encodeWsMessage, getOutboundMessage, sendToSockets } from '../network/network.util.ts';
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

      this.#registerWebSocketMessageHandlers(socket);

      return response;
    }

    // TODO: Routing could definitely be done in a more robust and scalable way
    // if more endpoints are added down the line.
    const [requiredApiPrefix, controller] = new URL(req.url).pathname.split('/').filter(Boolean);

    if (requiredApiPrefix === 'api') {
      switch (controller) {
        case 'ping':
          return new Response(JSON.stringify('pong'));
        case 'lobbies':
          return new Response(
            JSON.stringify({
              lobbies: this.#lobbyRegistry.registeredItems
                .filter((registeredLobby) => registeredLobby.item.isPublic)
                .map(({ item: lobby, id }) => {
                  return {
                    name: lobby.name,
                    id,
                    currentMembers: lobby.numMembers,
                    maxMembers: lobby.maxMembers,
                  };
                }),
            })
          );
      }
    }

    return new Response(new TextEncoder().encode(`<p>You look like you're lost</p>`));
  };

  #registerWebSocketMessageHandlers(socket: WebSocket): void {
    socket.addEventListener('open', () => {
      const { id, item: registeredClient } = this.#networkClientRegistry.register(new NetworkClient(socket));

      logger.info(`A client connected and was registered with the ID ${id}.`);

      sendToSockets(encodeWsMessage(ServerWsMethod.ClientRegistered, { token: registeredClient.token }), socket);
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

      const requestingClient = this.#networkClientRegistry.getBySocket(socket);

      if (typeof data === 'string') {
        try {
          const [method, payload] = decodeWsMessage(event.data);

          const validationErrors = this.#validateMessage(method, payload);

          if (validationErrors.length > 0) {
            logger.warn(`Client ${requestingClient?.id ?? 'UNKNOWN'} sent a message that didn't pass validation.`);

            sendToSockets(
              encodeWsMessage(ServerWsMethod.MessageError, {
                method: method,
                errors: validationErrors,
              }),
              socket
            );
          } else {
            const handler = this.#handlerMapping[method as ClientWsMethod] as OutboundMessage<any> | undefined;

            const { method: outgoingMethod, payload: outgoingPayload } = handler?.(payload) ?? {};

            if (outgoingMethod && outgoingPayload) {
              sendToSockets(encodeWsMessage(outgoingMethod as WsMethod, outgoingPayload), socket);
            }
          }
        } catch (error) {
          logger.warn(`Client ${requestingClient?.id ?? 'UNKNOWN'} sent a message that threw an unforeseen error.`);
        }
      }
    });
  }

  #handleCreateLobby: OutboundMessage<ClientWsMethod.CreateLobby> = (payload) => {
    const { lobbyName, hostName, token, isPublic, maxMembers } = payload;

    const { item: networkClient, id: networkClientId } = this.#networkClientRegistry.getByToken(token) ?? {};
    if (networkClient) {
      if (this.#lobbyRegistry.isNetworkClientInLobby(networkClient)) {
        return getOutboundMessage(ServerWsMethod.CreateLobbyFailure, {
          errors: [`The client is already in a lobby and cannot be the host of a new lobby.`],
        });
      } else {
        const hostLobbyClient = new LobbyClient(hostName, networkClient);

        const { item: newLobby, id: newLobbyId } = this.#lobbyRegistry.register(
          new Lobby(lobbyName, hostLobbyClient, maxMembers, isPublic)
        );

        logger.info(`Client ${networkClientId} is now the host of a new lobby with ID ${newLobbyId}`);

        return getOutboundMessage(ServerWsMethod.CreateLobbySuccess, {
          lobbyName: newLobby.name,
          lobbyId: newLobbyId,
        });
      }
    } else {
      logger.warn('Unregistered client attempted to host a lobby.');

      getOutboundMessage(ServerWsMethod.CreateLobbyFailure, {
        errors: [`The client is unregistered. Try reconnecting.`],
      });
    }
  };

  #handleJoinLobby: OutboundMessage<ClientWsMethod.JoinLobby> = (payload) => {
    const { lobbyId, peerName, token } = payload;

    const { item: networkClient, id: networkClientId } = this.#networkClientRegistry.getByToken(token) ?? {};
    if (networkClient) {
      if (this.#lobbyRegistry.isNetworkClientInLobby(networkClient)) {
        return getOutboundMessage(ServerWsMethod.JoinLobbyFailure, {
          lobbyId,
          errors: [`The client is already in a lobby and cannot join another.`],
        });
      } else {
        const { item: lobby } = this.#lobbyRegistry.getById(lobbyId) ?? {};

        if (lobby) {
          if (!lobby.isFull) {
            const peerLobbyClient = new LobbyClient(peerName, networkClient);

            const addSucceeded = this.#lobbyRegistry.addMemberToLobby(lobbyId, peerLobbyClient);

            if (addSucceeded) {
              logger.info(`Client ${networkClientId} successfully joined lobby ${lobbyId}`);
            }

            return addSucceeded
              ? getOutboundMessage(ServerWsMethod.JoinLobbySuccess, {
                  lobbyId,
                  lobbyName: lobby.name,
                  lobbyMembers: lobby.members.map((member) => member.name),
                })
              : getOutboundMessage(ServerWsMethod.JoinLobbyFailure, {
                  lobbyId,
                  errors: [`The lobby is full or the client is already in the lobby.`],
                });
          } else {
            return getOutboundMessage(ServerWsMethod.JoinLobbyFailure, {
              lobbyId,
              errors: [`The lobby is full.`],
            });
          }
        } else {
          logger.info(`Client ${networkClientId} attempted to join a non-existent lobby.`);

          return getOutboundMessage(ServerWsMethod.JoinLobbyFailure, {
            lobbyId,
            errors: [`Lobby ${lobbyId} doesn't exist.`],
          });
        }
      }
    } else {
      logger.warn('Unregistered client attempted to join a lobby.');

      getOutboundMessage(ServerWsMethod.JoinLobbyFailure, {
        lobbyId,
        errors: [`The client is unregistered. Try reconnecting.`],
      });
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
    [ClientWsMethod.JoinLobby]: this.#handleJoinLobby,
    [ClientWsMethod.LeaveLobby]: () => {
      throw new Error('TODO');
    },
  };
}
