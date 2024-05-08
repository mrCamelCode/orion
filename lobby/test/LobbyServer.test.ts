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

    const clientCreationResult = await createClient(WS_CONNECTION_URL);

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

    describe('disconnection', () => {
      describe('lobby cleanup', () => {
        test('lobbies are removed when the host leaves', async () => {
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

          const [, { lobbyId }] = await createLobbySuccess;

          const { client: otherClient, token: otherClientToken } = await createClient(WS_CONNECTION_URL);
          const otherClientLobbyClosed = waitForMessage(otherClient, ServerWsMethod.LobbyClosed);
          const otherClientJoinLobby = waitForMessage(otherClient, ServerWsMethod.JoinLobbySuccess);

          otherClient.send(
            encodeWsMessage(ClientWsMethod.JoinLobby, {
              token: otherClientToken,
              lobbyId,
              peerName: 'peer',
            })
          );

          await otherClientJoinLobby;

          const response = await (await fetch(`${API_CONNECTION_URL}/lobbies`)).json();

          assertEquals(response.lobbies.length, 1);

          // Closing the connection should trigger a cleanup on the server side.
          client.close();

          await otherClientLobbyClosed;

          const newResponse = await (await fetch(`${API_CONNECTION_URL}/lobbies`)).json();

          assertEquals(newResponse.lobbies.length, 0);

          otherClient.close();
        });
        test('all peers receive a message that the lobby was closed when the host leaves', async () => {
          const createLobbySuccess = waitForMessage(client, ServerWsMethod.CreateLobbySuccess);
          const otherClients = await Promise.all(new Array(5).fill(0).map(() => createClient(WS_CONNECTION_URL)));

          client.send(
            encodeWsMessage(ClientWsMethod.CreateLobby, {
              token,
              lobbyName: 'My lobby',
              hostName: 'jt',
              isPublic: true,
              maxMembers: 10,
            })
          );

          const [, { lobbyId }] = await createLobbySuccess;

          const otherClientsJoinLobby = otherClients.map((otherClient) =>
            waitForMessage(otherClient.client, ServerWsMethod.JoinLobbySuccess)
          );
          const otherClientsLobbyClosed = otherClients.map((otherClient) =>
            waitForMessage(otherClient.client, ServerWsMethod.JoinLobbySuccess)
          );

          otherClients.forEach((otherClient) => {
            otherClient.client.send(
              encodeWsMessage(ClientWsMethod.JoinLobby, {
                token: otherClient.token,
                lobbyId,
                peerName: 'peer',
              })
            );
          });

          await Promise.all(otherClientsJoinLobby);

          // Closing the connection should trigger a cleanup on the server side.
          client.close();

          await Promise.all(otherClientsLobbyClosed);

          otherClients.forEach((otherClient) => otherClient.client.close());
        });
        test('all members of the lobby receive a message that a peer disconnected when a non-host member disconnects', async () => {
          const createLobbySuccess = waitForMessage(client, ServerWsMethod.CreateLobbySuccess);
          const hostPeerDisconnected = waitForMessage(client, ServerWsMethod.PeerDisconnected);

          const otherClients = await Promise.all(new Array(5).fill(0).map(() => createClient(WS_CONNECTION_URL)));

          client.send(
            encodeWsMessage(ClientWsMethod.CreateLobby, {
              token,
              lobbyName: 'My lobby',
              hostName: 'jt',
              isPublic: true,
              maxMembers: 10,
            })
          );

          const [, { lobbyId }] = await createLobbySuccess;

          const otherClientsJoinLobby = otherClients.map((otherClient) =>
            waitForMessage(otherClient.client, ServerWsMethod.JoinLobbySuccess)
          );

          otherClients.forEach((otherClient) => {
            otherClient.client.send(
              encodeWsMessage(ClientWsMethod.JoinLobby, {
                token: otherClient.token,
                lobbyId,
                peerName: 'peer',
              })
            );
          });

          await Promise.all(otherClientsJoinLobby);

          // Closing the connection should trigger a cleanup on the server side.
          const [disconnectedClient] = otherClients.splice(0, 1);
          disconnectedClient.client.close();

          const otherClientsPeerDisconnected = otherClients.map((otherClient) =>
            waitForMessage(otherClient.client, ServerWsMethod.PeerDisconnected)
          );

          await hostPeerDisconnected;
          await Promise.all(otherClientsPeerDisconnected);

          otherClients.forEach((otherClient) => otherClient.client.close());
        });
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
        test('the client is already in another lobby', async () => {
          const { client: peerClient, token: peerClientToken } = await createClient(WS_CONNECTION_URL);

          const hostCreateLobbySuccess = waitForMessage(client, ServerWsMethod.CreateLobbySuccess);
          const peerCreateLobbyFailure = waitForMessage(peerClient, ServerWsMethod.CreateLobbyFailure);
          const peerJoinLobbySuccess = waitForMessage(peerClient, ServerWsMethod.JoinLobbySuccess);

          client.send(
            encodeWsMessage(ClientWsMethod.CreateLobby, {
              token,
              lobbyName: 'test lobby',
              hostName: 'jt',
              isPublic: true,
              maxMembers: 5,
            })
          );

          const [, { lobbyId }] = await hostCreateLobbySuccess;

          peerClient.send(
            encodeWsMessage(ClientWsMethod.JoinLobby, {
              token: peerClientToken,
              lobbyId,
              peerName: 'Peer JT',
            })
          );

          await peerJoinLobbySuccess;

          peerClient.send(
            encodeWsMessage(ClientWsMethod.CreateLobby, {
              token: peerClientToken,
              hostName: 'Naughty Peer Host',
              isPublic: false,
              lobbyName: 'Impossible Lobby',
              maxMembers: 3,
            })
          );

          const [, { errors }] = await peerCreateLobbyFailure;

          assert(errors.some((error: string) => error.includes('already in a lobby')));

          peerClient.close();
        });
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
      test('members of the lobby are notified of a peer connecting', async () => {
        const createLobbySuccess = waitForMessage(client, ServerWsMethod.CreateLobbySuccess);
        const hostPeerConnected = waitForMessage(client, ServerWsMethod.PeerConnected);

        client.send(
          encodeWsMessage(ClientWsMethod.CreateLobby, {
            token,
            lobbyName: 'My lobby',
            hostName: 'jt',
            isPublic: true,
            maxMembers: 3,
          })
        );

        const [, { lobbyId }] = await createLobbySuccess;

        const { client: peerClient, token: peerClientToken } = await createClient(WS_CONNECTION_URL);
        const joinLobbySuccess = waitForMessage(peerClient, ServerWsMethod.JoinLobbySuccess);

        peerClient.send(
          encodeWsMessage(ClientWsMethod.JoinLobby, {
            token: peerClientToken,
            lobbyId,
            peerName: 'Peer JT',
          })
        );

        await joinLobbySuccess;
        await hostPeerConnected;

        const peerPeerConnected = waitForMessage(peerClient, ServerWsMethod.PeerConnected);
        const secondHostPeerConnected = waitForMessage(client, ServerWsMethod.PeerConnected);
        const { client: otherPeerClient, token: otherPeerClientToken } = await createClient(WS_CONNECTION_URL);

        otherPeerClient.send(
          encodeWsMessage(ClientWsMethod.JoinLobby, {
            token: otherPeerClientToken,
            lobbyId,
            peerName: 'Peer JT',
          })
        );

        await peerPeerConnected;
        await secondHostPeerConnected;

        peerClient.close();
        otherPeerClient.close();
      });
      describe('success when...', () => {
        test('the payload is good and the client can join the lobby', async () => {
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

          const [, { lobbyId }] = await createLobbySuccess;

          const { client: peerClient, token: peerClientToken } = await createClient(WS_CONNECTION_URL);
          const joinLobbySuccess = waitForMessage(peerClient, ServerWsMethod.JoinLobbySuccess);

          peerClient.send(
            encodeWsMessage(ClientWsMethod.JoinLobby, {
              token: peerClientToken,
              lobbyId,
              peerName: 'Peer JT',
            })
          );

          const [, payload] = await joinLobbySuccess;

          assertEquals(payload.lobbyName, 'My lobby');
          assertEquals(payload.lobbyId, lobbyId);

          peerClient.close();
        });
      });
      describe('failure when...', () => {
        test('the payload has no token', async () => {
          const messageWaiter = waitForMessage(client, ServerWsMethod.MessageError);

          client.send(
            encodeWsMessage(
              ClientWsMethod.JoinLobby,
              // @ts-ignore
              {
                lobbyId: '123',
                peerName: 'name',
              }
            )
          );

          const [method] = await messageWaiter;

          assertEquals(method, ServerWsMethod.MessageError);
        });
        test('the payload has no lobbyId', async () => {
          const messageWaiter = waitForMessage(client, ServerWsMethod.MessageError);

          client.send(
            encodeWsMessage(
              ClientWsMethod.JoinLobby,
              // @ts-ignore
              {
                token,
                peerName: 'name',
              }
            )
          );

          const [method] = await messageWaiter;

          assertEquals(method, ServerWsMethod.MessageError);
        });
        test('the payload has no peerName', async () => {
          const messageWaiter = waitForMessage(client, ServerWsMethod.MessageError);

          client.send(
            encodeWsMessage(
              ClientWsMethod.JoinLobby,
              // @ts-ignore
              {
                token,
                lobbyId: '123',
              }
            )
          );

          const [method] = await messageWaiter;

          assertEquals(method, ServerWsMethod.MessageError);
        });
        test('the client is already the host of another lobby', async () => {
          const { client: peerClient, token: peerClientToken } = await createClient(WS_CONNECTION_URL);

          const peerClientHostSuccess = waitForMessage(peerClient, ServerWsMethod.CreateLobbySuccess);
          const lobbySuccessWaiter = waitForMessage(client, ServerWsMethod.CreateLobbySuccess);
          const joinLobbyFailure = waitForMessage(client, ServerWsMethod.JoinLobbyFailure);

          client.send(
            encodeWsMessage(ClientWsMethod.CreateLobby, {
              token,
              lobbyName: 'test lobby',
              hostName: 'jt',
              isPublic: true,
              maxMembers: 3,
            })
          );

          peerClient.send(
            encodeWsMessage(ClientWsMethod.CreateLobby, {
              token: peerClientToken,
              lobbyName: 'test lobby',
              hostName: 'jt',
              isPublic: true,
              maxMembers: 3,
            })
          );

          await lobbySuccessWaiter;
          const [, { lobbyId: otherLobbyId }] = await peerClientHostSuccess;

          client.send(
            encodeWsMessage(ClientWsMethod.JoinLobby, {
              token,
              lobbyId: otherLobbyId,
              peerName: 'peer',
            })
          );

          const [, payload] = await joinLobbyFailure;

          assert(payload.errors.some((error: string) => error.includes('already in a lobby')));

          peerClient.close();
        });
        test('the client is already in another lobby', async () => {
          const { client: peerClient, token: peerClientToken } = await createClient(WS_CONNECTION_URL);
          const { client: otherPeerClient, token: otherPeerClientToken } = await createClient(WS_CONNECTION_URL);

          const hostCreateLobbySuccess = waitForMessage(client, ServerWsMethod.CreateLobbySuccess);
          const otherPeerCreateLobbySuccess = waitForMessage(otherPeerClient, ServerWsMethod.CreateLobbySuccess);
          const peerJoinLobbySuccess = waitForMessage(peerClient, ServerWsMethod.JoinLobbySuccess);
          const peerJoinLobbyFailure = waitForMessage(peerClient, ServerWsMethod.JoinLobbyFailure);

          client.send(
            encodeWsMessage(ClientWsMethod.CreateLobby, {
              token,
              lobbyName: 'test lobby',
              hostName: 'jt',
              isPublic: true,
              maxMembers: 5,
            })
          );
          otherPeerClient.send(
            encodeWsMessage(ClientWsMethod.CreateLobby, {
              token: otherPeerClientToken,
              lobbyName: 'test lobby',
              hostName: 'jt',
              isPublic: true,
              maxMembers: 5,
            })
          );

          const [, { lobbyId }] = await hostCreateLobbySuccess;
          const [, { lobbyId: otherLobbyId }] = await otherPeerCreateLobbySuccess;

          peerClient.send(
            encodeWsMessage(ClientWsMethod.JoinLobby, {
              token: peerClientToken,
              lobbyId,
              peerName: 'Peer JT',
            })
          );

          await peerJoinLobbySuccess;

          peerClient.send(
            encodeWsMessage(ClientWsMethod.JoinLobby, {
              token: peerClientToken,
              lobbyId: otherLobbyId,
              peerName: 'Peer JT',
            })
          );

          const [, { errors }] = await peerJoinLobbyFailure;

          assert(errors.some((error: string) => error.includes('already in a lobby')));

          peerClient.close();
          otherPeerClient.close();
        });
        test('the lobby is full', async () => {
          const { client: peerClient, token: peerClientToken } = await createClient(WS_CONNECTION_URL);

          const lobbySuccessWaiter = waitForMessage(client, ServerWsMethod.CreateLobbySuccess);
          const joinLobbyFailure = waitForMessage(peerClient, ServerWsMethod.JoinLobbyFailure);

          client.send(
            encodeWsMessage(ClientWsMethod.CreateLobby, {
              token,
              lobbyName: 'test lobby',
              hostName: 'jt',
              isPublic: true,
              maxMembers: 1,
            })
          );

          const [, { lobbyId }] = await lobbySuccessWaiter;

          peerClient.send(
            encodeWsMessage(ClientWsMethod.JoinLobby, {
              token: peerClientToken,
              lobbyId,
              peerName: 'peer',
            })
          );

          const [, { errors }] = await joinLobbyFailure;

          assert(errors.some((error: string) => error.includes('lobby is full')));

          peerClient.close();
        });
      });
      describe('validation', () => {
        test('peerName cannot be more than 50 characters', async () => {
          const messageWaiter = waitForMessage(client, ServerWsMethod.MessageError);

          client.send(
            encodeWsMessage(ClientWsMethod.JoinLobby, {
              token,
              lobbyId: '123',
              peerName: '123456789012345678901234567890123456789012345678901234567890',
            })
          );

          const [, payload] = await messageWaiter;

          assertEquals(payload.method, ClientWsMethod.JoinLobby);
        });
        test('peerName cannot be only spaces', async () => {
          const messageWaiter = waitForMessage(client, ServerWsMethod.MessageError);

          client.send(
            encodeWsMessage(ClientWsMethod.JoinLobby, {
              token,
              lobbyId: '123',
              peerName: '  ',
            })
          );

          const [, payload] = await messageWaiter;

          assertEquals(payload.method, ClientWsMethod.JoinLobby);
        });
      });
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
      test('lobbies are no longer visible after being closed', async () => {
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

        const [, { lobbyId }] = await createLobbySuccess;

        const { client: otherClient, token: otherClientToken } = await createClient(WS_CONNECTION_URL);
        const otherClientLobbyClosed = waitForMessage(otherClient, ServerWsMethod.LobbyClosed);
        const otherClientJoinLobby = waitForMessage(otherClient, ServerWsMethod.JoinLobbySuccess);

        otherClient.send(
          encodeWsMessage(ClientWsMethod.JoinLobby, {
            token: otherClientToken,
            lobbyId,
            peerName: 'peer',
          })
        );

        await otherClientJoinLobby;

        const response = await (await fetch(`${API_CONNECTION_URL}/lobbies`)).json();

        assertEquals(response.lobbies.length, 1);

        // Closing the connection should trigger a cleanup on the server side.
        client.close();

        await otherClientLobbyClosed;

        const newResponse = await (await fetch(`${API_CONNECTION_URL}/lobbies`)).json();

        assertEquals(newResponse.lobbies.length, 0);

        otherClient.close();
      });
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
