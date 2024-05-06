import { assertEquals } from 'assert';
import { afterAll, beforeAll, describe, test } from 'bdd';
import { restore } from 'mock';
import { decodeWsMessage } from '../../network/network.util.ts';
import { waitFor } from '../../util/util.ts';
import { LobbyServer } from '../LobbyServer.ts';
import { ClientWsMethod, ServerWsMethod, WsMessagePayload, WsMethod } from '../lobby.model.ts';

const WS_PORT = 3000;
const WS_CONNECTION_URL = `ws://localhost:${WS_PORT}`;

const server = new LobbyServer();

// Given that I actually start the server and create a client,
// this is more like an integration test, which isn't ideal.
// But I'd rather have the behaviour automatically tested than
// leaving it untested just because I don't want to set up a full
// and proper end-to-end testing environment.
describe('LobbyServer', () => {
  let client: WebSocket;

  beforeAll(async () => {
    // stubLogger();

    server.start(WS_PORT);

    client = await createClient(WS_CONNECTION_URL);
  });
  afterAll(async () => {
    client.close();
    await server.stop();
    restore();
  });

  // TODO: Need to add tests that verify that the server can gracefully handle
  // being given a malformed message.

  describe('ping', () => {
    test('returns pong', async () => {
      const messageWaiter = waitForMessage(client, ServerWsMethod.Pong);

      client.send(ClientWsMethod.Ping);

      const [method, payload] = await messageWaiter;

      assertEquals(method, ServerWsMethod.Pong);
      assertEquals(payload, {});
    });
  });

  describe('connection', () => {
    test('server responds with registration success indication and token on successful connection', async () => {
      let method: WsMethod;
      let payload: any;
      const newClient = await createClient(WS_CONNECTION_URL, {
        [ServerWsMethod.ClientRegistered]: (receivedMethod, receivedPayload) => {
          method = receivedMethod;
          payload = receivedPayload;
        },
      });

      await waitFor(() => !!method);
      await waitFor(() => !!payload);

      assertEquals(method!, ServerWsMethod.ClientRegistered);
      assertEquals('token' in payload, true);

      newClient.close();
    });
  });
});

function createClient(
  url: string,
  subs?: Partial<Record<WsMethod, <T extends WsMethod>(method: T, payload: WsMessagePayload[T]) => void>>
): Promise<WebSocket> {
  return new Promise((resolve) => {
    const newClient = new WebSocket(url);

    if (subs) {
      newClient.addEventListener('message', (event) => {
        const [receivedMethod, payload] = decodeWsMessage(event.data);

        const action = subs[receivedMethod as keyof WsMessagePayload];

        // @ts-ignore: TODO
        action?.(receivedMethod as WsMethod, payload);
      });
    }

    newClient.addEventListener('open', () => {
      resolve(newClient);
    });
  });
}

function waitForMessage(socket: WebSocket, method: ClientWsMethod | ServerWsMethod): Promise<[string, any]> {
  return new Promise((resolve) => {
    socket.addEventListener('message', (event) => {
      const [receivedMethod, payload] = decodeWsMessage(event.data);

      if (receivedMethod === method) {
        resolve([receivedMethod, payload]);
      }
    });
  });
}
