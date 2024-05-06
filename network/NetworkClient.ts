export class NetworkClient {
  public readonly token: string;

  constructor(public readonly socket: WebSocket) {
    this.token = crypto.randomUUID();
  }
}
