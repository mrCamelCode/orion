import { NetworkClient } from '../network/NetworkClient.ts';

export class LobbyClient {
  constructor(public readonly name: string, public readonly networkClient: NetworkClient) {}
}
