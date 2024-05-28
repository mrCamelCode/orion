import { parseArgs } from 'parseArgs';
import { LobbyServer } from './lobby/LobbyServer.ts';

const { ptpmServerConnectTimeoutMs, ptpmConnectRequestIntervalMs, ptpmConnectTimeoutMs } = parseArgs(Deno.args);

const server = new LobbyServer({
  serverConnectTimeoutMs: asNum(ptpmServerConnectTimeoutMs),
  connectRequestIntervalMs: asNum(ptpmConnectRequestIntervalMs),
  ptpConnectTimeoutMs: asNum(ptpmConnectTimeoutMs),
});

server.start();

function asNum(num: any): number | undefined {
  const n = +num;

  return isNaN(n) ? undefined : n;
}
