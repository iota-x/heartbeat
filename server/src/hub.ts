// downstream fan-out: one websocket server, N browsers. every message is
// serialized once and broadcast. dead clients are reaped with ping/pong.

import { WebSocketServer, WebSocket } from "ws";
import type { FeedStatus, HelloMsg, ServerMsg } from "./protocol.js";

const PING_INTERVAL_MS = 15_000;

interface Client extends WebSocket {
  isAlive?: boolean;
}

export const startHub = (port: number, whaleLamports: number) => {
  const wss = new WebSocketServer({ port });
  let status: FeedStatus = "connecting";
  let lastSlot = 0;

  wss.on("connection", (socket: Client) => {
    socket.isAlive = true;
    socket.on("pong", () => (socket.isAlive = true));
    socket.on("error", () => socket.terminate());
    const hello: HelloMsg = { t: "h", status, slot: lastSlot, whaleLamports };
    socket.send(JSON.stringify(hello));
  });

  const reaper = setInterval(() => {
    for (const socket of wss.clients as Set<Client>) {
      if (socket.isAlive === false) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }, PING_INTERVAL_MS);

  const broadcast = (msg: ServerMsg) => {
    if (msg.t === "s") lastSlot = msg.s;
    const payload = JSON.stringify(msg);
    for (const socket of wss.clients) {
      if (socket.readyState === WebSocket.OPEN) socket.send(payload);
    }
  };

  const setStatus = (next: FeedStatus) => {
    if (next === status) return;
    status = next;
    console.log("[hub] status → %s (%d clients)", next, wss.clients.size);
    broadcast({ t: "st", status: next });
  };

  console.log("[hub] listening on ws://localhost:%d", port);

  return {
    broadcast,
    setStatus,
    clientCount: () => wss.clients.size,
    stop: () => {
      clearInterval(reaper);
      wss.close();
      for (const socket of wss.clients) socket.terminate();
    },
  };
};
