import { logger } from '../../logging/Logger.ts';
import { NetworkClientRegistry } from '../../network/NetworkClientRegistry.ts';
import { decodePacket } from '../../network/network.util.ts';
import { LobbyRegistry } from '../LobbyRegistry.ts';
import {
  ClientDatagramMethod,
  ClientDatagramPayloadMap,
  Datagram,
  clientDatagramPayloadSchemaMap,
} from './udp.model.ts';

export class UdpHandler {
  #lobbyRegistry: LobbyRegistry;
  #networkClientRegistry: NetworkClientRegistry;

  constructor(lobbyRegistry: LobbyRegistry, networkClientRegistry: NetworkClientRegistry) {
    this.#lobbyRegistry = lobbyRegistry;
    this.#networkClientRegistry = networkClientRegistry;
  }

  handle(datagram: Datagram) {
    const [packet, address] = datagram;

    const [method, payload] = decodePacket(new TextDecoder().decode(packet));

    const allowedMethods: string[] = Object.values(ClientDatagramMethod);

    if (allowedMethods.includes(method)) {
      const { success } = clientDatagramPayloadSchemaMap[method as ClientDatagramMethod].safeParse(payload);

      if (success) {
        switch (method as ClientDatagramMethod) {
          case ClientDatagramMethod.PtpMediationConnect: {
            const { token } = payload as ClientDatagramPayloadMap[ClientDatagramMethod.PtpMediationConnect];

            const { item: networkClient } = this.#networkClientRegistry.getByToken(token) ?? {};

            if (networkClient) {
              this.#lobbyRegistry.handlePtpMediationConnect(address as Deno.NetAddr, networkClient);
            } else {
              logger.warn(`Received ${method} datagram that had an unknown token.`);
            }

            break;
          }
        }
      } else {
        logger.warn(`Received ${method} datagram that failed schema validation.`);
      }
    } else {
      logger.warn(`Received datagram with invalid method: ${method}`);
    }
  }
}
