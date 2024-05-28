# Orion

A lightweight lobbying and peer-to-peer mediation server intended for P2P gaming that prioritizes reliability.

## The Problem

Peer-to-peer connections are fairly common in the world of online multiplayer games, but establishing those direct connections can be a challenge. You could try using Universal Plug-n-Play, but what if the user's network hardware doesn't support it? There are third-party services out there, but you can be you'll have to pay for them. If you're an indie developer just trying to make a game where you can play with friends, you don't have a lot of options. As indie developers trying to write a P2P-networked game in Godot, we know. We looked.

Techniques using NAT hole-punching are available, but most of the servers out there that are easily available are flaky at best and difficult to write clients for because they use UDP for the entire process. The process is also fairly limited--most of the solutions out there are quick-and-dirty implementations that are pretty bare-bones. No lobbying, and the APIs are poorly defined should you want to write your own client.

What you really need is a well-documented, reliable mediation server that also supports lobbying to get all the peers in one "place" before they start trying to connect to one another willy-nilly. We couldn't find such a solution, so we wrote one.

## Our Solution

Orion is a lobbying and peer-to-peer mediation server written in TypeScript and powered by Deno that priortizes reliability. With Orion, a client can host a lobby, other clients can join, and the host can kick off the P2P connection process. Orion behaves as a mediator and does everything it can to keep the process reliable. No one wants to include a bunch of retry logic in their client because of the inherent unreliability of UDP, so Orion doesn't use UDP until it absolutely must. We'll get into the nitty-gritties a little later.

### Why TypeScript/Deno?

Existing solutions we could find were largely written in Python. That limits the deployability to machines that have Python installed on them. Deno has a very solid base API for making servers, and it has the ability to easily generate native binaries from TypeScript code. That means that you can run the server on a machine that has Deno installed, but having that extra runtime environment isn't required. You could build a native binary on your machine with Deno and then ship it to and run it on any machine.

Also, we like TypeScript, and it's our server, so there 😜. The good news is our choice of server language doesn't impact your choice of language for a client.

### Network Protocols

Orion uses a mix of protocols to do its job as reliably as possible. Orion starts an HTTP server and a UDP listener. Its flow also requires a WebSocket connection per-client.

For one-off actions where the client would need to know whether the operation succeeded/failed, HTTP is used because it best models that kind of exchange.

For actions where the client or server just needs to inform the other of something, a WebSocket connection is used. Orion also uses the WS connection as a persistent, stateful way to track connected clients that are actively participating in the lobbying/P2P process. We'll touch on that more later.

For the P2P mediation process (capturing network connection details and informing clients of the peers they must connect to), Orion uses UDP. This is partially influenced by our choice of Godot for our game engine, but many solutions for game networking use UDP for the underlying network connection because of its speed. **You don't have to use Godot to use Orion.** Orion is simply a network server that helps clients create a UDP connection they can then use for any traffic over UDP.

## Usage Overview

Using Orion should be a fairly painless process. It follows a simple and consistent flow, which should make writing a client simple.

### Basic Flow

We'll show you the basic flow here. For details on writing a client and exactly what calls should be made, consult Writing a Client.

1. Once the client would like to participate in the lobbying and P2P mediation process, it opens a WebSocket connection to the server. You can hit the root of the server with an upgrade request to open the connection.
1. The client may choose to host or join a lobby. If hosting, the client will receive a unique code for the lobby. The code is a 5-digit base-36 (A-Z, 0-9) number. The user can share this code with others so they can join the lobby. Base-36 was chosen because it keeps codes human-readable and easy to share. Though easy to remember, the number of possible unique IDs is pretty massive. A 5-digit base-36 number supports more than 60 million unique permutations.
1. Once in a lobby, users may chat with each other via text. Shoot the breeze while waiting for your friends!
1. When ready, the host kicks off the P2P mediation process.
1. All clients in the lobby receive a message to send a UDP packet to the server. The server uses this packet to capture the the IP and port the client used to make the call. This information can be used by the client to perform NAT hole-punching later. Orion just serves as the mediator to collect the information.
   - Because this stage uses UDP, Orion makes a best effort to make it reliable. During this initial connection process, Orion will periodically send "reminder" messages over the WebSocket to any clients it hasn't yet received a UDP package from. This builds a retry into the process and helps address the unreliability of UDP at this stage.
1. Once all clients have sent a packet to the server, Orion will send a message over the WebSocket containing connection details so the clients can start doing the direct connection to their peers.
   1. For the host, this message contains the IP/port of all other peers in the lobby.
   1. For the non-host clients, this message contains the IP/port of the host.
1. At this stage, the clients must start trying to connect directly to one another using UDP and the connection information Orion provided. Once a client has confirmed a successful connection, it informs Orion and Orion notes that that client has successfully completed its P2P connection. For a client connecting to another, you should utilize a technique called [hole-punching](<https://en.wikipedia.org/wiki/Hole_punching_(networking)>). This stage must be implemented client-side. Orion is a P2P _mediator_ and cannot perform the actual direct peer-to-peer connection for you (it wouldn't be a P2P connection at that point 😉).
1. Once all clients have successfully connected to one another, Orion automatically closes the lobby. Orion's job is done.

## Writing a Client

The steps of writing the client will be presented in order of the general flow of the lobbying/P2P mediation process. You may use this as a step-by-step guide to write your own client to talk to an Orion server.

### Conventions

Orion follows some consistent conventions to make working with it easier.

1. For WebSocket messages, messages _always_ follow the pattern of `method:base64EncodedJsonPayload`, with an example being `client_registered:eyJ0b2tlbiI6IjEyMyJ9`. The `method` describes what the message is about, and the payload gives any additional information. The method and payload are always separated by a colon.
1. For UDP messages, they follow the same pattern as WS messages, but are additionally UTF-8 encoded.
1. When Orion responds to an HTTP request with a non-200-series response, it often includes an `errors` property in the JSON body. This property is an array of strings describing why the request failed. These error messages are intended to be fairly user-friendly, so you could show them to your users if you want.

### Lobby Querying

At any point, a client may make an HTTP `GET /lobbies` request to retrieve all _public_ lobbies that are currently available. The information will come back in JSON with the shape:

```ts
{
  lobbies: {
    name: string;
    id: string;
    currentMembers: number;
    maxMembers: number;
  }
}
```

A client can use this endpoint to present available public lobbies to join to the user.

### Connection

Once the client would like to actively participate in the lobbying/P2P mediation process, it _must_ open a WebSocket connection with the server. You may send an HTTP Upgrade request to any endpoint on the server, but it's easiest to just hit the root of the server. If the language you're using doesn't have a useful abstraction for a `WebSocket`, you can refer to [this documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Protocol_upgrade_mechanism) to see how you might implement an Upgrade request, though it's strongly recommended you choose a language that has a good abstraction for a `WebSocket`.

Upon connecting, Orion will send a message over the WebSocket. The method will be `client_registered` and the payload will have the shape:

```ts
{
  token: string;
}
```

The token is _very_ important. It's used to represent the client and should be considered a secret. Do not log the token. Do not make the token known to other clients. The token is cryptographically secure and can be considered your client's authentication with the server since Orion does not support identity management or user creation.

For most requests, the client must send this token to the server in the body, so you should tuck it away in memory. One of the few exceptions is the `GET` request for lobby querying, which can be performed by any client at any time.

The WS connection _must_ remain open for the duration of the lobbying/P2P mediation process. This connection represents the client. Closing it indicates that the client is done, and they'll be cleaned up server-side. If the client was the host of a lobby, the lobby will be closed. If the client was a member of a lobby, they'll be remove from the lobby.

You cannot restore a client after its WS connection has been closed. You can open a new WS connection, but Orion will see them as a brand-new client.

### Creating a Lobby

Lobbies must have a single host, which is just the client that created the lobby. To create a lobby, send an HTTP `POST /lobbies` request with a body of shape:

```ts
{
  // Your client's token that was granted upon opening your WS connection.
  token: string;
  // Max 50 chars, \w and spaces only, cannot start with a space.
  hostName: string;
  // Max 50 chars, \w and spaces only, cannot start with a space.
  lobbyName: string;
  isPublic: boolean;
  // 1..=64
  maxMembers: number;
}
```

A client cannot be in multiple lobbies at once. If your client is already in a lobby (or any validation fails), you'll receive a `409` in response.

If all validation passes, Orion creates the lobby and responds with a `201` and a body with the shape:

```ts
{
  lobbyName: string;
  lobbyId: string;
}
```

The `lobbyId` is important. It's how you'll identify the lobby in future requests to the server. It's also used by other clients to join the lobby.

**A note on public/private lobbies:** Orion doesn't currently support password-protected lobbies. Making a lobby private does _not_ prevent clients from connecting to it _if they know the `lobbyId`_. That being said, any lobbies that were created with `isPublic: false` will **not** be returned by a request to `GET /lobbies`, effectively hiding them from other clients. Given that lobby IDs are generated randomly, are not sequential, have over 60 million possible values, and Orion lobbies aren't intended to have long lifetimes, it is incredibly unlikely that someone would be successful in guessing a valid lobby ID.

## API

## Customization
