import { NetworkClient } from '../../../../network/NetworkClient.ts';
import { Lobby } from '../../../Lobby.ts';
import { LobbyClient } from '../../../LobbyClient.ts';
import { LobbyRegistry } from '../../../LobbyRegistry.ts';

export class LobbiesService {
  #lobbyRegistry: LobbyRegistry;

  constructor(lobbyRegistry: LobbyRegistry) {
    this.#lobbyRegistry = lobbyRegistry;
  }

  getAllPublicLobbies() {
    return this.#lobbyRegistry.registeredItems
      .filter((registeredLobby) => registeredLobby.item.isPublic)
      .map(({ item: lobby, id }) => {
        return {
          name: lobby.name,
          id,
          currentMembers: lobby.numMembers,
          maxMembers: lobby.maxMembers,
        };
      });
  }

  /**
   *
   * @param networkClient
   * @param hostName
   * @param lobbyName
   * @param isPublic
   * @param maxMembers
   *
   * @throws {Error} if the `networkClient` is already in a lobby.
   */
  createLobby(
    networkClient: NetworkClient,
    hostName: string,
    lobbyName: string,
    isPublic: boolean,
    maxMembers: number
  ) {
    if (this.#lobbyRegistry.isNetworkClientInLobby(networkClient)) {
      throw new Error(`The client is already in a lobby and cannot be the host of a new lobby.`);
    }

    const hostLobbyClient = new LobbyClient(hostName, networkClient);

    const { item: newLobby, id: newLobbyId } = this.#lobbyRegistry.register(
      new Lobby(lobbyName, hostLobbyClient, maxMembers, isPublic)
    );

    return {
      lobbyName: newLobby.name,
      lobbyId: newLobbyId,
    };
  }

  joinLobby(networkClient: NetworkClient, lobbyId: string, peerName: string) {
    if (this.#lobbyRegistry.isNetworkClientInLobby(networkClient)) {
      throw new Error(`The client is already in a lobby and cannot join another.`);
    } else {
      const { item: lobby } = this.#lobbyRegistry.getById(lobbyId) ?? {};

      if (lobby) {
        if (lobby.isFull) {
          throw new Error(`The lobby is full.`);
        } else if (lobby.members.some((member) => member.name === peerName)) {
          throw new Error(`The requested name is taken.`);
        } else {
          const peerLobbyClient = new LobbyClient(peerName, networkClient);

          const addSucceeded = this.#lobbyRegistry.addMemberToLobby(lobbyId, peerLobbyClient);

          if (addSucceeded) {
            return {
              lobbyId,
              lobbyName: lobby.name,
              lobbyMembers: lobby.members.map((member) => member.name),
              host: lobby.host.name,
            };
          } else {
            throw new Error(`The lobby is full or the client is already in the lobby.`);
          }
        }
      } else {
        throw new Error(`Lobby ${lobbyId} doesn't exist.`);
      }
    }
  }
}
