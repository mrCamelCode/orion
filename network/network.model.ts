import { z } from 'zod';

/**
 * Methods the server sends over the WS connection to the clients.
 *
 * Clients need to have handlers for these methods.
 */
export enum ServerWsMethod {
  Pong = 'pong',
  /**
   * There was a problem with a message the client sent to the server.
   */
  MessageError = 'message_error',
  /**
   * Emitted by the server after the client successfully connects to the
   * server. This message is accompanied with the token the client needs
   * to send on future messages. The token identifies the user and should
   * be treated as a secret. The client cannot send valid messages without
   * a proper token.
   */
  ClientRegistered = 'client_registered',
  CreateLobbySuccess = 'lobby_create_success',
  CreateLobbyFailure = 'lobby_create_failure',
  /**
   * Emitted when a lobby is closed. A lobby could be closed because the host
   * leaves or disconnects unexpectedly.
   */
  LobbyClosed = 'lobby_closed',
  /**
   * Emitted when a request to leave a lobby succeeds.
   */
  LeaveLobbySuccess = 'lobby_leave_success',
  /**
   * Emitted to others in a lobby when a new member joins it.
   */
  PeerConnected = 'lobby_peerConnect',
  /**
   * Emitted to other when a member of a lobby leaves the lobby.
   */
  PeerDisconnected = 'lobby_peerDisconnect',
}

/**
 * Methods the clients send over the WS connection to the server.
 *
 * The server needs to have handlers for these methods.
 */
export enum ClientWsMethod {
  Ping = 'ping',
  CreateLobby = 'lobby_create',
  LeaveLobby = 'lobby_leave',
  JoinLobby = 'lobby_join',
}

const registeredClientMessagePayloadSchema = z.object({
  token: z.string(),
});

const nameRegex = /^\w+[\w ]*$/i;

const empty = z.object({});
export const wsMessagePayloadSchemaMap = {
  [ServerWsMethod.Pong]: empty,
  [ServerWsMethod.MessageError]: z.object({
    method: z.string(),
    errors: z.array(z.string()),
  }),
  [ServerWsMethod.ClientRegistered]: z.object({
    token: z.string(),
  }),
  [ServerWsMethod.CreateLobbySuccess]: z.object({
    lobbyName: z.string(),
    /**
     * This ID can be used by other clients to join the lobby.
     * It should be considered protected information; only those
     * with permission to join the lobby should know it.
     */
    lobbyId: z.string(),
  }),
  [ServerWsMethod.CreateLobbyFailure]: z.object({
    errors: z.array(z.string()),
  }),
  [ServerWsMethod.LobbyClosed]: z.object({
    lobbyId: z.string(),
    lobbyName: z.string(),
  }),
  [ServerWsMethod.PeerConnected]: z.object({
    peerName: z.string(),
  }),
  [ServerWsMethod.PeerDisconnected]: z.object({
    peerName: z.string(),
  }),

  [ClientWsMethod.Ping]: empty,
  [ClientWsMethod.CreateLobby]: registeredClientMessagePayloadSchema.merge(
    z.object({
      hostName: z.string().max(50).regex(nameRegex, 'Host name cannot be only spaces and must be alphanumeric.'),
      lobbyName: z.string().max(50).regex(nameRegex, 'Lobby name cannot be only spaces and must be alphanumeric.'),
    })
  ),
  [ClientWsMethod.LeaveLobby]: registeredClientMessagePayloadSchema.merge(
    z.object({
      lobbyId: z.string(),
    })
  ),
};

// Convenience for WsMessagePayloadMap type.
const wsMessagepayloadSchemaMapSchema = z.object(wsMessagePayloadSchemaMap);

export type WsMessagePayloadMap = z.infer<typeof wsMessagepayloadSchemaMapSchema>;

export type WsMethod = keyof typeof wsMessagePayloadSchemaMap;

export type OutboundMessage<T extends WsMethod> = (payload: WsMessagePayloadMap[T]) =>
  | {
      method: string;
      payload: any;
    }
  | undefined;
