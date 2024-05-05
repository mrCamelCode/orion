import { assertEquals } from 'assert';
import { afterAll, beforeAll, describe, test } from 'bdd';
import { restore } from 'mock';
import { stubLogger } from '../../util/testing.util.ts';
import { LobbyServer } from '../LobbyServer.ts';
import { LobbyClientWsMethod, LobbyServerWsMethod } from '../lobby.model.ts';

const WS_PORT = 3000;

const server = new LobbyServer();

// Given that I actually start the server and create a client,
// this is more like an integration test, which isn't ideal.
// But I'd rather have the behaviour automatically tested than
// leaving it untested just because I don't want to set up a full
// and proper end-to-end testing environment.
describe('LobbyServer', () => {
  let client: WebSocket;

  beforeAll(async () => {
    stubLogger();

    server.start(WS_PORT);

    client = await createClient(`ws://localhost:${WS_PORT}`);
  });
  afterAll(async () => {
    client.close();
    await server.stop();
    restore();
  });

  describe('ping', () => {
    test('returns pong', async () => {
      const messageWaiter = waitForMessage(client, LobbyServerWsMethod.Pong);

      client.send(LobbyClientWsMethod.Ping);

      const response = await messageWaiter;

      assertEquals(response, LobbyServerWsMethod.Pong);
    });
  });
});

function createClient(url: string): Promise<WebSocket> {
  return new Promise((resolve) => {
    const newClient = new WebSocket(url);

    newClient.addEventListener('open', () => {
      resolve(newClient);
    });
  });
}

function waitForMessage(socket: WebSocket, method: LobbyClientWsMethod | LobbyServerWsMethod): Promise<string> {
  return new Promise((resolve) => {
    socket.addEventListener('message', (event) => {
      const [receivedMethod, payload] = (event.data as string).split(':');

      if (receivedMethod === method) {
        resolve(payload);
      }
    });
  });
}
