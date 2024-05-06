import { RegisteredItem, Registry } from '../shared/Registry.abstract.ts';
import { IdToken } from '../shared/model.ts';
import { NetworkClient } from './NetworkClient.ts';

export class NetworkClientRegistry extends Registry<NetworkClient> {
  #tokenToClientMapping: Record<string, string> = {};

  /**
   * @param token - The network client's identity token.
   *
   * @returns The network client, if a client with the corresponding token was found,
   * `undefined` otherwise.
   */
  getByToken(token: IdToken): RegisteredItem<NetworkClient> | undefined {
    const id = this.#tokenToClientMapping[token];

    return this.getById(id);
  }

  override register(item: NetworkClient): RegisteredItem<NetworkClient> {
    const registeredItem = super.register(item);

    this.#tokenToClientMapping[registeredItem.item.token] = registeredItem.id;

    return registeredItem;
  }

  override removeById(id: string): void {
    const currentItem = this.getById(id);

    if (currentItem) {
      delete this.#tokenToClientMapping[currentItem.item.token];
    }

    super.removeById(id);
  }
}
