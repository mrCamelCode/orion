import { z } from 'zod';

/**
 * Methods the server sends over the WS connection to the clients.
 *
 * Clients need to have handlers for these methods.
 */
export enum ServerWsMethod {
  /**
   * There was a problem with a websocket message the client sent to the server.
   * This occurs when the error is in the message itself and is akin to a bad
   * request. If you receive this message, your message failed basic validation
   * of the expected shape and/or constraints of the contents of the message.
   * 
   * Not all bad messages result in this message being sent out. In those cases,
   * the server simply ignores the message. See the API documentation for the
   * expected values for messages your client will send.
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
  /**
   * Emitted by the client when they'd like to send a message to other
   * members of the relevant lobby.
   */
  Message = 'lobby_messaging_send',

  /**
   * Emitted by the host of the relevant lobby when they'd like to start
   * the peer-to-peer mediation phase. During this phase, the server
   * attempts to facilitate keeping all clients on the same page as
   * they try to connect directly to one another.
   */
  StartPtpMediation = 'ptpMediation_start',
}

const registeredClientMessagePayloadSchema = z.object({
  token: z.string(),
});

export const wsMessagePayloadSchemaMap = {
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

  [ClientWsMethod.Message]: registeredClientMessagePayloadSchema.merge(
    z.object({
      lobbyId: z.string(),
      message: z.string().min(1).max(250),
    })
  ),
  [ClientWsMethod.StartPtpMediation]: registeredClientMessagePayloadSchema.merge(
    z.object({
      lobbyId: z.string(),
    })
  ),
};

// Convenience for WsMessagePayloadMap type.
const wsMessagePayloadSchemaMapSchema = z.object(wsMessagePayloadSchemaMap);

export type WsMethod = keyof typeof wsMessagePayloadSchemaMap;

export type WsMessagePayloadMap = z.infer<typeof wsMessagePayloadSchemaMapSchema>;

export type OutboundMessage<T extends WsMethod> = (payload: WsMessagePayloadMap[T]) =>
  | {
      method: string;
      payload: any;
    }
  | undefined;
