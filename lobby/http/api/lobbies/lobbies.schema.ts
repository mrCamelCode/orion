import z from 'zod';
import { registeredClientPayloadSchema } from '../../../model/shared.schema.ts';
import { nameRegex } from '../../../validation/validation.patterns.ts';

export enum LobbiesFunction {
  GetPublicLobbies = 'getPublicLobbies',
  CreateLobby = 'createLobby',
  JoinLobby = 'joinLobby',
  StartPtpMediation = 'startPtpMediation',
}

export const lobbiesSchemata = {
  [LobbiesFunction.CreateLobby]: {
    body: registeredClientPayloadSchema.merge(
      z.object({
        hostName: z.string().max(50).regex(nameRegex, 'Host name cannot be only spaces and must be alphanumeric.'),
        lobbyName: z.string().max(50).regex(nameRegex, 'Lobby name cannot be only spaces and must be alphanumeric.'),
        isPublic: z.boolean(),
        maxMembers: z.number().min(1).max(64),
      })
    ),
  },
  [LobbiesFunction.JoinLobby]: {
    body: registeredClientPayloadSchema.merge(
      z.object({
        peerName: z.string().max(50).regex(nameRegex, 'Peer name cannot be only spaces and must be alphanumeric.'),
      })
    ),
  },
  [LobbiesFunction.StartPtpMediation]: {
    body: registeredClientPayloadSchema,
  },
};

type LobbiesSchemata = typeof lobbiesSchemata;

export type CreateLobbyPayload = z.infer<LobbiesSchemata[LobbiesFunction.CreateLobby]['body']>;
export type JoinLobbyPayload = z.infer<LobbiesSchemata[LobbiesFunction.JoinLobby]['body']>;
export type StartPtpMediationPayload = z.infer<LobbiesSchemata[LobbiesFunction.StartPtpMediation]['body']>;
