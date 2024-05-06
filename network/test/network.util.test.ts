import { assert, assertEquals } from 'assert';
import { describe, test } from 'bdd';
import { ServerWsMethod } from '../../lobby/lobby.model.ts';
import { decodeWsMessage, encodeWsMessage } from '../network.util.ts';

describe('Network Util', () => {
  describe('encodeWsMessage', () => {
    test('puts info in format of method:payload', () => {
      assert(encodeWsMessage(ServerWsMethod.Pong, {}).split(':').length === 2);
    });
    test('the payload is base64-encoded', () => {
      assertEquals(encodeWsMessage(ServerWsMethod.Pong, {}), 'pong:e30=');
    });
  });

  describe('decodeWsMessage', () => {
    test('the method is successfully parsed', () => {
      const [method] = decodeWsMessage('pong:e30=');

      assertEquals(method, ServerWsMethod.Pong);
    });
    test('the payload is successfully parsed and decoded', () => {
      const [, payload] = decodeWsMessage('pong:e30=');

      assertEquals(payload, {});
    });
  });
});
