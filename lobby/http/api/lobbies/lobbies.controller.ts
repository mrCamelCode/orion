import { Controller, JsonResponse, RequestHandler } from 'potami';
import { logger } from '../../../../logging/Logger.ts';
import { NetworkClientRegistry } from '../../../../network/NetworkClientRegistry.ts';
import { LobbyRegistry } from '../../../LobbyRegistry.ts';
import { ErrorResponse } from '../../responses/error.response.ts';
import { validateAgainstSchema } from '../../validation/validate-schema.ts';
import {
  CreateLobbyPayload,
  JoinLobbyPayload,
  LobbiesFunction,
  StartPtpMediationPayload,
  lobbiesSchemata,
} from './lobbies.schema.ts';
import { LobbiesService } from './lobbies.service.ts';

export class LobbiesController extends Controller {
  #networkClientRegistry: NetworkClientRegistry;
  #lobbiesService: LobbiesService;

  constructor(lobbyRegistry: LobbyRegistry, networkClientRegistry: NetworkClientRegistry) {
    super({ base: '/lobbies' });

    this.#lobbiesService = new LobbiesService(lobbyRegistry);
    this.#networkClientRegistry = networkClientRegistry;
  }

  'GET /': RequestHandler = () => {
    return new JsonResponse(
      {
        lobbies: this.#lobbiesService.getAllPublicLobbies(),
      },
      { status: 200 }
    );
  };
  'POST /': RequestHandler = async (req) => {
    const json = await req.json();

    validateAgainstSchema(req, json, lobbiesSchemata[LobbiesFunction.CreateLobby]);

    const { hostName, isPublic, lobbyName, maxMembers, token } = json as CreateLobbyPayload;
    const { item: networkClient, id: networkClientId } = this.#networkClientRegistry.getByToken(token) ?? {};

    if (networkClient) {
      try {
        const { lobbyName: newLobbyName, lobbyId: newLobbyId } = this.#lobbiesService.createLobby(
          networkClient,
          hostName,
          lobbyName,
          isPublic,
          maxMembers
        );

        logger.info(`Client ${networkClientId} is now the host of a new lobby with ID ${newLobbyId}`);

        return new JsonResponse(
          {
            lobbyName: newLobbyName,
            lobbyId: newLobbyId,
          },
          { status: 201 }
        );
      } catch (err) {
        return new ErrorResponse({ status: 409, errors: [`${err}`] });
      }
    } else {
      logger.warn('Unregistered client attempted to host a lobby.');

      return new ErrorResponse({ errors: [`The client is unregistered. Try reconnecting.`] });
    }
  };

  'POST /:lobbyId/join': RequestHandler = async (req, { lobbyId }) => {
    const json = await req.json();

    validateAgainstSchema(req, json, lobbiesSchemata[LobbiesFunction.JoinLobby]);

    const { peerName, token } = json as JoinLobbyPayload;
    const { item: networkClient, id: networkClientId } = this.#networkClientRegistry.getByToken(token) ?? {};

    if (networkClient) {
      try {
        const joinResult = this.#lobbiesService.joinLobby(networkClient, lobbyId, peerName);

        logger.info(`Client ${networkClientId} successfully joined lobby ${lobbyId}.`);

        return new JsonResponse(joinResult, { status: 200 });
      } catch (err) {
        return new ErrorResponse({ status: 409, errors: [`${err}`] });
      }
    } else {
      logger.warn(`Unregistered client attempted to join lobby ${lobbyId}.`);

      return new ErrorResponse({ errors: [`The client is unregistered. Try reconnecting.`] });
    }
  };

  'POST /:lobbyId/ptp/start': RequestHandler = async (req, { lobbyId }) => {
    const json = await req.json();

    validateAgainstSchema(req, json, lobbiesSchemata[LobbiesFunction.StartPtpMediation]);

    const { token } = json as StartPtpMediationPayload;

    const { item: networkClient, id: networkClientId } = this.#networkClientRegistry.getByToken(token) ?? {};

    if (networkClient) {
      try {
        this.#lobbiesService.startPtpMediation(networkClient, lobbyId);

        logger.info(`Client ${networkClientId} started PTP Mediation on lobby ${lobbyId}.`);

        return new Response(undefined, { status: 200 });
      } catch (err) {
        return new ErrorResponse({ status: 409, errors: [`${err}`] });
      }
    } else {
      logger.warn(`Unregistered client attempted to start PTP Mediation on lobby ${lobbyId}.`);

      return new ErrorResponse({ errors: [`The client is unregistered. Try reconnecting.`] });
    }
  };
}
