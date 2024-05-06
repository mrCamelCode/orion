import { decodeBase64, encodeBase64 } from 'base64';
import { WsMessagePayload } from '../lobby/lobby.model.ts';

export function encodeWsMessage<T extends keyof WsMessagePayload>(method: T, payload: WsMessagePayload[T]) {
  return `${method}:${encodeBase64(JSON.stringify(payload))}`;
}

export function decodeWsMessage<T extends Record<string, any>>(msg: string): [string, T] {
  const textDecoder = new TextDecoder();

  const [method, payload] = msg.split(':');

  return [method, JSON.parse(textDecoder.decode(decodeBase64(payload)))];
}
