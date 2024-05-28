import { Middleware } from 'potami';
import { logger } from '../../../logging/Logger.ts';
import { NetworkClient } from '../../../network/NetworkClient.ts';
import { NetworkClientRegistry } from '../../../network/NetworkClientRegistry.ts';
import {
  ClientWsMethod,
  OutboundMessage,
  ServerWsMethod,
  WsMessagePayloadMap,
  WsMethod,
  wsMessagePayloadSchemaMap,
} from '../../../network/network.model.ts';
import { decodePacket, encodeWsPacket, sendToSockets } from '../../../network/network.util.ts';
import { LobbyRegistry } from '../../LobbyRegistry.ts';

type HandlerMap = Record<ClientWsMethod, OutboundMessage<any>>;

export const handleWebSocketUpgrade =
  (networkClientRegistry: NetworkClientRegistry, lobbyRegistry: LobbyRegistry): Middleware =>
  ({ req }) => {
    if (req.headers.get('upgrade') === 'websocket') {
      const { socket, response } = Deno.upgradeWebSocket(req);

      registerWebSocketMessageHandlers(socket, networkClientRegistry, lobbyRegistry);

      return response;
    }
  };

function registerWebSocketMessageHandlers(
  socket: WebSocket,
  networkClientRegistry: NetworkClientRegistry,
  lobbyRegistry: LobbyRegistry
): void {
  const handlerMapping: HandlerMap = {
    [ClientWsMethod.Message]: handleLobbyMessage(networkClientRegistry, lobbyRegistry),
    [ClientWsMethod.ConnectedToPeers]: handleConnectedToPeers(networkClientRegistry, lobbyRegistry),
  };

  socket.addEventListener('open', () => {
    const { id, item: registeredClient } = networkClientRegistry.register(new NetworkClient(socket));

    logger.info(`A client connected and was registered with the ID ${id}.`);

    sendToSockets(encodeWsPacket(ServerWsMethod.ClientRegistered, { token: registeredClient.token }), socket);
  });
  socket.addEventListener('close', () => {
    const networkClient = networkClientRegistry.getBySocket(socket);

    if (networkClient) {
      networkClientRegistry.removeById(networkClient.id);
      lobbyRegistry.cleanupNetworkClient(networkClient.item);

      logger.info(`Client with ID ${networkClient.id} disconnected.`);
    } else {
      logger.warn('Unregistered client disconnected.');
    }
  });

  socket.addEventListener('message', (event) => {
    const { data } = event;

    const requestingClient = networkClientRegistry.getBySocket(socket);

    if (typeof data === 'string') {
      try {
        const [method, payload] = decodePacket(event.data);

        const validationErrors = validateMessage(method, payload, handlerMapping, networkClientRegistry);

        if (validationErrors.length > 0) {
          logger.warn(`Client ${requestingClient?.id ?? 'UNKNOWN'} sent a message that didn't pass validation.`);
        } else {
          const handler = handlerMapping[method as ClientWsMethod] as OutboundMessage<any> | undefined;

          const { method: outgoingMethod, payload: outgoingPayload } = handler?.(payload) ?? {};

          if (outgoingMethod && outgoingPayload) {
            sendToSockets(encodeWsPacket(outgoingMethod as WsMethod, outgoingPayload), socket);
          }
        }
      } catch (error) {
        logger.warn(`Client ${requestingClient?.id ?? 'UNKNOWN'} sent a message that threw an unforeseen error.`);
      }
    }
  });
}

function validateMessage(
  method: string,
  payload: any,
  handlerMapping: HandlerMap,
  networkClientRegistry: NetworkClientRegistry
): string[] {
  const errors = [];

  if (!Object.keys(handlerMapping).includes(method as ClientWsMethod)) {
    errors.push(`The method ${method} is unrecognized.`);
  }

  const { error } = wsMessagePayloadSchemaMap[method as WsMethod]?.safeParse(payload) ?? {};
  if (error) {
    errors.push(
      ...[`The message payload was malformed.`, ...error.issues.map((issue) => `${issue.path}: ${issue.message}`)]
    );
  }

  if (payload.token && !networkClientRegistry.getByToken(payload.token)) {
    errors.push(`Invalid token.`);
  }

  return errors;
}

const handleLobbyMessage =
  (
    networkClientRegistry: NetworkClientRegistry,
    lobbyRegistry: LobbyRegistry
  ): OutboundMessage<ClientWsMethod.Message> =>
  (payload) => {
    const { lobbyId, message, token } = payload;

    const { item: networkClient, id: networkClientId } = networkClientRegistry.getByToken(token) ?? {};
    if (networkClient) {
      const { item: lobby } = lobbyRegistry.getById(lobbyId) ?? {};

      if (lobby) {
        const lobbyClient = lobbyRegistry.getLobbyClientFromNetworkClient(networkClient);

        if (lobbyClient) {
          if (lobby.isMember(lobbyClient)) {
            sendToSockets(
              encodeWsPacket(ServerWsMethod.MessageReceived, {
                lobbyId,
                message: {
                  timestamp: Date.now(),
                  message,
                  senderName: lobbyClient.name,
                },
              }),
              ...lobby.members.map((member) => member.networkClient.socket)
            );
          } else {
            logger.warn(
              `Client ${networkClientId} attempted to send message to lobby ${lobbyId}, but they're not a member of that lobby.`
            );
          }
        } else {
          logger.warn(
            `Client ${networkClientId} attempted to send a message to lobby ${lobbyId}, but they're not in a lobby.`
          );
        }
      } else {
        logger.warn(`Client ${networkClientId} attempted to send a message to non-existent lobby ${lobbyId}.`);
      }
    } else {
      logger.warn(`Unregistered client attempted to send message to lobby ${lobbyId}.`);
    }

    return undefined;
  };

const handleConnectedToPeers =
  (networkClientRegistry: NetworkClientRegistry, lobbyRegistry: LobbyRegistry) =>
  (payload: WsMessagePayloadMap[ClientWsMethod.ConnectedToPeers]) => {
    const { token } = payload;

    const { item: networkClient, id: networkClientId } = networkClientRegistry.getByToken(token) ?? {};

    if (networkClient) {
      const lobby = lobbyRegistry.getLobbyFromNetworkClient(networkClient);

      if (lobby) {
        if (lobby.isUndergoingPtpMediation) {
          lobbyRegistry.handlePtpMediationPeerConnectSuccess(networkClient);

          return undefined;
        } else {
          logger.warn(
            `Client ${networkClientId} attempted to indicate peer connection success, but the lobby is not undergoing PTP Mediation.`
          );
        }
      } else {
        logger.warn(
          `Client ${networkClientId} attempted to indicate peer connection success, but they're not in a lobby.`
        );
      }
    } else {
      logger.warn(`Unregistered client attempted to indicate peer connection success.`);
    }
  };
