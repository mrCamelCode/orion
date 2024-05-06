import { IdToken } from "../shared/model.ts";

export class NetworkClient {
  public readonly token: IdToken;

  constructor(public readonly socket: WebSocket) {
    this.token = crypto.randomUUID();
  }
}
