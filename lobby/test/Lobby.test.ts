import { assert, assertFalse } from 'assert';
import { describe, test } from 'bdd';
import { NetworkClient } from '../../network/NetworkClient.ts';
import { Lobby } from '../Lobby.ts';
import { LobbyClient } from '../LobbyClient.ts';

describe('Lobby', () => {
  describe('isHost', () => {
    test(`true for the host`, () => {
      const host = new LobbyClient('host guy', new NetworkClient(new WebSocket('ws://localhost:3000')));

      const lobby = new Lobby('test', host, 5);

      assert(lobby.isHost(host));
    });
    test(`false for non-host`, () => {
      const host = new LobbyClient('host guy', new NetworkClient(new WebSocket('ws://localhost:3000')));
      const peer = new LobbyClient('not host guy', new NetworkClient(new WebSocket('ws://localhost:3000')));

      const lobby = new Lobby('test', host, 5);
      lobby.addMember(peer);

      assertFalse(lobby.isHost(peer));
    });
    test(`false for someone that's not a member`, () => {
      const host = new LobbyClient('host guy', new NetworkClient(new WebSocket('ws://localhost:3000')));
      const peer = new LobbyClient('not host guy', new NetworkClient(new WebSocket('ws://localhost:3000')));

      const lobby = new Lobby('test', host, 5);

      assertFalse(lobby.isHost(peer));
    });
  });
});
