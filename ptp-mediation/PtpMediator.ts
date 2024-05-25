import { Event } from '@jtjs/event';
import { Lobby } from '../lobby/Lobby.ts';
import { NetworkClient } from '../network/NetworkClient.ts';
import { ServerWsMethod } from '../network/network.model.ts';
import { encodePacket, sendToSockets } from '../network/network.util.ts';
import { IdToken } from '../shared/model.ts';

export interface PtpDetails {
  ip: string;
  port: number;
}

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

  #lobby: Lobby;
  #udpPort: number;
  #networkClientToPtpDetails: Record<IdToken, PtpDetails> = {};
  #connectPacketInterval: ReturnType<typeof setInterval> | undefined;
  #connectTimeout: ReturnType<typeof setTimeout> | undefined;

  #connectTimeoutMs: number;
  #connectRequestIntervalMs: number;

  get #uncapturedClients(): NetworkClient[] {
    const allClients = this.#lobby.members.map((member) => member.networkClient);
    const capturedClientTokens = Object.keys(this.#networkClientToPtpDetails);

    return allClients.filter((networkClient) => !capturedClientTokens.includes(networkClient.token));
  }

  /**
   * @param lobby - The lobby that contains the clients that this mediator
   * is trying to facilitate communication for.
   * @param timeoutMs - (Defaults to 5 minutes) How long the mediator should try to get all the lobby clients'
   * network details before it gives up.
   * @param connectRequestIntervalMs - (Defaults to 10 seconds) How long the mediator will wait before
   * sending another WS message asking that the client send a UDP packet for
   * connection. The mediator will only send these "reminder" requests to clients
   * whose information it hasn't yet captured. This serves as a retry to protect
   * against the unreliability of UDP.
   */
  constructor(lobby: Lobby, udpPort: number, timeoutMs = 5 * 60 * 1000, connectRequestIntervalMs = 10 * 1000) {
    this.#lobby = lobby;
    this.#udpPort = udpPort;
    this.#connectTimeoutMs = timeoutMs;
    this.#connectRequestIntervalMs = connectRequestIntervalMs;
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
      this.#abort('Peer-to-peer Mediation timed out.');
    }, this.#connectTimeoutMs);

    const handleLobbyMemberChange = () => {
      this.#abort('Lobby members changed.');
    };

    this.#lobby.onMemberRemoved.subscribe(handleLobbyMemberChange);
    this.#lobby.onMemberAdded.subscribe(handleLobbyMemberChange);
  }

  addDetailsForNetworkClient(networkClient: NetworkClient, details: PtpDetails) {
    this.#networkClientToPtpDetails[networkClient.token] = details;
  }

  cleanup() {
    clearInterval(this.#connectPacketInterval);
    clearTimeout(this.#connectTimeout);

    this.#networkClientToPtpDetails = {};

    this.onCleanup.trigger();
  }

  #abort(reason: string) {
    this.onAbort.trigger(reason);
    this.cleanup();
  }

  /**
   * Requests via WS that the client send a UDP packet so the mediator
   * can capture their network details.
   *
   * @param networkClient - The client to ask.
   */
  #requestConnectPacket(networkClient: NetworkClient) {
    sendToSockets(
      encodePacket(ServerWsMethod.SendPtpPacket, {
        port: this.#udpPort,
      }),
      networkClient.socket
    );
  }
}
