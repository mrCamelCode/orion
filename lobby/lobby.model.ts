export type LobbyCode = string;

/**
 * Methods the server sends over the WS connection to the clients.
 *
 * Clients need to have handlers for these methods.
 */
export enum LobbyServerWsMethod {
  Pong = 'pong',
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
export enum LobbyClientWsMethod {
  Ping = 'ping',
  Create = 'lobby_create',
  Join = 'lobby_join',
  Leave = 'lobby_leave',
  Start = 'lobby_start',
  Close = 'lobby_close',
}

interface LobbyMessagePayloadMapping {
  [LobbyClientWsMethod.Create]: {
    test: string;
  };
}
