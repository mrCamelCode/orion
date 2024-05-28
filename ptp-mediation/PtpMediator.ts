import { Event } from '@jtjs/event';
import { Lobby } from '../lobby/Lobby.ts';
import { NetworkClient } from '../network/NetworkClient.ts';
import { PtpDetails, ServerWsMethod } from '../network/network.model.ts';
import { encodeWsPacket, sendToSockets } from '../network/network.util.ts';
import { IdToken } from '../shared/model.ts';
import { PtpMediationOptions } from './ptp-mediation.model.ts';

export class PtpMediator {
  /**
   * Triggered when the mediator aborts the mediation process. This
   * can happen because the process times out or the member list of
   * a lobby changes during the process.
   *
   * The mediator automatically invokes `cleanup` up when it aborts.
   */
  onAbort = new Event<(reason: string) => void>();
  /**
   * Triggered when the mediator is cleaned up. The mediator should be
   * disposed after being cleaned up. You should no longer use the
   * instance.
   */
  onCleanup = new Event<() => void>();
  /**
   * Triggered when the mediator has received network details for
   * all members of the lobby and it's sent out a WS message to all
   * peers to ask them to start connecting to one another.
   */
  onStartingConnection = new Event<() => void>();
  /**
   * Triggered once all members of the lobby have indicated that they've
   * connected to their requisite peers. This event indicates that the
   * mediation has completed.
   *
   * The mediator will automatically clean itself up in this situation.
   */
  onSuccess = new Event<() => void>();

  #lobby: Lobby;
  #udpPort: number;

  #networkClientToPtpDetails: Record<IdToken, PtpDetails> = {};
  #networkClientsWithSuccessfulConnectionToPeers: Set<IdToken> = new Set();

  #connectPacketInterval: ReturnType<typeof setInterval> | undefined;
  #connectTimeout: ReturnType<typeof setTimeout> | undefined;
  #ptpConnectTimeout: ReturnType<typeof setTimeout> | undefined;

  #connectTimeoutMs: number;
  #connectRequestIntervalMs: number;

  #ptpConnectTimeoutMs: number;

  get #uncapturedClients(): NetworkClient[] {
    const allClients = this.#lobby.members.map((member) => member.networkClient);
    const capturedClientTokens = Object.keys(this.#networkClientToPtpDetails);

    return allClients.filter((networkClient) => !capturedClientTokens.includes(networkClient.token));
  }

  /**
   * @param lobby - The lobby that contains the clients that this mediator
   * is trying to facilitate communication for.
   */
  constructor(
    lobby: Lobby,
    udpPort: number,
    {
      serverConnectTimeoutMs = 5 * 60 * 1000,
      connectRequestIntervalMs = 10 * 1000,
      ptpConnectTimeoutMs = 5 * 60 * 1000,
    }: PtpMediationOptions = {}
  ) {
    this.#lobby = lobby;
    this.#udpPort = udpPort;
    this.#connectTimeoutMs = serverConnectTimeoutMs;
    this.#connectRequestIntervalMs = connectRequestIntervalMs;
    this.#ptpConnectTimeoutMs = ptpConnectTimeoutMs;
  }

  start() {
    this.#lobby.members.forEach((member) => {
      this.#requestConnectPacket(member.networkClient);
    });

    this.#connectPacketInterval = setInterval(() => {
      this.#uncapturedClients.forEach((client) => {
        this.#requestConnectPacket(client);
      });
    }, this.#connectRequestIntervalMs);

    this.#connectTimeout = setTimeout(() => {
      this.#abort('Peer-to-peer Mediation timed out waiting for peers to send UDP packets to server.');
    }, this.#connectTimeoutMs);

    const handleLobbyMemberChange = () => {
      this.#abort('Lobby members changed.');
    };

    this.#lobby.onMemberRemoved.subscribe(handleLobbyMemberChange);
    this.#lobby.onMemberAdded.subscribe(handleLobbyMemberChange);
  }

  addDetailsForNetworkClient(networkClient: NetworkClient, details: PtpDetails) {
    this.#networkClientToPtpDetails[networkClient.token] = details;

    if (this.#haveAllPeersSharedConnectionDetailsWithServer()) {
      this.#requestStartPeerConnection();
    }
  }

  indicateSuccessfulPeerConnectionForNetworkClient(networkClient: NetworkClient) {
    this.#networkClientsWithSuccessfulConnectionToPeers.add(networkClient.token);

    if (this.#haveAllPeersConnectedToOneAnother()) {
      this.#success();
    }
  }

  cleanup() {
    clearInterval(this.#connectPacketInterval);
    clearTimeout(this.#connectTimeout);
    clearTimeout(this.#ptpConnectTimeout);

    this.#networkClientToPtpDetails = {};
    this.#networkClientsWithSuccessfulConnectionToPeers = new Set();

    this.onCleanup.trigger();
  }

  #abort(reason: string) {
    this.cleanup();

    this.onAbort.trigger(reason);
  }

  #success() {
    this.cleanup();

    this.onSuccess.trigger();
  }

  /**
   * Requests via WS that the client send a UDP packet so the mediator
   * can capture their network details.
   *
   * @param networkClient - The client to ask.
   */
  #requestConnectPacket(networkClient: NetworkClient) {
    sendToSockets(
      encodeWsPacket(ServerWsMethod.SendPtpPacket, {
        port: this.#udpPort,
      }),
      networkClient.socket
    );
  }

  #requestStartPeerConnection() {
    clearInterval(this.#connectRequestIntervalMs);
    clearTimeout(this.#connectTimeout);

    sendToSockets(
      encodeWsPacket(ServerWsMethod.StartPeerConnection, {
        peers: this.#lobby
          .otherMembers(this.#lobby.host)
          .map((nonHostMember) => this.#networkClientToPtpDetails[nonHostMember.networkClient.token]),
      }),
      this.#lobby.host.networkClient.socket
    );

    sendToSockets(
      encodeWsPacket(ServerWsMethod.StartPeerConnection, {
        peers: [this.#networkClientToPtpDetails[this.#lobby.host.networkClient.token]],
      }),
      ...this.#lobby.otherMembers(this.#lobby.host).map((nonHostMembers) => nonHostMembers.networkClient.socket)
    );

    this.#ptpConnectTimeout = setTimeout(() => {
      this.#abort('Peer-to-peer Mediation timed out waiting for peers to connect to one another.');
    }, this.#ptpConnectTimeoutMs);

    this.onStartingConnection.trigger();
  }

  #haveAllPeersSharedConnectionDetailsWithServer(): boolean {
    const connectedClientTokens = Object.keys(this.#networkClientToPtpDetails);

    return this.#lobby.members.every((member) => connectedClientTokens.includes(member.networkClient.token));
  }

  #haveAllPeersConnectedToOneAnother(): boolean {
    return this.#lobby.members.every((member) =>
      this.#networkClientsWithSuccessfulConnectionToPeers.has(member.networkClient.token)
    );
  }
}
