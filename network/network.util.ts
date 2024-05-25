import { decodeBase64, encodeBase64 } from 'base64';
import { WsMessagePayloadMap, WsMethod } from './network.model.ts';

/**
 * Base-64 encodes a packet. A packet has the format `method:base64EncodedJsonPayload`.
 *
 * @param method - The method of the message. This informs the receiver what
 * kind of action is happening.
 * @param payload - The payload for the message. This contains necessary information
 * about the action. Must be serializable as JSON.
 *
 * @returns The properly encoded message to send over the websocket connection.
 * Messages are in the format {method}:{base64EncodedPayload}.
 */
export function encodePacket<T extends WsMethod>(method: T, payload: WsMessagePayloadMap[T]) {
  return `${method}:${encodeBase64(JSON.stringify(payload))}`;
}

/**
 * Decodes a base-64-encoded packet. The packet is expected to have the format `method:base64EncodedJsonPayload`.
 *
 * @param msg - The message to decode.
 *
 * @returns The decoded message, assuming a format that would be created by
 * {@link encodePacket}.
 */
export function decodePacket<T extends Record<string, any>>(msg: string): [string, T] {
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

/**
 * Convenience function that sends the provided `message` to the provided `sockets`.
 * This function ensures the socket is open before trying to send the message.
 *
 * @param message - The message to send. Since this function attempts to unopinionated
 * about the message itself, you must do any encoding yourself. This function will send exactly
 * the message you specify.
 * @param sockets - The sockets to send the provided message to.
 */
export function sendToSockets(message: string, ...sockets: WebSocket[]) {
  sockets.forEach((socket) => {
    if (socket.readyState === socket.OPEN) {
      socket.send(message);
    }
  });
}
