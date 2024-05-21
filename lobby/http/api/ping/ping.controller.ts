import { Controller, RequestHandler } from 'potami';

export class PingController extends Controller {
  constructor() {
    super({ base: '/ping' });
  }

  'GET /': RequestHandler = () => {
    return new Response('pong');
  };
}
