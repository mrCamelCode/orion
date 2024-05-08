import { assertEquals, assertExists } from 'assert';
import { beforeEach, describe, test } from 'bdd';
import { stub } from 'mock';
import { NetworkClient } from '../../network/NetworkClient.ts';
import { Lobby } from '../Lobby.ts';
import { LobbyClient } from '../LobbyClient.ts';
import { LobbyRegistry } from '../LobbyRegistry.ts';

describe('LobbyRegistry', () => {
  let registry: LobbyRegistry;
  beforeEach(() => {
    registry = new LobbyRegistry();
  });

  describe('getLobbyClientFromNetworkClient', () => {
    test(`returns the lobby client when it's the only available client`, () => {
      const host = makeLobbyClient();

      registry.register(new Lobby('Test Lobby', host, 3, true));

      assertEquals(registry.getLobbyClientFromNetworkClient(host.networkClient), host);
    });
    test(`returns the lobby client when it's one of several available clients`, () => {
      const host = makeLobbyClient();

      new Array(10).fill(0).forEach(() => registry.register(new Lobby('Test Lobby', makeLobbyClient(), 100, true)));
      registry.register(new Lobby('Test Lobby', host, 3, true));

      assertEquals(registry.getLobbyClientFromNetworkClient(host.networkClient), host);
    });
    test(`returns the lobby client when they're not the host`, () => {
      const host = makeLobbyClient();
      const client = makeLobbyClient();

      const { id: lobbyId } = registry.register(new Lobby('Test Lobby', host, 3, true));
      registry.addMemberToLobby(lobbyId, client);

      assertEquals(registry.getLobbyClientFromNetworkClient(client.networkClient), client);
    });
    test(`returns undefined when there are no lobby clients`, () => {
      assertEquals(
        registry.getLobbyClientFromNetworkClient(new NetworkClient(new WebSocket('ws://localhost'))),
        undefined
      );
    });
    test(`returns undefined when there's no match among available lobby clients`, () => {
      const client = makeLobbyClient();

      new Array(10).fill(0).forEach(() => registry.register(new Lobby('Test Lobby', makeLobbyClient(), 100, true)));

      assertEquals(registry.getLobbyClientFromNetworkClient(client.networkClient), undefined);
    });
  });

  describe('removal', () => {
    test('removing a lobby removes it from the registry', () => {
      const host = makeLobbyClient();

      const { id } = registry.register(new Lobby('Test Lobby', host, 3, true));

      assertEquals(registry.registeredItems.length, 1);

      registry.removeById(id);

      assertEquals(registry.registeredItems.length, 0);
    });
    test('removing a lobby disassociates all the clients that were in it', () => {
      const host = makeLobbyClient();
      const networkClient = host.networkClient;
      const { id } = registry.register(new Lobby('Test Lobby', host, 20, true));

      const networkClients: NetworkClient[] = new Array(10).fill(0).map(() => {
        const client = makeLobbyClient();

        registry.addMemberToLobby(id, client);

        return client.networkClient;
      });

      assertEquals(registry.getLobbyClientFromNetworkClient(networkClient), host);

      registry.removeById(id);

      [host.networkClient, ...networkClients].forEach((client) => {
        assertEquals(registry.getLobbyClientFromNetworkClient(client), undefined);
      });

      assertEquals(registry.getById(id), undefined);
    });
  });
  describe('cleanupNetworkClient', () => {
    test(`does nothing when the network client isn't in a lobby`, () => {
      const host = makeLobbyClient();

      new Array(10).fill(0).forEach(() => registry.register(new Lobby('Test Lobby', makeLobbyClient(), 100, true)));

      assertEquals(registry.registeredItems.length, 10);

      registry.cleanupNetworkClient(host.networkClient);

      assertEquals(registry.registeredItems.length, 10);
    });
    test(`removes the client from the lobby when they're a peer`, () => {
      const host = makeLobbyClient();
      const client = makeLobbyClient();

      const { item: lobby, id: lobbyId } = registry.register(new Lobby('Test Lobby', host, 3, true));
      registry.addMemberToLobby(lobbyId, client);

      assertEquals(lobby.numMembers, 2);

      registry.cleanupNetworkClient(client.networkClient);

      assertEquals(lobby.numMembers, 1);
      assertExists(registry.getById(lobbyId));
    });
    test(`removes the lobby completely when the client was the host`, () => {
      const host = makeLobbyClient();
      const { id } = registry.register(new Lobby('Test Lobby', host, 20, true));

      const networkClients: NetworkClient[] = new Array(10).fill(0).map(() => {
        const client = makeLobbyClient();

        registry.addMemberToLobby(id, client);

        return client.networkClient;
      });

      assertEquals(registry.getLobbyClientFromNetworkClient(host.networkClient), host);

      registry.cleanupNetworkClient(host.networkClient);

      [host.networkClient, ...networkClients].forEach((client) => {
        assertEquals(registry.getLobbyClientFromNetworkClient(client), undefined);
      });

      assertEquals(registry.getById(id), undefined);
    });
  });
});

function makeLobbyClient(): LobbyClient {
  const networkClient = new NetworkClient(new WebSocket('ws://localhost'));
  stub(networkClient.socket, 'send');

  return new LobbyClient('Host Client', networkClient);
}
