import { LobbyClient } from './LobbyClient.ts';

export class Lobby {
  #members: LobbyClient[] = [];

  get members(): LobbyClient[] {
    return [...this.#members];
  }

  constructor(public readonly name: string, public readonly host: LobbyClient) {
    this.members.push(host);
  }

  /**
   * @param memberToExclude
   *
   * @returns All the members of the lobby, without `memberToExclude`.
   */
  otherMembers(memberToExclude: LobbyClient): LobbyClient[] {
    return this.#members.filter((member) => member.networkClient.token !== memberToExclude.networkClient.token);
  }

  addMember(member: LobbyClient) {
    if (!this.isMemberInLobby(member)) {
      this.#members.push(member);
    }
  }

  removeMember(member: LobbyClient) {
    this.#members = this.#members.filter((existingMember) => !this.#doLobbyClientsMatch(existingMember, member));
  }

  isMemberHost(member: LobbyClient): boolean {
    return this.#members.find((existingMember) => this.#doLobbyClientsMatch(existingMember, member)) === this.host;
  }

  isMemberInLobby(member: LobbyClient): boolean {
    return this.#members.some((existingMember) => this.#doLobbyClientsMatch(existingMember, member));
  }

  #doLobbyClientsMatch(a: LobbyClient, b: LobbyClient): boolean {
    return a.networkClient.token === b.networkClient.token;
  }
}
