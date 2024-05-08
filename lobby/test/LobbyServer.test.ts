import { assert, assertEquals, assertExists } from 'assert';
import { afterAll, afterEach, beforeAll, beforeEach, describe, test } from 'bdd';
import { restore } from 'mock';
import { ClientWsMethod, ServerWsMethod, WsMessagePayloadMap, WsMethod } from '../../network/network.model.ts';
import { decodeWsMessage, encodeWsMessage } from '../../network/network.util.ts';
import { IdToken } from '../../shared/model.ts';
import { stubLogger } from '../../util/testing.util.ts';
import { waitFor } from '../../util/util.ts';
import { LobbyServer } from '../LobbyServer.ts';

const HTTP_PORT = 3000;
const WS_CONNECTION_URL = `ws://localhost:${HTTP_PORT}`;
const HTTP_CONNECTION_URL = `http://localhost:${HTTP_PORT}`;
const API_CONNECTION_URL = `${HTTP_CONNECTION_URL}/api`;

let server: LobbyServer;

// Given that I actually start the server and create a client,
// this is more like an integration test, which isn't ideal.
// But I'd rather have the behaviour automatically tested than
// leaving it untested just because I don't want to set up a full
// and proper end-to-end testing environment.
describe('LobbyServer', () => {
  let client: WebSocket;
  let token: IdToken;

  beforeAll(() => {
    stubLogger();
  });
  beforeEach(async () => {
    server = new LobbyServer();

    server.start(HTTP_PORT);

    const clientCreationResult = await createClient(WS_CONNECTION_URL, {
      [ServerWsMethod.ClientRegistered]: (method, payload) => {
        // @ts-ignore
        token = payload.token;
      },
    });

    client = clientCreationResult.client;
    token = clientCreationResult.token;
  });
  afterEach(async () => {
    client.close();
    await server.stop();
  });
  afterAll(() => {
    restore();
  });

  describe('ws', () => {
    test('sends a message error message when a message is sent with an unknown method', async () => {
      const messageWaiter = waitForMessage(client, ServerWsMethod.MessageError);

      // @ts-ignore
      client.send(encodeWsMessage('notreal', {}));

      const [method, payload] = await messageWaiter;

      assertEquals(method, ServerWsMethod.MessageError);
      assert(payload.errors.some((error: string) => error.includes('notreal is unrecognized')));
    });

    describe('ping', () => {
      test('returns pong', async () => {
        const messageWaiter = waitForMessage(client, ServerWsMethod.Pong);

        client.send(encodeWsMessage(ClientWsMethod.Ping, {}));

        const [method, payload] = await messageWaiter;

        assertEquals(method, ServerWsMethod.Pong);
        assertEquals(payload, {});
      });
    });

    describe('connection', () => {
      test('server responds with registration success indication and token on successful connection', async () => {
        let method: WsMethod;
        let payload: any;
        const { client: newClient } = await createClient(WS_CONNECTION_URL, {
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

    describe(`${ClientWsMethod.CreateLobby}`, () => {
      describe('success when...', () => {
        test('the payload is good and the client is available to host', async () => {
          const messageWaiter = waitForMessage(client, ServerWsMethod.CreateLobbySuccess);

          client.send(
            encodeWsMessage(ClientWsMethod.CreateLobby, {
              token,
              lobbyName: 'My lobby',
              hostName: 'jt',
              isPublic: true,
              maxMembers: 3,
            })
          );

          const [method, payload] = await messageWaiter;

          assertEquals(method, ServerWsMethod.CreateLobbySuccess);

          assertEquals(payload.lobbyName, 'My lobby');
          assert('lobbyId' in payload);
        });
      });
      describe('failure when...', () => {
        test('the payload has no token', async () => {
          const messageWaiter = waitForMessage(client, ServerWsMethod.MessageError);

          client.send(
            encodeWsMessage(
              ClientWsMethod.CreateLobby,
              // @ts-ignore
              {
                lobbyName: 'My lobby',
                hostName: 'jt',
                isPublic: false,
                maxMembers: 3,
              }
            )
          );

          const [method] = await messageWaiter;

          assertEquals(method, ServerWsMethod.MessageError);
        });
        test('the payload has no lobby', async () => {
          const messageWaiter = waitForMessage(client, ServerWsMethod.MessageError);

          client.send(
            encodeWsMessage(
              ClientWsMethod.CreateLobby,
              // @ts-ignore
              {
                token,
                hostName: 'jt',
                isPublic: false,
                maxMembers: 3,
              }
            )
          );

          const [method] = await messageWaiter;

          assertEquals(method, ServerWsMethod.MessageError);
        });
        test('the payload has no host name', async () => {
          const messageWaiter = waitForMessage(client, ServerWsMethod.MessageError);

          client.send(
            encodeWsMessage(
              ClientWsMethod.CreateLobby,
              // @ts-ignore
              {
                token,
                lobbyName: 'test',
                isPublic: false,
                maxMembers: 3,
              }
            )
          );

          const [method] = await messageWaiter;

          assertEquals(method, ServerWsMethod.MessageError);
        });
        test('the payload has no public indicator', async () => {
          const messageWaiter = waitForMessage(client, ServerWsMethod.MessageError);

          client.send(
            encodeWsMessage(
              ClientWsMethod.CreateLobby,
              // @ts-ignore
              {
                token,
                lobbyName: 'test',
                hostName: 'jt',
                maxMembers: 3,
              }
            )
          );

          const [method] = await messageWaiter;

          assertEquals(method, ServerWsMethod.MessageError);
        });
        test('the payload does not specify max members', async () => {
          const messageWaiter = waitForMessage(client, ServerWsMethod.MessageError);

          client.send(
            encodeWsMessage(
              ClientWsMethod.CreateLobby,
              // @ts-ignore
              {
                token,
                lobbyName: 'test',
                hostName: 'jt',
                isPublic: true,
              }
            )
          );

          const [method] = await messageWaiter;

          assertEquals(method, ServerWsMethod.MessageError);
        });
        test('the client is already the host of another lobby', async () => {
          const lobbyFailureWaiter = waitForMessage(client, ServerWsMethod.CreateLobbyFailure);
          const lobbySuccessWaiter = waitForMessage(client, ServerWsMethod.CreateLobbySuccess);

          client.send(
            encodeWsMessage(ClientWsMethod.CreateLobby, {
              token,
              lobbyName: 'test lobby',
              hostName: 'jt',
              isPublic: true,
              maxMembers: 3,
            })
          );

          await lobbySuccessWaiter;

          client.send(
            encodeWsMessage(ClientWsMethod.CreateLobby, {
              token,
              lobbyName: 'brand new test lobby',
              hostName: 'different name',
              isPublic: true,
              maxMembers: 3,
            })
          );

          const [method, payload] = await lobbyFailureWaiter;

          assertEquals(method, ServerWsMethod.CreateLobbyFailure);
          assert(payload.errors.some((error: string) => error.includes('cannot be the host of a new lobby')));
        });
        // TODO: This test will require sending a message to join a lobby, since a second client
        // will need to join one lobby and then attempt to host another.
        // test('the client is already in another lobby', async () => {
        //   const messageWaiter = waitForMessage(client, ServerWsMethod.CreateLobbyFailure);

        //   client.send(
        //     encodeWsMessage(ClientWsMethod.CreateLobby, {
        //       token,
        //       lobbyName: 'test lobby',
        //       hostName: 'jt',
        //     })
        //   );

        //   const [method] = await messageWaiter;

        //   assertEquals(method, ServerWsMethod.CreateLobbyFailure);
        // });
      });
      describe('validation', () => {
        test(`the lobby name cannot exceed 50 characters`, async () => {
          const messageWaiter = waitForMessage(client, ServerWsMethod.MessageError);

          client.send(
            encodeWsMessage(ClientWsMethod.CreateLobby, {
              token,
              lobbyName: '123456789012345678901234567890123456789012345678901234567890',
              hostName: 'jt',
              isPublic: true,
              maxMembers: 3,
            })
          );

          const [, payload] = await messageWaiter;

          assertEquals(payload.method, ClientWsMethod.CreateLobby);
        });
        test('the host name cannot exceed 50 characters', async () => {
          const messageWaiter = waitForMessage(client, ServerWsMethod.MessageError);

          client.send(
            encodeWsMessage(ClientWsMethod.CreateLobby, {
              token,
              lobbyName: 'my lobby',
              hostName: '123456789012345678901234567890123456789012345678901234567890',
              isPublic: true,
              maxMembers: 3,
            })
          );

          const [, payload] = await messageWaiter;

          assertEquals(payload.method, ClientWsMethod.CreateLobby);
        });
        test('the lobby name cannot be only spaces', async () => {
          const messageWaiter = waitForMessage(client, ServerWsMethod.MessageError);

          client.send(
            encodeWsMessage(ClientWsMethod.CreateLobby, {
              token,
              lobbyName: '  ',
              hostName: 'jt',
              isPublic: true,
              maxMembers: 3,
            })
          );

          const [, payload] = await messageWaiter;

          assertEquals(payload.method, ClientWsMethod.CreateLobby);
        });
        test('the host name cannot be only spaces', async () => {
          const messageWaiter = waitForMessage(client, ServerWsMethod.MessageError);

          client.send(
            encodeWsMessage(ClientWsMethod.CreateLobby, {
              token,
              lobbyName: 'lobby',
              hostName: ' ',
              isPublic: true,
              maxMembers: 3,
            })
          );

          const [, payload] = await messageWaiter;

          assertEquals(payload.method, ClientWsMethod.CreateLobby);
        });
        test('the max members cannot be 0', async () => {
          const messageWaiter = waitForMessage(client, ServerWsMethod.MessageError);

          client.send(
            encodeWsMessage(ClientWsMethod.CreateLobby, {
              token,
              lobbyName: 'lobby',
              hostName: ' ',
              isPublic: true,
              maxMembers: 0,
            })
          );

          const [, payload] = await messageWaiter;

          assertEquals(payload.method, ClientWsMethod.CreateLobby);
        });
        test('the max members cannot be negative', async () => {
          const messageWaiter = waitForMessage(client, ServerWsMethod.MessageError);

          client.send(
            encodeWsMessage(ClientWsMethod.CreateLobby, {
              token,
              lobbyName: 'lobby',
              hostName: ' ',
              isPublic: true,
              maxMembers: -2,
            })
          );

          const [, payload] = await messageWaiter;

          assertEquals(payload.method, ClientWsMethod.CreateLobby);
        });
        test('the max members cannot be more than 64', async () => {
          const messageWaiter = waitForMessage(client, ServerWsMethod.MessageError);

          client.send(
            encodeWsMessage(ClientWsMethod.CreateLobby, {
              token,
              lobbyName: 'lobby',
              hostName: ' ',
              isPublic: true,
              maxMembers: 65,
            })
          );

          const [, payload] = await messageWaiter;

          assertEquals(payload.method, ClientWsMethod.CreateLobby);
        });
      });
    });

    describe(`${ClientWsMethod.JoinLobby}`, () => {
      describe('failure when...', () => {
        test(`there's already a client with the provided name in the lobby`, async () => {});
      });
    });

    describe('General Behaviour', () => {
      // TODO: This requires more to be in place. Maybe move these to the tests for CreateLobby
      // and the one for joining a lobby.
      // test(`A client can join a new lobby after leaving the one they're in.`, () => {
      // });
      // test(`A client can host a new lobby after leaving the one they're in.`, () => {
      // });
    });
  });

  describe('http', () => {
    describe('/lobbies', () => {
      test('has no lobbies when there are no lobbies', async () => {
        const response = await (await fetch(`${API_CONNECTION_URL}/lobbies`)).json();

        assertEquals(response.lobbies.length, 0);
      });
      test('returns all public lobbies', async () => {
        const createLobbySuccess = waitForMessage(client, ServerWsMethod.CreateLobbySuccess);

        client.send(
          encodeWsMessage(ClientWsMethod.CreateLobby, {
            token,
            lobbyName: 'My lobby',
            hostName: 'jt',
            isPublic: true,
            maxMembers: 3,
          })
        );

        await createLobbySuccess;

        const response = await (await fetch(`${API_CONNECTION_URL}/lobbies`)).json();
        const lobby = response.lobbies[0];

        assertEquals(lobby.name, 'My lobby');
        assertExists(lobby.id, 'My lobby');
        assertEquals(lobby.currentMembers, 1);
        assertEquals(lobby.maxMembers, 3);
      });
      test('omits private lobbies', async () => {
        const { client: otherClient, token: otherClientToken } = await createClient(WS_CONNECTION_URL);

        await waitFor(() => !!otherClientToken);

        const createLobbySuccesses = [client, otherClient].map((c) =>
          waitForMessage(c, ServerWsMethod.CreateLobbySuccess)
        );

        client.send(
          encodeWsMessage(ClientWsMethod.CreateLobby, {
            token,
            lobbyName: 'My lobby',
            hostName: 'jt',
            isPublic: true,
            maxMembers: 3,
          })
        );
        otherClient.send(
          encodeWsMessage(ClientWsMethod.CreateLobby, {
            token: otherClientToken!,
            lobbyName: 'Other Lobby',
            hostName: 'Other JT',
            isPublic: false,
            maxMembers: 5,
          })
        );

        await Promise.all(createLobbySuccesses);

        const response = await (await fetch(`${API_CONNECTION_URL}/lobbies`)).json();
        const lobby = response.lobbies[0];

        assertEquals(response.lobbies.length, 1);
        assertEquals(lobby.name, 'My lobby');
        assertExists(lobby.id, 'My lobby');
        assertEquals(lobby.currentMembers, 1);
        assertEquals(lobby.maxMembers, 3);

        otherClient.close();
      });
      // TODO: This test requires that lobby joining be implemented.
      // test('lobbies are no longer visible after being closed', async () => {
      //   const createLobbySuccess = waitForMessage(client, ServerWsMethod.CreateLobbySuccess);

      //   client.send(
      //     encodeWsMessage(ClientWsMethod.CreateLobby, {
      //       token,
      //       lobbyName: 'My lobby',
      //       hostName: 'jt',
      //       isPublic: true,
      //       maxMembers: 3,
      //     })
      //   );

      //   const [, createLobbySuccessPayload] = await createLobbySuccess;
      //   const { lobbyId } = createLobbySuccessPayload;

      //   const { client: otherClient, token: otherClientToken } = await createClient(WS_CONNECTION_URL);
      //   const lobbyClosed = waitForMessage(otherClient, ServerWsMethod.LobbyClosed);

      //   // TODO: Need to finish writing test.
      //   otherClient.send(
      //     encodeWsMessage(ClientWsMethod.JoinLobby, {
      //       token: otherClientToken,
      //     })
      //   );

      //   const response = await (await fetch(`${API_CONNECTION_URL}/lobbies`)).json();

      //   assertEquals(response.lobbies.length, 1);

      //   // Closing the connection should trigger a cleanup on the server side.
      //   client.close();

      //   await lobbyClosed;

      //   const newResponse = await (await fetch(`${API_CONNECTION_URL}/lobbies`)).json();

      //   assertEquals(newResponse.lobbies.length, 0);
      // });
    });
  });
});

async function createClient(
  url: string,
  subs?: Partial<Record<WsMethod, <T extends WsMethod>(method: T, payload: WsMessagePayloadMap[T]) => void>>
): Promise<{ client: WebSocket; token: IdToken }> {
  const newClient = new WebSocket(url);

  if (subs) {
    newClient.addEventListener('message', (event) => {
      const [receivedMethod, payload] = decodeWsMessage(event.data);

      const action = subs[receivedMethod as keyof WsMessagePayloadMap];

      // @ts-ignore: TODO
      action?.(receivedMethod as WsMethod, payload);
    });
  }

  let token: IdToken;

  newClient.addEventListener('message', (event) => {
    const [receivedMethod, payload] = decodeWsMessage(event.data);

    if (receivedMethod === ServerWsMethod.ClientRegistered) {
      token = payload.token;
    }
  });

  await waitFor(() => !!token && newClient.readyState === newClient.OPEN);

  return {
    client: newClient,
    token: token!,
  };
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
