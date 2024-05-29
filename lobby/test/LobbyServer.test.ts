import { assert, assertEquals } from 'assert';
import { afterAll, afterEach, beforeAll, beforeEach, describe, test } from 'bdd';
import { restore } from 'mock';
import { HttpMethod } from 'potami';
import { ClientWsMethod, ServerWsMethod, WsMessagePayloadMap, WsMethod } from '../../network/network.model.ts';
import { decodePacket, encodePacket, encodeWsPacket } from '../../network/network.util.ts';
import { IdToken } from '../../shared/model.ts';
import { ValueOf } from '../../types/types.ts';
import { stubLogger } from '../../util/testing.util.ts';
import { waitFor } from '../../util/util.ts';
import { LobbyServer } from '../LobbyServer.ts';
import { JoinLobbyPayload } from '../http/api/lobbies/lobbies.schema.ts';
import { ClientDatagramMethod } from '../udp/udp.model.ts';

const HTTP_PORT = 3000;

const LOBBIES_BASE_PATH = '/lobbies';
const GET_PUBLIC_LOBBIES_PATH = LOBBIES_BASE_PATH;
const CREATE_LOBBY_PATH = LOBBIES_BASE_PATH;

function getJoinLobbyPath(lobbyId: string): string {
  return `${LOBBIES_BASE_PATH}/${lobbyId}/join`;
}

function getStartPtpMediationPath(lobbyId: string): string {
  return `${LOBBIES_BASE_PATH}/${lobbyId}/ptp/start`;
}

let portCounter = 0;
let server: LobbyServer;

// Given that I actually start the server and create clients,
// these are more like integration tests. Great for peering into
// how a client might communicate with the server.
describe('LobbyServer', () => {
  beforeAll(() => {
    stubLogger();
  });
  beforeEach(async () => {
    server = new LobbyServer();

    await server.start(HTTP_PORT + portCounter, HTTP_PORT - (10 + portCounter));
  });
  afterEach(async () => {
    portCounter++;

    await server.stop();
  });
  afterAll(() => {
    restore();
  });

  describe('connection', () => {
    test('server responds with registration success indication and token on successful connection', async () => {
      let method: WsMethod;
      let payload: any;
      const { client: newClient } = await createClient(undefined, {
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
        const { client, token } = await createClient();

        const hostResponse = await fetch(`${getHttpConnectionUrl()}${CREATE_LOBBY_PATH}`, {
          method: HttpMethod.Post,
          body: JSON.stringify({
            token,
            lobbyName: 'My lobby',
            hostName: 'jt',
            isPublic: true,
            maxMembers: 3,
          }),
        });

        assertEquals(hostResponse.status, 201);

        const hostPayload = await hostResponse.json();

        const { client: otherClient, token: otherClientToken } = await createClient();
        const otherClientLobbyClosed = waitForMessage(otherClient, ServerWsMethod.LobbyClosed);

        const joinResponse = await fetch(`${getHttpConnectionUrl()}${getJoinLobbyPath(hostPayload.lobbyId)}`, {
          method: HttpMethod.Post,
          body: JSON.stringify({
            token: otherClientToken,
            peerName: 'peer homie',
          }),
        });

        assertEquals(joinResponse.status, 200);

        const publicLobbiesResponse = await (await fetch(`${getHttpConnectionUrl()}${GET_PUBLIC_LOBBIES_PATH}`)).json();

        assertEquals(publicLobbiesResponse.lobbies.length, 1);

        // Closing the connection should trigger a cleanup on the server side.
        client.close();

        await otherClientLobbyClosed;

        const newPublicLobbiesResponse = await (
          await fetch(`${getHttpConnectionUrl()}${GET_PUBLIC_LOBBIES_PATH}`)
        ).json();

        assertEquals(newPublicLobbiesResponse.lobbies.length, 0);

        otherClient.close();

        await cleanupResponses(hostResponse, joinResponse, publicLobbiesResponse, newPublicLobbiesResponse);
      });
      test('all peers receive a message that the lobby was closed when the host leaves', async () => {
        const { client: host, token: hostToken } = await createClient();

        const otherClients = await Promise.all(new Array(5).fill(0).map(() => createClient()));

        const hostResponse = await fetch(`${getHttpConnectionUrl()}${CREATE_LOBBY_PATH}`, {
          method: HttpMethod.Post,
          body: JSON.stringify({
            token: hostToken,
            lobbyName: 'My lobby',
            hostName: 'jt',
            isPublic: true,
            maxMembers: 10,
          }),
        });

        assertEquals(hostResponse.status, 201);

        const hostPayload = await hostResponse.json();

        const otherClientsLobbyClosed = otherClients.map((otherClient) =>
          waitForMessage(otherClient.client, ServerWsMethod.LobbyClosed)
        );

        const joinResponses = await Promise.all(
          otherClients.map((otherClient, i) => {
            return fetch(`${getHttpConnectionUrl()}${getJoinLobbyPath(hostPayload.lobbyId)}`, {
              method: HttpMethod.Post,
              body: JSON.stringify({
                token: otherClient.token,
                peerName: `peer homie ${i}`,
              }),
            });
          })
        );

        assert(joinResponses.every((res) => res.status === 200));

        // Closing the connection should trigger a cleanup on the server side.
        host.close();

        await Promise.all(otherClientsLobbyClosed);

        otherClients.forEach((otherClient) => otherClient.client.close());
        await cleanupResponses(hostResponse, ...joinResponses);
      });
      test('all members of the lobby receive a message that a peer disconnected when a non-host member disconnects', async () => {
        const { client: host, token: hostToken } = await createClient();

        const hostPeerDisconnected = waitForMessage(host, ServerWsMethod.PeerDisconnected);

        const otherClients = await Promise.all(new Array(5).fill(0).map(() => createClient()));

        const hostResponse = await fetch(`${getHttpConnectionUrl()}${CREATE_LOBBY_PATH}`, {
          method: HttpMethod.Post,
          body: JSON.stringify({
            token: hostToken,
            lobbyName: 'My lobby',
            hostName: 'jt',
            isPublic: true,
            maxMembers: 10,
          }),
        });

        assertEquals(hostResponse.status, 201);

        const hostPayload = await hostResponse.json();

        const joinResponses = await Promise.all(
          otherClients.map((otherClient, i) => {
            return fetch(`${getHttpConnectionUrl()}${getJoinLobbyPath(hostPayload.lobbyId)}`, {
              method: HttpMethod.Post,
              body: JSON.stringify({
                token: otherClient.token,
                peerName: `peer homie ${i}`,
              }),
            });
          })
        );

        // Closing the connection should trigger a cleanup on the server side.
        const [disconnectedClient] = otherClients.splice(0, 1);
        disconnectedClient.client.close();

        const otherClientsPeerDisconnected = otherClients.map((otherClient) =>
          waitForMessage(otherClient.client, ServerWsMethod.PeerDisconnected)
        );

        await hostPeerDisconnected;
        await Promise.all(otherClientsPeerDisconnected);

        otherClients.forEach((otherClient) => otherClient.client.close());
        host.close();
        await cleanupResponses(hostResponse, ...joinResponses);
      });
    });
  });

  describe('Phase 1 Behaviour - Lobbying', () => {
    describe('lobby creation', () => {
      describe('success when...', () => {
        test('the payload is good and the client is available to host', async () => {
          const { client, token } = await createClient();

          const response = await fetch(`${getHttpConnectionUrl()}${CREATE_LOBBY_PATH}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token,
              lobbyName: 'My lobby',
              hostName: 'jt',
              isPublic: true,
              maxMembers: 3,
            }),
          });

          const payload = await response.json();

          assertEquals(response.status, 201);

          assertEquals(payload.lobbyName, 'My lobby');
          assert('lobbyId' in payload);

          client.close();
        });
      });

      describe('failure when...', () => {
        test('the payload has no token', async () => {
          const response = await fetch(`${getHttpConnectionUrl()}${CREATE_LOBBY_PATH}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              lobbyName: 'My lobby',
              hostName: 'jt',
              isPublic: true,
              maxMembers: 3,
            }),
          });

          assertEquals(response.status, 400);

          await cleanupResponses(response);
        });
        test('the payload has no lobby name', async () => {
          const { client, token } = await createClient();

          const response = await fetch(`${getHttpConnectionUrl()}${CREATE_LOBBY_PATH}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token,
              hostName: 'jt',
              isPublic: true,
              maxMembers: 3,
            }),
          });

          assertEquals(response.status, 400);

          await cleanupResponses(response);
          client.close();
        });
        test('the payload has no host name', async () => {
          const { client, token } = await createClient();

          const response = await fetch(`${getHttpConnectionUrl()}${CREATE_LOBBY_PATH}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token,
              lobbyName: 'My lobby',
              isPublic: true,
              maxMembers: 3,
            }),
          });

          assertEquals(response.status, 400);

          await cleanupResponses(response);
          client.close();
        });
        test('the payload has no public indicator', async () => {
          const { client, token } = await createClient();

          const response = await fetch(`${getHttpConnectionUrl()}${CREATE_LOBBY_PATH}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token,
              lobbyName: 'My lobby',
              hostName: 'jt',
              maxMembers: 3,
            }),
          });

          assertEquals(response.status, 400);

          await cleanupResponses(response);
          client.close();
        });
        test('the payload does not specify max members', async () => {
          const { client, token } = await createClient();

          const response = await fetch(`${getHttpConnectionUrl()}${CREATE_LOBBY_PATH}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token,
              lobbyName: 'My lobby',
              hostName: 'jt',
              isPublic: true,
            }),
          });

          assertEquals(response.status, 400);

          await cleanupResponses(response);
          client.close();
        });
        test('the client is already the host of another lobby', async () => {
          const { client, token } = await createClient();

          const firstLobbyResponse = await fetch(`${getHttpConnectionUrl()}${CREATE_LOBBY_PATH}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token,
              lobbyName: 'My lobby',
              hostName: 'jt',
              isPublic: true,
              maxMembers: 3,
            }),
          });

          assertEquals(firstLobbyResponse.status, 201);

          const secondLobbyResponse = await fetch(`${getHttpConnectionUrl()}${CREATE_LOBBY_PATH}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token,
              lobbyName: 'Another lobby',
              hostName: 'another jt',
              isPublic: true,
              maxMembers: 3,
            }),
          });

          const payload = await secondLobbyResponse.json();

          assertEquals(secondLobbyResponse.status, 409);

          assert(payload.errors.some((error: string) => error.includes('cannot be the host of a new lobby')));

          await cleanupResponses(firstLobbyResponse, secondLobbyResponse);
          client.close();
        });
        test('the client is already in another lobby', async () => {
          const { client: host, token: hostToken } = await createClient();
          const { client: peer, token: peerToken } = await createClient();

          const hostResponse = await fetch(`${getHttpConnectionUrl()}${CREATE_LOBBY_PATH}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token: hostToken,
              lobbyName: 'My lobby',
              hostName: 'jt',
              isPublic: true,
              maxMembers: 3,
            }),
          });

          const hostPayload = await hostResponse.json();

          assertEquals(hostResponse.status, 201);

          const joinResponse = await fetch(`${getHttpConnectionUrl()}${getJoinLobbyPath(hostPayload.lobbyId)}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token: peerToken,
              peerName: 'peer homie',
            }),
          });

          assertEquals(joinResponse.status, 200);

          const peerHostResponse = await fetch(`${getHttpConnectionUrl()}${CREATE_LOBBY_PATH}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token: hostToken,
              lobbyName: 'New lobby',
              hostName: 'peer jt',
              isPublic: true,
              maxMembers: 3,
            }),
          });

          const { errors } = await peerHostResponse.json();

          assertEquals(peerHostResponse.status, 409);
          assert(errors.some((error: string) => error.includes('already in a lobby')));

          host.close();
          peer.close();

          await cleanupResponses(hostResponse, joinResponse, peerHostResponse);
        });
      });
      describe('validation', () => {
        test(`the lobby name cannot exceed 50 characters`, async () => {
          const { client, token } = await createClient();

          const response = await fetch(`${getHttpConnectionUrl()}${CREATE_LOBBY_PATH}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token,
              lobbyName: '123456789012345678901234567890123456789012345678901234567890',
              hostName: 'jt',
              isPublic: true,
              maxMembers: 3,
            }),
          });

          assertEquals(response.status, 400);

          client.close();
          await cleanupResponses(response);
        });
        test('the host name cannot exceed 50 characters', async () => {
          const { client, token } = await createClient();

          const response = await fetch(`${getHttpConnectionUrl()}${CREATE_LOBBY_PATH}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token,
              lobbyName: 'my lobby',
              hostName: '123456789012345678901234567890123456789012345678901234567890',
              isPublic: true,
              maxMembers: 3,
            }),
          });

          assertEquals(response.status, 400);

          client.close();
          await cleanupResponses(response);
        });
        test('the lobby name cannot be only spaces', async () => {
          const { client, token } = await createClient();

          const response = await fetch(`${getHttpConnectionUrl()}${CREATE_LOBBY_PATH}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token,
              lobbyName: '  ',
              hostName: 'jt',
              isPublic: true,
              maxMembers: 3,
            }),
          });

          assertEquals(response.status, 400);

          client.close();
          await cleanupResponses(response);
        });
        test('the host name cannot be only spaces', async () => {
          const { client, token } = await createClient();

          const response = await fetch(`${getHttpConnectionUrl()}${CREATE_LOBBY_PATH}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token,
              lobbyName: 'lobby',
              hostName: ' ',
              isPublic: true,
              maxMembers: 3,
            }),
          });

          assertEquals(response.status, 400);

          client.close();
          await cleanupResponses(response);
        });
        test('the max members cannot be 0', async () => {
          const { client, token } = await createClient();

          const response = await fetch(`${getHttpConnectionUrl()}${CREATE_LOBBY_PATH}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token,
              lobbyName: 'lobby',
              hostName: ' ',
              isPublic: true,
              maxMembers: 0,
            }),
          });

          assertEquals(response.status, 400);

          client.close();
          await cleanupResponses(response);
        });
        test('the max members cannot be negative', async () => {
          const { client, token } = await createClient();

          const response = await fetch(`${getHttpConnectionUrl()}${CREATE_LOBBY_PATH}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token,
              lobbyName: 'lobby',
              hostName: ' ',
              isPublic: true,
              maxMembers: -2,
            }),
          });

          assertEquals(response.status, 400);

          client.close();
          await cleanupResponses(response);
        });
        test('the max members cannot be more than 64', async () => {
          const { client, token } = await createClient();

          const response = await fetch(`${getHttpConnectionUrl()}${CREATE_LOBBY_PATH}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token,
              lobbyName: 'lobby',
              hostName: ' ',
              isPublic: true,
              maxMembers: 65,
            }),
          });

          assertEquals(response.status, 400);

          client.close();
          await cleanupResponses(response);
        });
      });
    });
    describe('lobby joining', () => {
      test('members of the lobby are notified of a peer connecting, and the response contains all required information', async () => {
        const { client: host, token: hostToken } = await createClient();

        const hostResponse = await fetch(`${getHttpConnectionUrl()}${CREATE_LOBBY_PATH}`, {
          method: HttpMethod.Post,
          body: JSON.stringify({
            token: hostToken,
            lobbyName: 'My lobby',
            hostName: 'jt',
            isPublic: true,
            maxMembers: 3,
          }),
        });

        const hostPayload = await hostResponse.json();

        assertEquals(hostResponse.status, 201);

        const { client: peer, token: peerToken } = await createClient();
        const firstHostPeerConnected = waitForMessage(host, ServerWsMethod.PeerConnected);

        const joinResponse = await fetch(`${getHttpConnectionUrl()}${getJoinLobbyPath(hostPayload.lobbyId)}`, {
          method: HttpMethod.Post,
          body: JSON.stringify({
            token: peerToken,
            peerName: 'peer homie',
          }),
        });

        await firstHostPeerConnected;

        const joinPayload = await joinResponse.json();

        assert('lobbyId' in joinPayload);
        assertEquals(joinResponse.status, 200);

        const peerPeerConnected = waitForMessage(peer, ServerWsMethod.PeerConnected);
        const secondHostPeerConnected = waitForMessage(host, ServerWsMethod.PeerConnected);
        const { client: otherPeer, token: otherPeerToken } = await createClient();

        const otherJoinResponse = await fetch(`${getHttpConnectionUrl()}${getJoinLobbyPath(hostPayload.lobbyId)}`, {
          method: HttpMethod.Post,
          body: JSON.stringify({
            token: otherPeerToken,
            peerName: 'other peer homie',
          }),
        });

        const otherJoinPayload = await otherJoinResponse.json();

        await peerPeerConnected;
        await secondHostPeerConnected;

        [joinPayload, otherJoinPayload].forEach((payload) => {
          assert('lobbyId' in payload);
          assertEquals(payload.lobbyName, 'My lobby');
          assertEquals(payload.host, 'jt');
        });

        assertEquals(joinPayload.lobbyMembers, ['jt', 'peer homie']);
        assertEquals(otherJoinPayload.lobbyMembers, ['jt', 'peer homie', 'other peer homie']);

        host.close();
        peer.close();
        otherPeer.close();
        await cleanupResponses(hostResponse, joinResponse, otherJoinResponse);
      });
      describe('success when...', () => {
        test('the payload is good and the client can join the lobby', async () => {
          const { client: host, token: hostToken } = await createClient();

          const hostResponse = await fetch(`${getHttpConnectionUrl()}${CREATE_LOBBY_PATH}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token: hostToken,
              lobbyName: 'My lobby',
              hostName: 'jt',
              isPublic: true,
              maxMembers: 3,
            }),
          });

          const hostPayload = await hostResponse.json();

          assertEquals(hostResponse.status, 201);

          const { client: peer, token: peerToken } = await createClient();

          const joinResponse = await fetch(`${getHttpConnectionUrl()}${getJoinLobbyPath(hostPayload.lobbyId)}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token: peerToken,
              peerName: 'peer homie',
            }),
          });

          const joinPayload = await joinResponse.json();

          assertEquals(joinResponse.status, 200);
          assert('lobbyId' in joinPayload);
          assertEquals(joinPayload.lobbyName, 'My lobby');
          assertEquals(joinPayload.host, 'jt');
          assertEquals(joinPayload.lobbyMembers, ['jt', 'peer homie']);

          host.close();
          peer.close();
          await cleanupResponses(hostResponse, joinResponse);
        });
      });
      describe('failure when...', () => {
        test('the payload has no token', async () => {
          const { client: host, token: hostToken } = await createClient();

          const hostResponse = await fetch(`${getHttpConnectionUrl()}${CREATE_LOBBY_PATH}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token: hostToken,
              lobbyName: 'My lobby',
              hostName: 'jt',
              isPublic: true,
              maxMembers: 3,
            }),
          });

          const hostPayload = await hostResponse.json();

          assertEquals(hostResponse.status, 201);

          const { client: peer, token: peerToken } = await createClient();

          const joinResponse = await fetch(`${getHttpConnectionUrl()}${getJoinLobbyPath(hostPayload.lobbyId)}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              peerName: 'peer homie',
            }),
          });

          assertEquals(joinResponse.status, 400);

          host.close();
          peer.close();
          await cleanupResponses(hostResponse, joinResponse);
        });
        test('the payload has no peerName', async () => {
          const { client: host, token: hostToken } = await createClient();

          const hostResponse = await fetch(`${getHttpConnectionUrl()}${CREATE_LOBBY_PATH}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token: hostToken,
              lobbyName: 'My lobby',
              hostName: 'jt',
              isPublic: true,
              maxMembers: 3,
            }),
          });

          const hostPayload = await hostResponse.json();

          assertEquals(hostResponse.status, 201);

          const { client: peer, token: peerToken } = await createClient();

          const joinResponse = await fetch(`${getHttpConnectionUrl()}${getJoinLobbyPath(hostPayload.lobbyId)}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token: peerToken,
            }),
          });

          assertEquals(joinResponse.status, 400);

          host.close();
          peer.close();
          await cleanupResponses(hostResponse, joinResponse);
        });
        test('the specified lobby does not exist', async () => {
          const { client: host, token: hostToken } = await createClient();

          const hostResponse = await fetch(`${getHttpConnectionUrl()}${CREATE_LOBBY_PATH}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token: hostToken,
              lobbyName: 'My lobby',
              hostName: 'jt',
              isPublic: true,
              maxMembers: 3,
            }),
          });

          const hostPayload = await hostResponse.json();

          assertEquals(hostResponse.status, 201);

          const { client: peer, token: peerToken } = await createClient();

          const joinResponse = await fetch(
            `${getHttpConnectionUrl()}${getJoinLobbyPath(
              (hostPayload.lobbyId as string).split('').reverse().join('')
            )}`,
            {
              method: HttpMethod.Post,
              body: JSON.stringify({
                token: peerToken,
                peerName: 'peer homie',
              }),
            }
          );

          assertEquals(joinResponse.status, 409);

          host.close();
          peer.close();
          await cleanupResponses(hostResponse, joinResponse);
        });
        test('the client is already the host of another lobby', async () => {
          const { client: host, token: hostToken } = await createClient();

          const hostResponse = await fetch(`${getHttpConnectionUrl()}${CREATE_LOBBY_PATH}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token: hostToken,
              lobbyName: 'My lobby',
              hostName: 'jt',
              isPublic: true,
              maxMembers: 3,
            }),
          });

          const hostPayload = await hostResponse.json();

          assertEquals(hostResponse.status, 201);

          const { client: peer, token: peerToken } = await createClient();

          const otherHostResponse = await fetch(`${getHttpConnectionUrl()}${CREATE_LOBBY_PATH}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token: peerToken,
              lobbyName: 'Another lobby',
              hostName: 'jt jkdfq',
              isPublic: true,
              maxMembers: 3,
            }),
          });

          assertEquals(otherHostResponse.status, 201);

          const joinResponse = await fetch(`${getHttpConnectionUrl()}${getJoinLobbyPath(hostPayload.lobbyId)}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token: peerToken,
              peerName: 'peer homie',
            }),
          });

          assertEquals(joinResponse.status, 409);

          host.close();
          peer.close();
          await cleanupResponses(hostResponse, otherHostResponse, joinResponse);
        });
        test('the client is already in another lobby', async () => {
          const { client: host, token: hostToken } = await createClient();

          const hostResponse = await fetch(`${getHttpConnectionUrl()}${CREATE_LOBBY_PATH}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token: hostToken,
              lobbyName: 'My lobby',
              hostName: 'jt',
              isPublic: true,
              maxMembers: 3,
            }),
          });

          const hostPayload = await hostResponse.json();

          assertEquals(hostResponse.status, 201);

          const { client: otherHost, token: otherHostToken } = await createClient();

          const otherHostResponse = await fetch(`${getHttpConnectionUrl()}${CREATE_LOBBY_PATH}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token: otherHostToken,
              lobbyName: 'My lobby',
              hostName: 'jt',
              isPublic: true,
              maxMembers: 3,
            }),
          });

          const otherHostPayload = await otherHostResponse.json();

          assertEquals(otherHostResponse.status, 201);

          const { client: peer, token: peerToken } = await createClient();

          const joinResponse = await fetch(`${getHttpConnectionUrl()}${getJoinLobbyPath(hostPayload.lobbyId)}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token: peerToken,
              peerName: 'peer homie',
            }),
          });

          assertEquals(joinResponse.status, 200);

          const otherJoinResponse = await fetch(
            `${getHttpConnectionUrl()}${getJoinLobbyPath(otherHostPayload.lobbyId)}`,
            {
              method: HttpMethod.Post,
              body: JSON.stringify({
                token: peerToken,
                peerName: 'peer homie',
              }),
            }
          );

          assertEquals(otherJoinResponse.status, 409);

          host.close();
          peer.close();
          otherHost.close();
          await cleanupResponses(hostResponse, otherHostResponse, joinResponse, otherJoinResponse);
        });
        test('the lobby is full', async () => {
          const { client: host, token: hostToken } = await createClient();

          const hostResponse = await fetch(`${getHttpConnectionUrl()}${CREATE_LOBBY_PATH}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token: hostToken,
              lobbyName: 'My lobby',
              hostName: 'jt',
              isPublic: true,
              maxMembers: 1,
            }),
          });

          const hostPayload = await hostResponse.json();

          assertEquals(hostResponse.status, 201);

          const { client: peer, token: peerToken } = await createClient();

          const joinResponse = await fetch(`${getHttpConnectionUrl()}${getJoinLobbyPath(hostPayload.lobbyId)}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token: peerToken,
              peerName: 'peer homie',
            }),
          });

          assertEquals(joinResponse.status, 409);

          host.close();
          peer.close();
          await cleanupResponses(hostResponse, joinResponse);
        });
        test('someone with the requested name is already in the lobby', async () => {
          const { client: host, token: hostToken } = await createClient();

          const hostResponse = await fetch(`${getHttpConnectionUrl()}${CREATE_LOBBY_PATH}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token: hostToken,
              lobbyName: 'My lobby',
              hostName: 'jt',
              isPublic: true,
              maxMembers: 3,
            }),
          });

          const hostPayload = await hostResponse.json();

          assertEquals(hostResponse.status, 201);

          const { client: peer, token: peerToken } = await createClient();

          const joinResponse = await fetch(`${getHttpConnectionUrl()}${getJoinLobbyPath(hostPayload.lobbyId)}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token: peerToken,
              peerName: 'jt',
            }),
          });

          assertEquals(joinResponse.status, 409);

          host.close();
          peer.close();
          await cleanupResponses(hostResponse, joinResponse);
        });
      });
      describe('validation', () => {
        test('peerName cannot be more than 50 characters', async () => {
          const { client: host, token: hostToken } = await createClient();

          const hostResponse = await fetch(`${getHttpConnectionUrl()}${CREATE_LOBBY_PATH}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token: hostToken,
              lobbyName: 'My lobby',
              hostName: 'jt',
              isPublic: true,
              maxMembers: 3,
            }),
          });

          const hostPayload = await hostResponse.json();

          assertEquals(hostResponse.status, 201);

          const { client: peer, token: peerToken } = await createClient();

          const joinResponse = await fetch(`${getHttpConnectionUrl()}${getJoinLobbyPath(hostPayload.lobbyId)}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token: peerToken,
              peerName: '123456789012345678901234567890123456789012345678901234567890',
            }),
          });

          assertEquals(joinResponse.status, 400);

          host.close();
          peer.close();
          await cleanupResponses(hostResponse, joinResponse);
        });
        test('peerName cannot be only spaces', async () => {
          const { client: host, token: hostToken } = await createClient();

          const hostResponse = await fetch(`${getHttpConnectionUrl()}${CREATE_LOBBY_PATH}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token: hostToken,
              lobbyName: 'My lobby',
              hostName: 'jt',
              isPublic: true,
              maxMembers: 3,
            }),
          });

          const hostPayload = await hostResponse.json();

          assertEquals(hostResponse.status, 201);

          const { client: peer, token: peerToken } = await createClient();

          const joinResponse = await fetch(`${getHttpConnectionUrl()}${getJoinLobbyPath(hostPayload.lobbyId)}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token: peerToken,
              peerName: '  ',
            }),
          });

          assertEquals(joinResponse.status, 400);

          host.close();
          peer.close();
          await cleanupResponses(hostResponse, joinResponse);
        });
      });
    });
  });

  describe('Phase 2 Behaviour - PTP Mediation', () => {
    describe('starting mediation', () => {
      test(`all peers receive the ${ServerWsMethod.SendPtpPacket} message when mediation successfully begins`, async () => {
        const { host, peers, lobbyId, cleanupLobby } = await createLobby(1);

        const messageWaiters = [host, ...peers]
          .map((c) => c.client)
          .map((client) => waitForMessage(client, ServerWsMethod.SendPtpPacket));

        const response = await fetch(`${getHttpConnectionUrl()}${getStartPtpMediationPath(lobbyId)}`, {
          method: HttpMethod.Post,
          body: JSON.stringify({
            token: host.token,
          }),
        });

        assertEquals(response.status, 200);

        await Promise.all(messageWaiters);

        await cleanupLobby();
        await cleanupResponses(response);
      });

      describe(`reminder ${ServerWsMethod.SendPtpPacket}`, () => {
        // TODO: I can't seem to get FakeTime to actually work correctly.
        // test(`peers receive reminder after a default of 10 seconds`, async () => {
        //   const {
        //     host,
        //     peers,
        //     lobbyId,
        //     cleanupLobby,
        //   } = await createLobby(1);
        //   const messageWaiters = [host, ...peers]
        //   .map((c) => c.client)
        //   .map((client) => waitForMessage(client, ServerWsMethod.SendPtpPacket));
        //   const response = await fetch(`${getHttpConnectionUrl()}${getStartPtpMediationPath(lobbyId)}`, {
        //     method: HttpMethod.Post,
        //     body: JSON.stringify({
        //       token: host.token,
        //     }),
        //   });
        //   assertEquals(response.status, 200);
        //   await Promise.all(messageWaiters);
        //   const reminderWaiters = [host, ...peers]
        //   .map((c) => c.client)
        //   .map((client) => waitForMessage(client, ServerWsMethod.SendPtpPacket));
        //   using time = new FakeTime();
        //   time.tick(11000);
        //   await Promise.all(reminderWaiters);
        //   await cleanupLobby();
        //   await cleanupResponses(response);
        // });
      });

      describe('succeeds when...', () => {
        test(`the requesting client is the host and there's at least two members in the lobby`, async () => {
          const {
            host: { token },
            lobbyId,
            cleanupLobby,
          } = await createLobby(1);

          const response = await fetch(`${getHttpConnectionUrl()}${getStartPtpMediationPath(lobbyId)}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token,
            }),
          });

          assertEquals(response.status, 200);

          await cleanupLobby();
          await cleanupResponses(response);
        });
      });
      describe('failure when...', () => {
        test(`there's no token on the request`, async () => {
          const { lobbyId, cleanupLobby } = await createLobby(1);

          const response = await fetch(`${getHttpConnectionUrl()}${getStartPtpMediationPath(lobbyId)}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({}),
          });

          assertEquals(response.status, 400);

          await cleanupLobby();
          await cleanupResponses(response);
        });
        test(`the requesting client is not the host`, async () => {
          const { peers, lobbyId, cleanupLobby } = await createLobby(1);

          const response = await fetch(`${getHttpConnectionUrl()}${getStartPtpMediationPath(lobbyId)}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token: peers[0].token,
            }),
          });

          const json = await response.json();

          assert((json.errors as string[]).some((err) => err.includes('not the host')));
          assertEquals(response.status, 409);

          await cleanupLobby();
          await cleanupResponses(response);
        });
        test(`the requesting client is the host of a different lobby`, async () => {
          const { lobbyId, cleanupLobby } = await createLobby(1);

          const {
            host: { token: otherHostToken },
            cleanupLobby: cleanupOtherLobby,
          } = await createLobby(1);

          const response = await fetch(`${getHttpConnectionUrl()}${getStartPtpMediationPath(lobbyId)}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token: otherHostToken,
            }),
          });

          const json = await response.json();

          assert((json.errors as string[]).some((err) => err.includes('not the host')));

          assertEquals(response.status, 409);

          await cleanupLobby();
          cleanupOtherLobby();
          await cleanupResponses(response);
        });
        test(`there's only one client in the lobby`, async () => {
          const {
            host: { token },
            lobbyId,
            cleanupLobby,
          } = await createLobby(0);

          const response = await fetch(`${getHttpConnectionUrl()}${getStartPtpMediationPath(lobbyId)}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token,
            }),
          });

          const json = await response.json();

          assert((json.errors as string[]).some((err) => err.includes('must be at least 2')));
          assertEquals(response.status, 409);

          await cleanupLobby();
          await cleanupResponses(response);
        });
        test(`there's only one client in the lobby after a disconnect`, async () => {
          const {
            host: { token },
            peers,
            lobbyId,
            cleanupLobby,
          } = await createLobby(1);

          peers[0].client.close();

          await new Promise((resolve) => setTimeout(resolve, 1));

          const response = await fetch(`${getHttpConnectionUrl()}${getStartPtpMediationPath(lobbyId)}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token,
            }),
          });

          const json = await response.json();

          assert((json.errors as string[]).some((err) => err.includes('must be at least 2')));
          assertEquals(response.status, 409);

          await cleanupLobby();
          await cleanupResponses(response);
        });
        test(`there's already a mediation being performed for the lobby`, async () => {
          const {
            host: { token },
            lobbyId,
            cleanupLobby,
          } = await createLobby(1);

          const response = await fetch(`${getHttpConnectionUrl()}${getStartPtpMediationPath(lobbyId)}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token,
            }),
          });

          assertEquals(response.status, 200);

          const otherResponse = await fetch(`${getHttpConnectionUrl()}${getStartPtpMediationPath(lobbyId)}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token,
            }),
          });

          assertEquals(otherResponse.status, 409);

          await cleanupLobby();
          await cleanupResponses(response, otherResponse);
        });
      });
    });
    describe('mediation aborting', () => {
      test(`aborts when a client disconnects during the mediation`, async () => {
        const { host, peers, lobbyId, cleanupLobby } = await createLobby(2);

        const response = await fetch(`${getHttpConnectionUrl()}${getStartPtpMediationPath(lobbyId)}`, {
          method: HttpMethod.Post,
          body: JSON.stringify({
            token: host.token,
          }),
        });

        assertEquals(response.status, 200);

        const [quittingPeer, ...otherPeers] = peers;

        const messageWaiters = [host, ...otherPeers]
          .map((c) => c.client)
          .map((client) => waitForMessage(client, ServerWsMethod.PtpMediationAborted));

        quittingPeer.client.close();

        await Promise.all(messageWaiters);

        await cleanupLobby();
        await cleanupResponses(response);
      });
      // TODO: Will need FakeTime working to test.
      // test(`aborts when the mediation times out`, async () => {});
    });
    describe('start peer-to-peer connection', () => {
      test(`once the server has received a connection UDP packet from all peers, server sends ${ServerWsMethod.StartPeerConnection} to peers`, async () => {
        const { host, peers, lobbyId, cleanupLobby } = await createLobby(2);
        const members = [host, ...peers];
        const udpClientPort = 10000;

        const response = await fetch(`${getHttpConnectionUrl()}${getStartPtpMediationPath(lobbyId)}`, {
          method: HttpMethod.Post,
          body: JSON.stringify({
            token: host.token,
          }),
        });

        assertEquals(response.status, 200);

        const clientData = members.map((m, i) => ({
          udpClient: Deno.listenDatagram({ port: udpClientPort + i, transport: 'udp' }),
          client: m,
        }));

        const startConnectionMessagesWaiters = members.map((m) =>
          waitForMessage(m.client, ServerWsMethod.StartPeerConnection)
        );

        await Promise.all(
          clientData.map((c) => {
            const message = {
              token: c.client.token,
            };

            const encodedMessage = new TextEncoder().encode(
              encodePacket(ClientDatagramMethod.PtpMediationConnect, message)
            );

            return c.udpClient.send(encodedMessage, { hostname: 'localhost', port: server.udpPort } as Deno.NetAddr);
          })
        );

        const startConnectionMessages = await Promise.all(startConnectionMessagesWaiters);

        const [hostConnectionMessage] = startConnectionMessages;
        const [, hostPayload] = hostConnectionMessage as [
          string,
          WsMessagePayloadMap[ServerWsMethod.StartPeerConnection]
        ];

        assertEquals(hostPayload.peers.length, 2);
        assert(hostPayload.peers.every((peer) => peer.ip === '127.0.0.1'));
        assert(hostPayload.peers.some((peer) => peer.port === udpClientPort + 1));
        assert(hostPayload.peers.some((peer) => peer.port === udpClientPort + 2));

        startConnectionMessages.forEach((message, index) => {
          const [, payload] = message as [string, WsMessagePayloadMap[ServerWsMethod.StartPeerConnection]];
          const member = members[index];

          if (member === host) {
            // The host receives connection details for all peers.
            assertEquals(payload.peers.length, 2);
            assert(payload.peers.every((peer) => peer.ip === '127.0.0.1'));
            assert(payload.peers.some((peer) => peer.port === udpClientPort + 1));
            assert(payload.peers.some((peer) => peer.port === udpClientPort + 2));
          } else {
            // Non-hosts receive only the connection details for the host.
            assertEquals(payload.peers.length, 1);
            assertEquals(payload.peers[0].ip, '127.0.0.1');
            assertEquals(payload.peers[0].port, udpClientPort);
          }
        });

        await cleanupLobby();
        await cleanupResponses(response);
        clientData.forEach((c) => c.udpClient.close());
      });
    });
    describe('finishing peer-to-peer connection', () => {
      test(
        `peers receive a ${ServerWsMethod.PtpMediationSuccessful} message and the lobby auto-closes when all peers have indicated connection success, ` +
          `which also issues a ${ServerWsMethod.LobbyClosed} message`,
        async () => {
          const { host, peers, lobbyId, cleanupLobby } = await createLobby(2);
          const members = [host, ...peers];
          const udpClientPort = 10000;

          const response = await fetch(`${getHttpConnectionUrl()}${getStartPtpMediationPath(lobbyId)}`, {
            method: HttpMethod.Post,
            body: JSON.stringify({
              token: host.token,
            }),
          });

          assertEquals(response.status, 200);

          const clientData = members.map((m, i) => ({
            udpClient: Deno.listenDatagram({ port: udpClientPort + i, transport: 'udp' }),
            client: m,
          }));

          const getLobbiesResponseBefore = await fetch(`${getHttpConnectionUrl()}${GET_PUBLIC_LOBBIES_PATH}`);
          assertEquals(getLobbiesResponseBefore.status, 200);
          const { lobbies: publicLobbiesBefore } = (await getLobbiesResponseBefore.json()) as { lobbies: any[] };
          assertEquals(publicLobbiesBefore.length, 1);

          const startConnectionMessagesWaiters = members.map((m) =>
            waitForMessage(m.client, ServerWsMethod.StartPeerConnection)
          );

          await Promise.all(
            clientData.map((c) => {
              const message = {
                token: c.client.token,
              };

              const encodedMessage = new TextEncoder().encode(
                encodePacket(ClientDatagramMethod.PtpMediationConnect, message)
              );

              return c.udpClient.send(encodedMessage, { hostname: 'localhost', port: server.udpPort } as Deno.NetAddr);
            })
          );

          await Promise.all(startConnectionMessagesWaiters);

          const ptpMediationSuccessMessageWaiters = members.map((m) =>
            waitForMessage(m.client, ServerWsMethod.PtpMediationSuccessful)
          );
          const lobbyClosedMessageWaiters = members.map((m) => waitForMessage(m.client, ServerWsMethod.LobbyClosed));

          members.forEach((member) => {
            member.client.send(
              encodeWsPacket(ClientWsMethod.ConnectedToPeers, {
                token: member.token,
              })
            );
          });

          await Promise.all(ptpMediationSuccessMessageWaiters);
          await Promise.all(lobbyClosedMessageWaiters);

          await cleanupLobby();
          await cleanupResponses(response, getLobbiesResponseBefore);
          clientData.forEach((c) => c.udpClient.close());
        }
      );
      // TODO: Will need FakeTime working to test.
      // test(`aborts when the ptp connection times out`, async () => {});
    });
  });

  describe('lobby messaging', () => {
    test(`all members are informed when one member sends a message`, async () => {
      const { cleanupLobby, host, peers, lobbyId } = await createLobby(3);

      const peerClients = peers.map((p) => p.client);

      const messageReceiveds = [...peerClients, host.client].map((c) =>
        waitForMessage(c, ServerWsMethod.MessageReceived)
      );

      peerClients[0].send(
        encodeWsPacket(ClientWsMethod.Message, {
          lobbyId,
          message: 'Hello, fellow gamers!',
          token: peers[0].token,
        })
      );

      const receivedMessageResults = await Promise.all(messageReceiveds);

      receivedMessageResults.forEach(([, payload]) => {
        assertEquals(payload.message.message, 'Hello, fellow gamers!');
        assertEquals(payload.message.senderName, 'peer 0');
        assert('timestamp' in payload.message);
      });

      await cleanupLobby();
    });
    test(`no message notification is present when a client outside the lobby tries to send a message to it`, async () => {
      const {
        host: { client: hostClient, token: hostToken },
        lobbyId,
        cleanupLobby,
      } = await createLobby();

      const { client, token } = await createClient();

      let messageWasReceived = false;
      waitForMessage(hostClient, ServerWsMethod.MessageReceived).then(() => (messageWasReceived = true));

      client.send(
        encodeWsPacket(ClientWsMethod.Message, {
          lobbyId,
          message: 'Hello, fellow gamers!',
          token: token,
        })
      );

      // For the local test env, 250ms is plenty of time to wait for the
      // server to send the message if it's going to send it. Don't love
      // this, but it's difficult to test for the server NOT doing something.
      assertEquals(
        await new Promise((resolve) =>
          setTimeout(() => {
            resolve(messageWasReceived);
          }, 250)
        ),
        false
      );

      client.close();

      await cleanupLobby();
    });
  });
});

async function createClient(
  url = getWsConnectionUrl(),
  subs?: Partial<Record<WsMethod, <T extends WsMethod>(method: T, payload: WsMessagePayloadMap[T]) => void>>
): Promise<{ client: WebSocket; token: IdToken }> {
  const newClient = new WebSocket(url);

  if (subs) {
    newClient.addEventListener('message', (event) => {
      const [receivedMethod, payload] = decodePacket(event.data);

      const action = subs[receivedMethod as keyof WsMessagePayloadMap];

      action?.(receivedMethod as WsMethod, payload as ValueOf<WsMessagePayloadMap>);
    });
  }

  let token: IdToken;

  newClient.addEventListener('message', (event) => {
    const [receivedMethod, payload] = decodePacket(event.data);

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
      const [receivedMethod, payload] = decodePacket(event.data);

      if (receivedMethod === method) {
        resolve([receivedMethod, payload]);
      }
    });
  });
}

function getHttpConnectionUrl(): string {
  return `http://localhost:${HTTP_PORT + portCounter}`;
}

function getWsConnectionUrl(): string {
  return `ws://localhost:${HTTP_PORT + portCounter}`;
}

/**
 * Utility function that creates a lobby, optionally with joined peers.
 *
 * @param lobbyOptions - Options for creating the lobby
 * @param numPeers - (Optional, defaults to 0) The number of peers to create
 * and have join the lobby.
 *
 * @returns An object with details about the created of the lobby.
 */
async function createLobby(
  numPeers = 0,
  lobbyOptions?: Omit<JoinLobbyPayload, 'token'>
): Promise<{
  host: { client: WebSocket; token: string };
  /**
   * An array of the peers that were added and joined to the lobby.
   * The names of the peers in the joined lobby will be `peer-{index}`.
   * The length of this array is equal to `numPeers`.
   */
  peers: { client: WebSocket; token: string }[];
  lobbyId: string;
  /**
   * Call to cleanup any open connections associated with the lobby.
   */
  cleanupLobby: () => Promise<void>;
}> {
  const { client: hostClient, token: hostToken } = await createClient();

  const hostResponse = await fetch(`${getHttpConnectionUrl()}${CREATE_LOBBY_PATH}`, {
    method: HttpMethod.Post,
    body: JSON.stringify({
      lobbyName: 'My lobby',
      hostName: 'jt',
      isPublic: true,
      maxMembers: numPeers + 1,
      ...lobbyOptions,
      token: hostToken,
    }),
  });

  const { lobbyId } = await hostResponse.json();

  const peerCreationResults = await Promise.all(new Array(numPeers).fill(0).map(() => createClient()));

  const peerJoinResponses = await Promise.all(
    peerCreationResults.map(({ token }, index) => {
      return fetch(`${getHttpConnectionUrl()}${getJoinLobbyPath(lobbyId)}`, {
        method: HttpMethod.Post,
        body: JSON.stringify({
          token: token,
          peerName: `peer ${index}`,
        }),
      });
    })
  );

  return {
    host: {
      client: hostClient,
      token: hostToken,
    },
    peers: peerCreationResults,
    lobbyId,
    cleanupLobby: async () => {
      hostClient.close();

      peerCreationResults.forEach(({ client }) => {
        client.close();
      });

      await cleanupResponses(...peerJoinResponses, hostResponse);
    },
  };
}

async function cleanupResponses(...responses: Response[]) {
  for (const res of responses) {
    if (!res.bodyUsed) {
      await res.body?.cancel();
    }
  }
}
