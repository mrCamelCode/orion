import { assertThrows } from 'assert';
import { describe, test } from 'bdd';
import { NetworkClient } from '../../../../../network/NetworkClient.ts';
import { Lobby } from '../../../../Lobby.ts';
import { LobbyClient } from '../../../../LobbyClient.ts';
import { LobbyRegistry } from '../../../../LobbyRegistry.ts';
import { LobbiesService } from '../lobbies.service.ts';

describe('LobbiesService', () => {
  describe('joinLobby', () => {
    test(`throws when the lobby is locked`, () => {
      const lobbyRegistry = new LobbyRegistry();

      const service = new LobbiesService(lobbyRegistry);

      const lobby = new Lobby(
        'test',
        new LobbyClient('test client', new NetworkClient(new WebSocket('ws://localhost:3000'))),
        2
      );
      lobby.lock();

      const { id } = lobbyRegistry.register(lobby);

      assertThrows(
        () => service.joinLobby(new NetworkClient(new WebSocket('ws://localhost:3000')), id, 'peer'),
        'The lobby is locked.'
      );
    });
  });

  describe('startPtpMediation', () => {
    test(`throws when the lobby is locked`, () => {
      const lobbyRegistry = new LobbyRegistry();

      const service = new LobbiesService(lobbyRegistry);

      const lobby = new Lobby(
        'test',
        new LobbyClient('test client', new NetworkClient(new WebSocket('ws://localhost:3000'))),
        2
      );
      lobby.lock();

      const { id } = lobbyRegistry.register(lobby);

      assertThrows(
        () => service.startPtpMediation(new NetworkClient(new WebSocket('ws://localhost:3000')), id),
        'The lobby is locked.'
      );
    });
  });
});
