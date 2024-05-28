import { logger } from '../logging/Logger.ts';
import { NetworkClient } from '../network/NetworkClient.ts';
import { ServerWsMethod } from '../network/network.model.ts';
import { encodeWsPacket, sendToSockets } from '../network/network.util.ts';
import { PtpMediator } from '../ptp-mediation/PtpMediator.ts';
import { PtpMediationOptions } from '../ptp-mediation/ptp-mediation.model.ts';
import { ItemRegisteredHandler, ItemRemovedHandler, Registry } from '../shared/Registry.abstract.ts';
import { IdToken } from '../shared/model.ts';
import { generateBase36Id } from '../util/util.ts';
import { Lobby } from './Lobby.ts';
import { LobbyClient } from './LobbyClient.ts';

export class LobbyRegistry extends Registry<Lobby> {
  /**
   * Maps network client tokens to the ID of the lobby that client's in.
   */
  #networkClientToLobbyMapping: Record<IdToken, string> = {};
  #lobbyIdToPtpMediator: Record<string, PtpMediator> = {};

  /**
   * The port the server is using for UDP messages.
   */
  #udpPort: number;

  #ptpMediationOptions: PtpMediationOptions | undefined;

  constructor(udpPort: number, ptpMediationOptions: PtpMediationOptions = {}) {
    super();

    this.#udpPort = udpPort;
    this.#ptpMediationOptions = ptpMediationOptions;

    this.onItemRegistered.subscribe(this.#handleItemRegistered);
    this.onItemRemoved.subscribe(this.#handleItemRemoved);
  }

  /**
   * Adds the specified client to the lobby, if the lobby exists and it's not already at its max member amount.
   *
   * If there are other members already in the lobby, all other
   * members are notified of a new peer connecting.
   *
   * @param lobbyId - The ID of the lobby to add the new member to.
   * @param lobbyClient - The new member to add.
   */
  addMemberToLobby(lobbyId: string, lobbyClient: LobbyClient): boolean {
    const { item: lobby } = this.getById(lobbyId) ?? {};

    if (lobby && !lobby.isMember(lobbyClient) && lobby.numMembers < lobby.maxMembers) {
      const addSucceeded = lobby.addMember(lobbyClient);

      if (addSucceeded) {
        this.#networkClientToLobbyMapping[lobbyClient.networkClient.token] = lobbyId;

        const membersToNotify = lobby.otherMembers(lobbyClient);

        sendToSockets(
          encodeWsPacket(ServerWsMethod.PeerConnected, {
            peerName: lobbyClient.name,
            lobbyId,
          }),
          ...getSocketsFromLobbyClients(membersToNotify)
        );
      }

      return addSucceeded;
    }

    return false;
  }

  /**
   * Removes the specified client from the specified lobby if the lobby exists
   * and the client is in it.
   *
   * If the client to remove is the host of the lobby, the lobby is fully destroyed.
   * It's removed from the registry and all peers currently in the lobby are informed
   * that the host left. All clients in the lobby are freed from association to a lobby.
   *
   * If the client to remove is NOT the host of the lobby, the client is removed
   * from the lobby, and all the other members of the lobby are informed of the
   * departure.
   *
   * @param lobbyId - The ID of the lobby to remove the member from.
   * @param lobbyClient - The client to remove.
   */
  removeMemberFromLobby(lobbyId: string, lobbyClient: LobbyClient) {
    const { item: lobby } = this.getById(lobbyId) ?? {};

    if (lobby && lobby.isMember(lobbyClient)) {
      const isHost = lobby.isHost(lobbyClient);

      if (isHost) {
        logger.info(`The host is being removed from lobby ${lobbyId}. The lobby will be closed.`);

        this.removeById(lobbyId);
      } else {
        const membersToNotify = lobby.otherMembers(lobbyClient);

        sendToSockets(
          encodeWsPacket(ServerWsMethod.PeerDisconnected, {
            peerName: lobbyClient.name,
            lobbyId,
          }),
          ...getSocketsFromLobbyClients(membersToNotify)
        );
      }

      lobby.removeMember(lobbyClient);

      delete this.#networkClientToLobbyMapping[lobbyClient.networkClient.token];
    }
  }

  /**
   * Cleans the network client out of the lobby registry. The client will be
   * removed from the lobby they're in if they're in one. Peers will be notified of
   * the departure. If the client is hosting a lobby, that lobby is closed completely
   * and any peers are informed that the lobby closed.
   *
   * @param networkClient - The network client to clean up from lobbies.
   */
  cleanupNetworkClient(networkClient: NetworkClient) {
    const lobbyId = this.#networkClientToLobbyMapping[networkClient.token];

    if (lobbyId) {
      const lobbyClient = this.getLobbyClientFromNetworkClient(networkClient);

      if (this.has(lobbyId) && lobbyClient) {
        this.removeMemberFromLobby(lobbyId, lobbyClient);
      }
    }
  }

  /**
   * @param networkClient
   *
   * @returns Whether the specified client is the host or a member of any active lobbies.
   */
  isNetworkClientInLobby(networkClient: NetworkClient): boolean {
    return !!this.#networkClientToLobbyMapping[networkClient.token];
  }

  getLobbyClientFromNetworkClient(networkClient: NetworkClient): LobbyClient | undefined {
    const lobby = this.getLobbyFromNetworkClient(networkClient);

    return lobby?.members.find((member) => member.networkClient.token === networkClient.token);
  }

  getLobbyFromNetworkClient(networkClient: NetworkClient): Lobby | undefined {
    const lobbyId = this.#networkClientToLobbyMapping[networkClient.token];
    if (lobbyId) {
      return this.getById(lobbyId)?.item;
    }
  }

  startPtpMediationForLobby(lobbyId: string) {
    if (lobbyId && this.has(lobbyId) && !this.#lobbyIdToPtpMediator[lobbyId]) {
      const { item: lobby } = this.getById(lobbyId)!;

      const mediator = new PtpMediator(lobby, this.#udpPort, this.#ptpMediationOptions);

      this.#lobbyIdToPtpMediator[lobbyId] = mediator;

      mediator.onSuccess.subscribe(() => {
        logger.info(
          `All peers of lobby ${lobbyId} have indicated that they've successfully connected to one another. ` +
            `The lobby will now auto-close.`
        );

        sendToSockets(
          encodeWsPacket(ServerWsMethod.PtpMediationSuccessful, {}),
          ...lobby.members.map((m) => m.networkClient.socket)
        );

        this.removeById(lobbyId);
      });
      mediator.onCleanup.subscribe(() => {
        delete this.#lobbyIdToPtpMediator[lobbyId];
        lobby.unlock();
      });
      mediator.onAbort.subscribe((reason) => {
        logger.warn(`PTP Mediation on lobby ${lobbyId} is being aborted for reason: ${reason}`);

        sendToSockets(
          encodeWsPacket(ServerWsMethod.PtpMediationAborted, {
            abortReason: reason,
          }),
          ...lobby.members.map((m) => m.networkClient.socket)
        );
      });
      mediator.onStartingConnection.subscribe(() => {
        logger.info(
          `All peers of lobby ${lobbyId} provided network details. ` +
            `Peers have been asked to start peer-to-peer connection.`
        );
      });

      lobby.lock();
      mediator.start();
    }
  }

  handlePtpMediationConnect(address: Deno.NetAddr, networkClient: NetworkClient) {
    const mediator = this.#getPtpMediatorFromNetworkClient(networkClient);

    if (mediator) {
      mediator.addDetailsForNetworkClient(networkClient, {
        ip: address.hostname,
        port: address.port,
      });
    }
  }

  handlePtpMediationPeerConnectSuccess(networkClient: NetworkClient) {
    const mediator = this.#getPtpMediatorFromNetworkClient(networkClient);

    if (mediator) {
      mediator.indicateSuccessfulPeerConnectionForNetworkClient(networkClient);
    }
  }

  isMediatingPtpForLobby(lobbyId: string): boolean {
    return !!this.#lobbyIdToPtpMediator[lobbyId];
  }

  cleanup() {
    Object.values(this.#lobbyIdToPtpMediator).forEach((mediator) => {
      mediator.cleanup();
    });

    this.#lobbyIdToPtpMediator = {};
    this.#networkClientToLobbyMapping = {};
    this.items = {};
  }

  protected override getNextId(): string {
    return generateBase36Id(5);
  }

  #handleItemRegistered: ItemRegisteredHandler<Lobby> = (item) => {
    const { item: lobby, id: lobbyId } = item;

    this.#networkClientToLobbyMapping[lobby.host.networkClient.token] = lobbyId;
  };

  #handleItemRemoved: ItemRemovedHandler<Lobby> = (item) => {
    const { item: removedLobby, id: removedLobbyId } = item;

    this.#networkClientToLobbyMapping = Object.fromEntries(
      Object.entries(this.#networkClientToLobbyMapping).filter(([, lobbyId]) => lobbyId !== removedLobbyId)
    );

    const ptpMediator = this.#lobbyIdToPtpMediator[removedLobbyId];
    if (ptpMediator) {
      ptpMediator.cleanup();

      delete this.#lobbyIdToPtpMediator[removedLobbyId];
    }

    const members = removedLobby.members;

    sendToSockets(
      encodeWsPacket(ServerWsMethod.LobbyClosed, {
        lobbyName: removedLobby.name,
        lobbyId: removedLobbyId,
      }),
      ...getSocketsFromLobbyClients(members)
    );
  };

  #getPtpMediatorFromNetworkClient(networkClient: NetworkClient): PtpMediator | undefined {
    const lobbyId = this.#networkClientToLobbyMapping[networkClient.token];

    return lobbyId && this.has(lobbyId) ? this.#lobbyIdToPtpMediator[lobbyId] : undefined;
  }
}

function getSocketsFromLobbyClients(clients: LobbyClient[]) {
  return clients.map((client) => client.networkClient.socket);
}
