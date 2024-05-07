import { decodeBase64, encodeBase64 } from 'base64';
import { WsMessagePayloadMap, WsMethod } from './network.model.ts';

/**
 * @param method - The method of the message. This informs the receiver what
 * kind of action is happening.
 * @param payload - The payload for the message. This contains necessary information
 * about the action. Must be serializable as JSON.
 *
 * @returns The properly encoded message to send over the websocket connection.
 * Messages are in the format {method}:{base64EncodedPayload}.
 */
export function encodeWsMessage<T extends keyof WsMessagePayloadMap>(method: T, payload: WsMessagePayloadMap[T]) {
  return `${method}:${encodeBase64(JSON.stringify(payload))}`;
}

/**
 * @param msg - The message to decode.
 *
 * @returns The decoded message, assuming a format that would be created by
 * {@link encodeWsMessage}.
 */
export function decodeWsMessage<T extends Record<string, any>>(msg: string): [string, T] {
  const textDecoder = new TextDecoder();

  const [method, payload] = msg.split(':');

  return [method, payload ? JSON.parse(textDecoder.decode(decodeBase64(payload ?? ''))) : undefined];
}

// Makes the types easier.
export function getOutboundMessage<T extends WsMethod>(
  method: T,
  payload: WsMessagePayloadMap[T]
): { method: T; payload: WsMessagePayloadMap[T] } {
  return {
    method,
    payload,
  };
}
