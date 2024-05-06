import { IdToken } from "../shared/model.ts";
import { EmptyObject } from '../types/types.ts';

/**
 * Methods the server sends over the WS connection to the clients.
 *
 * Clients need to have handlers for these methods.
 */
export enum ServerWsMethod {
  Pong = 'pong',
  /**
   * Emitted by the server after the client successfully connects to the
   * server. This message is accompanied with the token the client needs
   * to send on future messages. The token identifies the user and should
   * be treated as a secret. The client cannot send valid messages without
   * a proper token.
   */
  ClientRegistered = 'client_registered',
  CreateSuccess = 'lobby_create_success',
  ClientJoined = 'lobby_clientJoined',
  ClientLeft = 'lobby_clientLeft',
  HostLeft = 'lobby_hostLeft',
  Started = 'lobby_started',
  Closed = 'lobby_closed',
}

/**
 * Methods the clients send over the WS connection to the server.
 *
 * The server needs to have handlers for these methods.
 */
export enum ClientWsMethod {
  Ping = 'ping',
  Create = 'lobby_create',
  Join = 'lobby_join',
  Leave = 'lobby_leave',
  Start = 'lobby_start',
  Close = 'lobby_close',
}

export interface WsMessagePayload {
  [ServerWsMethod.Pong]: EmptyObject;
  [ServerWsMethod.ClientRegistered]: {
    token: IdToken;
  };
}

export type WsMethod = keyof WsMessagePayload;
