import { assert, assertEquals } from 'assert';
import { describe, test } from 'bdd';
import { ServerWsMethod } from '../network.model.ts';
import { decodePacket, encodeWsPacket } from '../network.util.ts';

describe('Network Util', () => {
  describe('encodeWsMessage', () => {
    test('puts info in format of method:payload', () => {
      assert(encodeWsPacket(ServerWsMethod.ClientRegistered, { token: '123' }).split(':').length === 2);
    });
    test('the payload is base64-encoded', () => {
      assertEquals(
        encodeWsPacket(ServerWsMethod.ClientRegistered, { token: '123' }),
        'client_registered:eyJ0b2tlbiI6IjEyMyJ9'
      );
    });
  });

  describe('decodeWsMessage', () => {
    test('the method is successfully parsed', () => {
      const [method] = decodePacket('client_registered:eyJ0b2tlbiI6IjEyMyJ9');

      assertEquals(method, ServerWsMethod.ClientRegistered);
    });
    test('the payload is successfully parsed and decoded', () => {
      const [, payload] = decodePacket('client_registered:eyJ0b2tlbiI6IjEyMyJ9');

      assertEquals(payload, { token: '123' });
    });
  });
});
