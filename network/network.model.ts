import { z } from 'zod';

/**
 * Methods the server sends over the WS connection to the clients.
 *
 * Clients need to have handlers for these methods.
 */
export enum ServerWsMethod {
  Pong = 'pong',
  /**
   * There was a problem with a websocket message the client sent to the server.
   */
  WsMessageError = 'wsMessage_error',

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

  JoinLobbySuccess = 'lobby_join_success',
  JoinLobbyFailure = 'lobby_join_failure',

  /**
   * Emitted when a lobby is closed. A lobby could be closed because the host
   * leaves. When a lobby closes, it's destroyed and all its members are kicked
   * out.
   */
  LobbyClosed = 'lobby_closed',

  /**
   * Emitted to others in a lobby when a new member joins it.
   */
  PeerConnected = 'lobby_peerConnect',
  /**
   * Emitted to other when a member of a lobby leaves the lobby.
   */
  PeerDisconnected = 'lobby_peerDisconnect',

  /**
   * Emitted by the server when it's received a message from a member
   * of the relevant lobby. The message will be emitted to ALL members,
   * including the sender.
   */
  MessageReceived = 'lobby_messaging_received',
}

/**
 * Methods the clients send over the WS connection to the server.
 *
 * The server needs to have handlers for these methods.
 */
export enum ClientWsMethod {
  Ping = 'ping',
  CreateLobby = 'lobby_create',
  JoinLobby = 'lobby_join',
  /**
   * Emitted by the client when they'd like to send a message to other
   * members of the relevant lobby.
   */
  Message = 'lobby_messaging_send',
}

const registeredClientMessagePayloadSchema = z.object({
  token: z.string(),
});

const nameRegex = /^\w+[\w ]*$/i;

const empty = z.object({});
export const wsMessagePayloadSchemaMap = {
  [ServerWsMethod.Pong]: empty,
  [ServerWsMethod.WsMessageError]: z.object({
    /**
     * The method the client tried to perform that failed the
     * server's validation.
     */
    method: z.string(),
    /**
     * Why the message is problematic. These errors are produced
     * as the result of fairly generic tests against the message
     * itself, which is something the end-user wouldn't necessarily
     * know about. It's likely best to not show these errors to the
     * end-user.
     */
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
    /**
     * The reasons why the client couldn't create the lobby.
     * These are intended to be readable and can be displayed
     * to the user.
     */
    errors: z.array(z.string()),
  }),

  [ServerWsMethod.JoinLobbySuccess]: z.object({
    lobbyName: z.string(),
    lobbyId: z.string(),
    /**
     * The names of the other members of the lobby.
     */
    lobbyMembers: z.array(z.string()),
  }),
  [ServerWsMethod.JoinLobbyFailure]: z.object({
    /**
     * The ID of the lobby the client attempted to join.
     */
    lobbyId: z.string(),
    /**
     * The reasons why the client couldn't join the lobby.
     * These are intended to be readable and can be displayed
     * to the user.
     */
    errors: z.array(z.string()),
  }),

  [ServerWsMethod.LobbyClosed]: z.object({
    lobbyId: z.string(),
    lobbyName: z.string(),
  }),
  [ServerWsMethod.PeerConnected]: z.object({
    lobbyId: z.string(),
    peerName: z.string(),
  }),
  [ServerWsMethod.PeerDisconnected]: z.object({
    lobbyId: z.string(),
    peerName: z.string(),
  }),
  [ServerWsMethod.MessageReceived]: z.object({
    lobbyId: z.string(),
    message: z.object({
      timestamp: z.number(),
      senderName: z.string(),
      message: z.string(),
    }),
  }),

  [ClientWsMethod.Ping]: empty,
  [ClientWsMethod.CreateLobby]: registeredClientMessagePayloadSchema.merge(
    z.object({
      hostName: z.string().max(50).regex(nameRegex, 'Host name cannot be only spaces and must be alphanumeric.'),
      lobbyName: z.string().max(50).regex(nameRegex, 'Lobby name cannot be only spaces and must be alphanumeric.'),
      isPublic: z.boolean(),
      maxMembers: z.number().min(1).max(64),
    })
  ),
  [ClientWsMethod.JoinLobby]: registeredClientMessagePayloadSchema.merge(
    z.object({
      lobbyId: z.string(),
      peerName: z.string().max(50).regex(nameRegex, 'Peer name cannot be only spaces and must be alphanumeric.'),
    })
  ),
  [ClientWsMethod.Message]: registeredClientMessagePayloadSchema.merge(
    z.object({
      lobbyId: z.string(),
      message: z.string().min(1).max(250),
    })
  ),
};

// Convenience for WsMessagePayloadMap type.
const wsMessagepayloadSchemaMapSchema = z.object(wsMessagePayloadSchemaMap);

export type WsMethod = keyof typeof wsMessagePayloadSchemaMap;

export type WsMessagePayloadMap = z.infer<typeof wsMessagepayloadSchemaMapSchema>;

export type OutboundMessage<T extends WsMethod> = (payload: WsMessagePayloadMap[T]) =>
  | {
      method: string;
      payload: any;
    }
  | undefined;
