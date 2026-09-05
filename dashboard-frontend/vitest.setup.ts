import '@testing-library/jest-dom/vitest';
import { WebSocket as NodeWebSocket } from 'ws';

// Code review [patch #2]: jsdom's built-in global `WebSocket` (Node's native
// undici-based implementation, exposed through jsdom's realm) has a known
// realm-mismatch bug in this environment combo - dispatching a real 'open'
// event throws `TypeError: The "event" argument must be an instance of
// Event. Received an instance of Event` (jsdom's own `Event` class vs Node's
// native `Event` class used internally by undici). Confirmed by running
// `tests/uiWsClient.test.ts`'s `connectUiWsClient` integration tests against
// a real `ws` server - the built-in WebSocket throws an unhandled exception
// on 'open' even though message delivery still worked by accident.
//
// Replace `globalThis.WebSocket` with the `ws` package's own WebSocket class
// - it independently implements the same public surface our code uses
// (`new WebSocket(url)`, `addEventListener('message', ...)`, `.close()`, a
// synchronous throw for a malformed URL) without depending on jsdom's Event
// realm, so tests exercise real socket I/O without the environment bug.
globalThis.WebSocket = NodeWebSocket as unknown as typeof WebSocket;
