import { ItemRegisteredHandler, ItemRemovedHandler, RegisteredItem, Registry } from '../shared/Registry.abstract.ts';
import { IdToken } from '../shared/model.ts';
import { NetworkClient } from './NetworkClient.ts';

export class NetworkClientRegistry extends Registry<NetworkClient> {
  #tokenToClientMapping: Record<string, string> = {};

  constructor() {
    super();

    this.onItemRegistered.subscribe(this.#handleItemRegistered);
    this.onItemRemoved.subscribe(this.#handleItemRemoved);
  }

  getBySocket(socket: WebSocket): RegisteredItem<NetworkClient> | undefined {
    return this.getBy(({ item }) => item.socket === socket);
  }

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

  cleanup() {
    Object.values(this.items).forEach((networkClient) => {
      const socket = networkClient.item.socket;

      if (![socket.CLOSING, socket.CLOSED].includes(socket.readyState)) {
        networkClient.item.socket.close();
      }
    });

    this.#tokenToClientMapping = {};
    this.items = {};
  }

  #handleItemRegistered: ItemRegisteredHandler<NetworkClient> = (item) => {
    this.#tokenToClientMapping[item.item.token] = item.id;
  };

  #handleItemRemoved: ItemRemovedHandler<NetworkClient> = (item) => {
    delete this.#tokenToClientMapping[item.item.token];
  };
}
