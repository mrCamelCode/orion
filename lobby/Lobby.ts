import { LobbyClient } from './LobbyClient.ts';

export class Lobby {
  #members: LobbyClient[] = [];

  get members(): LobbyClient[] {
    return [...this.#members];
  }

  get numMembers(): number {
    return this.#members.length;
  }

  get isFull(): boolean {
    return this.numMembers >= this.maxMembers;
  }

  constructor(
    public readonly name: string,
    public readonly host: LobbyClient,
    public readonly maxMembers: number,
    /**
     * Whether a Lobby is public doesn't prevent other people from joining it,
     * but it does limit visibility. Private lobbies shouldn't be exposed to clients
     * that ask the server for all available lobbies.
     */
    public readonly isPublic = false
  ) {
    this.#members.push(host);
  }

  /**
   * @param memberToExclude
   *
   * @returns All the members of the lobby, without `memberToExclude`.
   */
  otherMembers(memberToExclude: LobbyClient): LobbyClient[] {
    return this.#members.filter((member) => member.networkClient.token !== memberToExclude.networkClient.token);
  }

  /**
   * Attempts to add a member to the lobby.
   *
   * @param member - The member to add.
   *
   * @returns Whether the member was added. Addition fails if the lobby
   * is at capacity or the member is already in the lobby.
   */
  addMember(member: LobbyClient): boolean {
    if (!this.isMember(member) && !this.isFull) {
      this.#members.push(member);

      return true;
    }

    return false;
  }

  removeMember(member: LobbyClient) {
    this.#members = this.#members.filter((existingMember) => !this.#doLobbyClientsMatch(existingMember, member));
  }

  isHost(member: LobbyClient): boolean {
    return this.#members.find((existingMember) => this.#doLobbyClientsMatch(existingMember, member)) === this.host;
  }

  isMember(member: LobbyClient): boolean {
    return this.#members.some((existingMember) => this.#doLobbyClientsMatch(existingMember, member));
  }

  #doLobbyClientsMatch(a: LobbyClient, b: LobbyClient): boolean {
    return a.networkClient.token === b.networkClient.token;
  }
}
