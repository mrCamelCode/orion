import { z } from 'zod';

export type Datagram = Awaited<ReturnType<Deno.DatagramConn['receive']>>;
export type DecodedDatagram = { method: string; payload: Record<string, any>; address: Deno.NetAddr };

/**
 * Describes the possible datagrams that can come from clients.
 */
export enum ClientDatagramMethod {
  PtpMediationConnect = 'ptpMediation_connect',
}

export const clientDatagramPayloadSchemaMap = {
  [ClientDatagramMethod.PtpMediationConnect]: z.object({
    token: z.string(),
  }),
};

const clientDatagramPayloadSchemaMapSchema = z.object(clientDatagramPayloadSchemaMap);

export type ClientDatagramPayloadMap = z.infer<typeof clientDatagramPayloadSchemaMapSchema>;
