import { LobbyClient } from './LobbyClient.ts';

export class Lobby {
  constructor(public readonly name: string, public readonly host: LobbyClient) {}
}
