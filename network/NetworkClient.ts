import { IdToken } from '../shared/model.ts';

export class NetworkClient {
  /**
   * Unique the client and is generated upong construction.
   * This identifies the user and should be considered a secret.
   */
  public readonly token: IdToken;

  constructor(public readonly socket: WebSocket) {
    this.token = crypto.randomUUID();
  }
}
