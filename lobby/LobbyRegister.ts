import { Lobby } from './Lobby.ts';
import { LobbyCode } from './lobby.model.ts';

export class LobbyRegister {
  #lobbies: Record<LobbyCode, Lobby> = {};

  constructor() {}

  registerLobby(): void {
    throw new Error('TODO');
  }

  #getNextCode(): string {
    throw new Error('TODO');
  }
}
