import { Registry } from '../shared/Registry.abstract.ts';
import { Lobby } from './Lobby.ts';

export class LobbyRegistry extends Registry<Lobby> {
  constructor() {
    super();
  }

  protected override getNextId(): string {
    throw new Error('TODO: Implement with 5-digit base-36 number.');
  }
}
