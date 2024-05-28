export interface PtpMediationOptions {
  /**
   * (Defaults to 5 minutes) How long the mediator should try to get all the lobby clients'
   * network details before it gives up.
   */
  serverConnectTimeoutMs?: number;
  /**
   * (Defaults to 10 seconds) How long the mediator will wait before
   * sending another WS message asking that the client send a UDP packet for
   * connection. The mediator will only send these "reminder" requests to clients
   * whose information it hasn't yet captured. This serves as a retry to protect
   * against the unreliability of UDP.
   */
  connectRequestIntervalMs?: number;
  /**
   * (Defaults to 5 minutes) How long the mediator should wait for the peers to
   * try connecting to one another. If the mediator doesn't receive a connection success message from all
   * the peers in this time, the process times out.
   */
  ptpConnectTimeoutMs?: number;
}
