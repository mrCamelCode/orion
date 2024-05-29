# Orion

A lightweight lobbying and peer-to-peer mediation server that prioritizes reliability.

## Jump Around

[The Problem](#the-problem)

[Our Solution](#our-solution)

[Usage Overview](#usage-overview)

[Writing a Client](#writing-a-client)

[API](#api)

[Customization](#customization)

## The Problem

[🔝 Back to Top](#jump-around)

Peer-to-peer connections are fairly common in the world of online multiplayer games, but establishing those direct connections can be a challenge. You could try using Universal Plug-n-Play, but what if the user's network hardware doesn't support it? There are third-party services out there, but you can be sure you'll have to pay for them. If you're an indie developer just trying to make a game where you can play with friends, you don't have a lot of options. As indie developers trying to write a P2P-networked game in Godot, we know. We looked.

Techniques using NAT hole-punching are available, but most of the servers out there that are easily available are flaky at best and difficult to write clients for because they use UDP for the entire process. The process is also fairly limited--most of the solutions out there are quick-and-dirty implementations that are pretty bare-bones. No lobbying and the APIs are poorly defined, making it difficult to write your own client.

What you really need is a well-documented, reliable mediation server that also supports lobbying to get all the peers in one "place" before they start trying to connect to one another willy-nilly. We couldn't find such a solution, so we wrote one.

## Our Solution

[🔝 Back to Top](#jump-around)

Orion is a lobbying and peer-to-peer mediation server that prioritizes reliability. It's written in TypeScript and powered by Deno. With Orion, a client can host a lobby, other clients can join, and the host can kick off the P2P connection process.

Orion acts as a mediator and does everything it can to keep the process reliable. Its role as a mediator is an important detail--Orion **does not** and **cannot** perform the actual peer-to-peer connection for you; no solution involving a "middleman server" can, because the whole point of a peer-to-peer connection is that all the client machines are directly connected to each other, _not_ to a server. However, creating a direct connection to a machine _without_ a mediation server is anywhere from difficult to impossible. Your chance of success varies wildly based on the networks your clients are sitting behind. The role of the mediation server is to capture network details the server can later feed to the clients to make the direct peer-to-peer connection easier to achieve.

While it's ultimately the client's responsibility to establish the peer-to-peer connection, Orion's role is to mediate the process so the process is consistent and reliable. These attributes make writing a client much simpler.

Note that Orion assumes that your application is ultimately trying to communicate with peers over UDP. UDP is a common (but not the only) transport choice for game networking. If there's a sufficient need for non-UDP transport in the future, it may be added.

That being said, no one wants to include a bunch of retry logic in their client because of the inherent unreliability of UDP, so Orion doesn't use UDP until it absolutely must. In the situations where UDP is used, Orion builds in retry mechanisms to protect against UDP's unreliability. We'll get into the nitty-gritties a little later.

### Why TypeScript/Deno?

Existing solutions we could find were largely written in Python. That limits the deployability to machines that have Python installed on them. Deno has a very solid base API for making servers, and it has the ability to easily generate native binaries from TypeScript code. That means that you can run the server on a machine that has Deno installed, but having that extra runtime environment isn't required. You could build a native binary on your machine with Deno and then ship it to and run it on any machine.

Also, we like TypeScript, and it's our server, so there 😜. The good news is our choice of server language doesn't impact your choice of language for a client. Additionally, Orion is an application, **not a library**, so you won't be consuming Orion's code directly. Instead, you interface with the application via its network API, just like any other web server.

### Network Protocols

Orion uses a mix of protocols to do its job as reliably as possible. Orion starts an HTTP server and a UDP listener. Its flow also requires a WebSocket connection per-client.

For one-off actions where the client would need to know whether the operation succeeded/failed, HTTP is used because it best models that kind of exchange.

For actions where the client or server just needs to inform the other of something, a WebSocket connection is used. Orion also uses the WS connection as a persistent, stateful way to track connected clients that are actively participating in the lobbying/P2P process. We'll touch on that more later.

For the P2P Mediation process (capturing network connection details), Orion uses UDP. This is because of the earlier assumption we mentioned; Orion assumes your peers ultimately want to talk to each other over UDP.

## Usage Overview

[🔝 Back to Top](#jump-around)

Using Orion should be a fairly painless process. It follows a simple and consistent flow, which should make writing a client simple.

### Basic Flow

We'll show you the basic flow here. For details on writing a client and exactly what calls should be made, consult [Writing a Client](#writing-a-client). This section is intended as a primer so you can understand the big picture of how Orion works.

1. Once the client would like to participate in the lobbying and P2P Mediation process, it opens a WebSocket connection to the server. This connection generates a token that is communicated to the client over the newly-established WebSocket. This token is critical and required for the majority of requests and messages to the server.
1. The client may choose to host or join a lobby. If hosting, the client will receive a unique code for the lobby. The code is a 5-digit base-36 (A-Z, 0-9) number. The user can share this code with others so they can join the lobby. Base-36 was chosen because it keeps codes human-readable and easy to share. Though easy to remember, the number of possible unique IDs is pretty massive. A 5-digit base-36 number supports more than 60 million unique permutations.
1. Once in a lobby, users may chat with each other via text. Shoot the breeze while waiting for your friends!
1. When ready, the host kicks off the P2P mediation process.
1. All clients in the lobby receive a message to send a UDP packet to the server. The server uses this packet to capture the the IP and port the client used to make the call. This information can be used by the client to perform NAT hole-punching later. Orion just serves as the mediator to collect the information.
   - Because this stage uses UDP, Orion makes a best effort to make it reliable. During this initial connection process, Orion will periodically send "reminder" messages over the WebSocket to any clients it hasn't yet received a UDP package from. This builds a retry into the process and helps address the unreliability of UDP at this stage.
1. Once all clients have sent a packet to the server, Orion will send a message over the WebSocket containing connection details so the clients can start performing the direct connection to their peers.
   - For the host, this message contains the IP/port of all other peers in the lobby.
   - For the non-host clients, this message contains the IP/port of the host.
1. t this stage, the clients must start trying to connect directly to one another using UDP and the connection information Orion provided. Once a client has confirmed a successful connection, it informs Orion and Orion notes that that client has successfully completed its P2P connection. For a client connecting to another, you should utilize a technique called [hole-punching](<https://en.wikipedia.org/wiki/Hole_punching_(networking)>). This stage must be implemented client-side. Orion is a P2P _mediator_ and cannot perform the actual direct peer-to-peer connection for you (it wouldn't be a P2P connection at that point 😉).
1. Once all clients have successfully connected to one another, Orion automatically closes the lobby. Orion's job is done.

## Writing a Client

[🔝 Back to Top](#jump-around)

The steps of writing the client will be presented in order of the general flow of the lobbying/P2P Mediation process. You may use this as a step-by-step guide to write your own client to talk to an Orion server.

### Conventions

Orion follows some consistent conventions to make working with it easier. **It's strongly recommended you read and understand these before continuing**.

1. For WebSocket messages, messages _always_ follow the pattern of `method:base64EncodedJsonPayload`, with an example being `client_registered:eyJ0b2tlbiI6IjEyMyJ9`. The `method` describes what the message is about or what it's trying to do, and the payload gives any additional information. The method and payload are always separated by a colon. **When sending a message over the WS, your client MUST encode the message in this way.**
1. For UDP messages, they follow the same pattern as WS messages, but the text must be a UTF-8 encoded byte array.
1. For HTTP requests, there are 2 types of client errors that can occur. If the contents of your request fail basic validation (like a missing required property, or a property not meeting the expected criteria), you'll receive a `400` response. If your request can't be completed because it conflicts with the server (like trying to join a full lobby), you'll receive a `409` response. In the case of a `409`, a body is sent containing an `errors` property that is a `string[]`. The errors here are intended to be fairly user-friendly and describe why the request failed. Because the error messages are user-friendly, you may show them to your users if you choose.
   - Non-HTTP requests also go through similar validation steps, but the client doesn't receive notification of a failure. This is to reduce the number of messages the client needs to subscribe to, thereby reducing client complexity. For operations where clients would need to know about success/failure, HTTP is used.

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
  [];
}
```

A client can use this endpoint to present available public lobbies to the user.

### Connection

Once the client would like to actively participate in the lobbying/P2P Mediation process, it _must_ open a WebSocket connection with the server. You may send an HTTP Upgrade request to any endpoint on the server, but it's easiest to just hit the root of the server. If the language you're using doesn't have a useful abstraction for a `WebSocket`, you can refer to [this documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Protocol_upgrade_mechanism) to see how you might implement an Upgrade request, though it's strongly recommended you choose a language that has a good abstraction for a `WebSocket` to write your client. Orion makes frequent use of the WS connection.

Upon connecting, Orion will send a message over the WebSocket. The method will be `client_registered` and the payload will have the shape:

```ts
{
  token: string;
}
```

The token is _very_ important. It's used to represent the client and should be considered a secret. Do not log the token. Do not make the token known to other clients. The token is cryptographically secure and can be considered your client's authentication with the server since Orion does not support identity management nor user accounts.

> If you observe the logs of an Orion server, you'll see Orion logging client IDs. You may be tempted to assume these are the tokens for those clients. **Orion never logs a client's token**. Orion has many cases of internally-assigned IDs that are not sensitive like a client's token. It frequently logs these IDs in messages to help you track traffic through the server.

For most requests, the client must send this token to the server in the body, so you should tuck it away in memory. One of the few exceptions is the `GET` request for lobby querying, which can be performed by any client at any time.

The WS connection _must_ remain open for the duration of the lobbying/P2P Mediation process. This connection represents the client. Closing it indicates that the client is done, and they'll be cleaned up server-side. If the client was the host of a lobby, the lobby will be closed. If the client was a member of a lobby, they'll be removed from the lobby.

**You cannot restore a client after its WS connection has been closed.** You can open a new WS connection, but Orion will see them as a brand-new client.

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

The `lobbyId` is important. It's how you'll identify the lobby in future requests to the server. It's also used by other clients to join the lobby. You may find value in displaying the `lobbyId` prominently to _at least_ the host of the lobby so they can tell their friends the code they'll need to join the lobby.

> **Public/Private Lobbies:** Orion doesn't currently support password-protected lobbies. Making a lobby private does _not_ prevent clients from connecting to it _if they know the `lobbyId`_. That being said, any lobbies that were created with `isPublic: false` will **not** be returned by a request to `GET /lobbies`, effectively hiding them from other clients. Given that lobby IDs are generated randomly, are not sequential, have over 60 million possible values, and aren't intended to have long lifetimes, it is incredibly unlikely that someone would be successful in guessing a valid lobby ID.

### Joining a Lobby

Once you know the `lobbyId` of a lobby, you can use that information to join it. To join a lobby, make an HTTP request to `POST /lobbies/:lobbyId/join`, where `:lobbyId` is replaced with the `lobbyId` of the lobby you want to join. The request is expected to have a body with the shape:

```ts
// Your client's unique token, granted upon connection
token: string;
// The name this client would like to use to represent themselves in the lobby. Must be unique among other members of the lobby. Max 50 chars, \w and spaces only, cannot start with a space.
peerName: string;
```

Clients cannot join a full lobby, nor may a client use a `peerName` that's already in use in that lobby.

If all validation passes, Orion puts the client in the lobby and responds with a `200` and a body of the shape:

```ts
{
  lobbyId: string;
  lobbyName: string;
  lobbyMembers: string[];
  host: string;
}
```

Additionally, all members currently in the lobby are notified via WS that a new peer joined. The message will have the method `lobby_peerConnect` and its payload will have the shape:

```ts
{
  lobbyId: string;
  peerName: string;
}
```

The client can use this information to show a realtime representation of the lobby's current members. Because names within a lobby must be unique, your client may use the names of connected peers as a way to uniquely identify them within the lobby.

### Leaving a Lobby

There's no endpoint for leaving a lobby. If you'd like to leave a lobby, simply close your WS connection. The server will automatically clean up anything associated with your client's connection.

**If your client was the host of a lobby, that lobby will be closed.**

When a lobby is closed, all clients in that lobby will receive a WS message with the method `lobby_closed` and a payload of shape:

```ts
{
  lobbyId: string;
  lobbyName: string;
}
```

The `lobby_closed` message may be sent out in other scenarios as well. _Don't assume that it's exclusive to the host leaving the lobby._

If the disconnecting client is a member of a lobby but not the host, they will be removed from the lobby. Other clients in the lobby will receive a WS message with method `lobby_peerDisconnect` and a payload of shape:

```ts
{
  lobbyId: string;
  peerName: string;
}
```

### Lobby Messaging

While in a lobby, clients may send a message to the lobby to be displayed to other clients. While not required for your client to implement, this is a nifty feature that allows lobby members to chat with one another while they're in the lobby.

To send a message to the lobby, send a WS message with method `lobby_messaging_send` and payload of shape:

```ts
{
  // Your client's unique token, granted on connection
  token: string;
  // The ID of the lobby to send a message to.
  lobbyId: string;
  // The message you'd like to send. Must be between 1..=250 chars.
  message: string;
}
```

If validation on your message fails because you don't adhere to the schema or the data is invalid, Orion will simply ignore your message.

If validation passes, Orion will send a WS message to _all peers_ in the lobby, including the one that sent the message. You shouldn't display the message to the sender as "sent" until you receive Orion's WS message for it. Orion's message has the method `lobby_messaging_received` and payload of shape:

```ts
{
  lobbyId: string;
  message: {
    timestamp: number;
    senderName: string;
    message: string;
  }
}
```

### Starting Peer-to-Peer Mediation

One of Orion's primary functions is to act as a mediation service for peer-to-peer connections. This process can _only_ be kicked off by the host of a lobby. If other peers in a lobby attempt to kick off the process, the request will be rejected.

To kick off P2P Mediation, the host must send an HTTP request to `POST /lobbies/:lobbyId/ptp/start`, where the `:lobbyId` is replaced with the `lobbyId` of the lobby the client is the host of. The request must have a payload of shape:

```ts
{
  // The client's unique token, granted on connection.
  token: string;
}
```

P2P Mediation cannot be kicked off if it's already underway.

If the request passes validation, Orion will begin the P2P Mediation process for the lobby, and respond with a `200` with no body.

> While undergoing P2P Mediation, a lobby is locked. A locked lobby will not accept new members.

If a client leaves during P2P Mediation, the mediation will be aborted and the host will have to kick it off again. When a mediation is aborted, all clients in the lobby will receive a WS message with method `ptpMediation_aborted` and a payload of shape:

```ts
{
  abortReason: string;
}
```

The `abortReason` is user-friendly and may be shown to users if you like.

### Sending Orion Network Details

Shortly after the P2P Mediation process is successfully kicked off, Orion will send a WS message to all clients in the lobby with method `ptpMediation_send` and payload of shape:

```ts
{
  port: number;
}
```

The `port` is the port that Orion is listening on for UDP messages. Whenever the client receives this message, it should send a **UDP packet** with method `ptpMediation_connect` and a payload with the shape:

```ts
{
  token: string;
}
```

During the mediation process, Orion may send the connection message to a client multiple times. It's expected the client always sends a UDP packet when receiving the message.

> Refer to the [Conventions](#conventions) section for a reminder on how to format a UDP message for Orion.

Orion uses this UDP packet to capture the IP and port the client is using for its UDP connection. At a later stage, Orion will send this information to other members of the lobby so they can use it to connect directly to one another.

By default, Orion will wait 5 minutes to receive UDP packets from all clients in the lobby. This timeout can be configured by setting the `--ptpmServerConnectTimeoutMs` flag when starting Orion.

Additionally by default, every 10 seconds during the mediation process Orion will resend the `ptpMediation_connect` WS message to any clients it hasn't yet received a UDP packet from. This constitutes built-in retry logic to protect against the unreliability of UDP. This is why the client is expected to send a UDP packet whenever they receive that message. The amount of time Orion waits before sending these reminders can be configured by setting the `--ptpmConnectRequestIntervalMs` flag when starting Orion.

### Peer-to-Peer Connection

Once all clients have sent UDP packets and Orion has successfully received them, Orion will send a WS message to all clients in the lobby. The message has method `ptpMediation_peersConnection_start` and payload of shape:

```ts
{
  peers: {
    ip: string;
    port: number;
  }
  [];
}
```

The process is now in the hands of the clients. During this stage, the clients will use the contents of the above message to start attempting to connect directly to one another.

The host of the lobby will receive the IPs and ports of _all_ other members of the lobby. The host needs to successfully connect to all of them. As the host, the client will be acting as the server in the peer-to-peer context, so they need a direct connection to _all_ other peers.

Non-host members of the lobby will receive only the IP and port of the host. These clients must connect to the host successfully.

To complete this process, the client should start by trying to send a UDP packet to the IP and port that Orion provided, as this is the IP and port that the was opened to talk to Orion, so it's possible that channel is still open. Depending on the networks other clients are behind, you may need to try a variety of ports close to the port Orion provided, but you should start your connection attempts with the port provided.

Once the client has successfully connected to all the clients that came back on the `peers` property, the client must send a WS message with method `ptpMediation_peersConnection_success` and payload of shape:

```ts
{
  // The unique token for the client, granted on connection.
  token: string;
}
```

This notifies Orion that the client has successfully completed its connection to all requisite peers. Once all members of the lobby have sent such a message, Orion will send a WS message with method `ptpMediation_success` and an empty payload (`{}`). Shortly after sending out that message, the server will close the lobby.

Orion's job is done at this point and there's no longer a point for the lobby. Your application may now use its direct connection to its peers for further communication. Your client should also close its WS connection to Orion at this point.

## API

[🔝 Back to Top](#jump-around)

### HTTP

#### /lobbies

**GET /**

Retrieves all public lobbies that are currently active.

**Success**

`200`

```ts
{
  lobbies: {
    name: string;
    id: string;
    currentMembers: number;
    maxMembers: number;
  }
  [];
}
```

**POST /**

Creates a new lobby and makes the requesting client the host.

**Body**

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

**Success**

`201`

```ts
{
  lobbyName: string;
  lobbyId: string;
}
```

**Failure**

`400` - Request body failed validation.

`409` - Current state of the server made fulfilling the request impossible.

```ts
{
  errors: string[];
}
```

**POST /:lobbyId/join**

Joins the lobby specified by `lobbyId`.

**Body**

```ts
// Your client's unique token
token: string;
// The name this client would like to use to represent themselves in the lobby. Must be unique among other members of the lobby. Max 50 chars, \w and spaces only, cannot start with a space.
peerName: string;
```

**Success**

`200`

```ts
{
  lobbyId: string;
  lobbyName: string;
  lobbyMembers: string[];
  host: string;
}
```

**Failure**

`400` - Request body failed validation.

`409` - Current state of the server made fulfilling the request impossible.

```ts
{
  errors: string[];
}
```

**POST /:lobbyId/ptp/start**

Begins the Peer-to-Peer Mediation process for the lobby. This request will only succeed if made by the host of the lobby.

**Body**

```ts
{
  // The client's unique token, granted on connection.
  token: string;
}
```

**Success**

`200`

**Failure**

`400` - Request body failed validation.

`409` - Current state of the server made fulfilling the request impossible.

```ts
{
  errors: string[];
}
```

#### /ping

**GET /**

Allows you to check if the server is up.

**Success**

`200`

```
pong
```

### WebSocket

All WebSocket messages **must** be text in the format `method:base64EncodedJsonPayload`, i.e. `client_registered:eyJ0b2tlbiI6IjEyMyJ9`. All messages the client sends must be in this format. All messages the server sends will be in this format.

In the event a client sends an invalid WS message, it's simply ignored.

#### Client Messages

These are the messages that may be sent by clients to the server.

**`lobby_messaging_send`**

Sends a message to a lobby. Allows the user to communicate with the other members of the lobby.

**Payload**

```ts
{
  // Your client's unique token, granted on connection
  token: string;
  // The ID of the lobby to send a message to.
  lobbyId: string;
  // The message you'd like to send. Must be between 1..=250 chars.
  message: string;
}
```

**`ptpMediation_peersConnection_success`**

Notifies the server that this client has successfully connected to all requisite peers during the P2P Mediation stage. For the lobby host, this means that they've successfully made a connection via UDP to all other members of the lobby. For the other members of the lobby, this means that they've successfully made a connection via UDP to the host of the lobby.

**Payload**

```ts
{
  // The unique token for the client, granted on connection.
  token: string;
}
```

#### Server Messages

These messages are sent by the server to clients.

**`client_registered`**

Emitted once the WS connection is established. This is emitted ONLY to the newly-established WS. This message contains the token that uniquely identifies the client.

**Do not make the token known to other clients. Treat the token as a secret. The client will need to send the token on most requests to the server.**

When a client disconnects by closing the WS connection, the token is invalidated.

**Payload**

```ts
{
  token: string;
}
```

**`lobby_closed`**

Emitted to the members of a lobby when the lobby is closed. A lobby could close because the host disconnected. Lobbies are also automatically closed once the P2P Mediation process successfully finishes.

When a lobby closes, it's destroyed and all its members are kicked from the lobby.

**Payload**

```ts
{
  lobbyId: string;
  lobbyName: string;
}
```

**`lobby_peerConnect`**

Emitted to the existing members of a lobby when someone new connects to the lobby. Names within a lobby must be unique, and this rule is enforced server-side. Because of this, the client may use the names of lobby members as a way to uniquely identify them within the context of the lobby.

**Payload**

```ts
{
  lobbyId: string;
  peerName: string;
}
```

**`lobby_peerDisconnect`**

Emitted to members of a lobby when a member of a lobby leaves. A peer can leave a lobby by closing their WS connection to the server.

**Payload**

```ts
{
  lobbyId: string;
  peerName: string;
}
```

**`lobby_messaging_received`**

Emitted when the server receives a `lobby_messaging_send` message from a client and the message passes all validation.

Clients that want to send a message in a lobby should wait to receive this message from the server before showing the message as "sent" to the user that sent the message.

This message is sent to _all_ members of the lobby, including the client that sent the message. This allows clients to have a simple handler for this message to display the message in a chat log or something similar.

**Payload**

```ts
{
  lobbyId: string;
  message: {
    timestamp: number;
    senderName: string;
    message: string;
  }
}
```

**`ptpMediation_send`**

Emitted when the server wants the client to send a UDP `ptpMediation_connect` message. See the (UDP)[#udp] section for more details.

The server may send this message multiple times to the same client during the P2P Mediation process. It's expected that the client sends an appropriate UDP packet every time the server asks for one.

**Payload**

```ts
{
  // The port the server is receiving UDP messages on.
  port: number;
}
```

**`ptpMediation_aborted`**

Emitted when the P2P Mediation process aborts. The process can abort for a number of reasons, including (but not limited to):

1. A member of the lobby disconnected during the process
1. The process timed out.

The exact reason for the abort is included in the payload of this message. The message is user-friendly enough that you could show it to the user if you like.

**Payload**

```ts
{
  abortReason: string;
}
```

**`ptpMediation_peersConnection_start`**

Emitted when the server would like the members of the lobby to attempt to connect to each other directly.

The `peers` included in the payload represent all the peers the client must connect to. The client shouldn't send its `ptpMediation_peersConnection_success` message until it has successfully connected to all the `peers` the server provided in this message.

**Payload**

```ts
{
  peers: {
    ip: string;
    port: number;
  }
  [];
}
```

**`ptpMediation_success`**

Emitted when all clients have indicated a successful peer-to-peer connection with `ptpMediation_peersConnection_success` messages. The emission of this message represents Orion's acknowledgment that its job is done. Shortly after emitting this message, **the lobby will automatically close**.

When your client receives this message, it can safely drop its connection to the server.

**Payload**

```ts
{
}
```

### UDP

**Orion never sends messages over UDP itself**, but it does expect the client to send certain packets at designated times.

All UDP messages **must** be UTF-8-encoded binary in the format `method:base64EncodedJsonPayload`, i.e. `ptpMediation_connect:eyJ0b2tlbiI6IjEyMyJ9`. All messages the client sends **must** be in this format.

**`ptpMediation_connect`**

Sent by the client in response to the `ptpMediation_send` WS message from the server.

**Payload**

```ts
{
  // The unique token granted to your client upon connection
  token: string;
}
```

## Customization

[🔝 Back to Top](#jump-around)

Orion has a few customization options to alter its behaviour. **Customization options are passed as flags when starting Orion.**

### `--ptpmServerConnectTimeoutMs`

`number`

**Default: 5 minutes**

The number of MS Orion will wait to receive UDP packets from all clients during the initial phase of the P2P Mediation process.

### `--ptpmConnectRequestIntervalMs`

`number`

**Default: 10 seconds**

The number of MS Orion will wait before requesting that a client sends a UDP packet. This "reminder" request will be sent every `ptpmConnectRequestIntervalMs` MS until Orion has successfully received a packet from every client in the lobby.

### `--ptpmConnectTimeoutMs`

`number`

**Default: 5 minutes**

The number of MS Orion will wait for all clients to tell Orion that they've successfully connected to their peers.

### `--httpPort`

`number`

**Default: 5980**

The port Orion will service HTTP requests on.

### `--udpPort`

`number`

**Default: 5990**

The port Orion will receive UDP messages on.
