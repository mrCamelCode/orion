import { Client } from '../client/Client.ts';
import { LobbyCode } from './lobby.model.ts';

export class Lobby {
  constructor(public readonly name: string, public readonly host: Client, public readonly code: LobbyCode) {}
}
