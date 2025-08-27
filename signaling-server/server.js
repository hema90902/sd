import { WebSocketServer } from 'ws';

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;

/**
 * In-memory room registry: roomId -> Map<clientId, ws>
 * Mesh topology: every client exchanges offers/answers/ICE via signaling.
 */
const rooms = new Map();

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Map());
  }
  return rooms.get(roomId);
}

function broadcastExcept(roomMap, excludeClientId, messageObj) {
  const payload = JSON.stringify(messageObj);
  for (const [clientId, socket] of roomMap.entries()) {
    if (clientId === excludeClientId) continue;
    if (socket.readyState === socket.OPEN) {
      socket.send(payload);
    }
  }
}

const wss = new WebSocketServer({ port: PORT });
console.log(`[signaling] listening on :${PORT}`);

wss.on('connection', (ws) => {
  let currentRoomId = null;
  let currentClientId = null;

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', reason: 'invalid_json' }));
      return;
    }

    const { type } = msg || {};
    switch (type) {
      case 'join': {
        const { roomId, clientId } = msg;
        if (!roomId || !clientId) {
          ws.send(JSON.stringify({ type: 'error', reason: 'missing_params' }));
          return;
        }
        currentRoomId = roomId;
        currentClientId = clientId;
        const room = getOrCreateRoom(roomId);
        room.set(clientId, ws);

        // Send existing peers to the new client
        const peers = Array.from(room.keys()).filter((id) => id !== clientId);
        ws.send(JSON.stringify({ type: 'peers', peers }));

        // Notify everyone else that a new peer joined
        broadcastExcept(room, clientId, { type: 'peer-joined', clientId });
        break;
      }
      case 'signal': {
        const { targetId } = msg;
        if (!currentRoomId || !currentClientId || !targetId) return;
        const room = rooms.get(currentRoomId);
        const target = room && room.get(targetId);
        if (target && target.readyState === target.OPEN) {
          target.send(JSON.stringify({
            type: 'signal',
            from: currentClientId,
            data: msg.data,
          }));
        }
        break;
      }
      case 'leave': {
        if (!currentRoomId || !currentClientId) return;
        const room = rooms.get(currentRoomId);
        if (room) {
          room.delete(currentClientId);
          broadcastExcept(room, currentClientId, { type: 'peer-left', clientId: currentClientId });
          if (room.size === 0) rooms.delete(currentRoomId);
        }
        currentRoomId = null;
        currentClientId = null;
        break;
      }
      default:
        ws.send(JSON.stringify({ type: 'error', reason: 'unknown_type' }));
    }
  });

  ws.on('close', () => {
    if (!currentRoomId || !currentClientId) return;
    const room = rooms.get(currentRoomId);
    if (room) {
      room.delete(currentClientId);
      broadcastExcept(room, currentClientId, { type: 'peer-left', clientId: currentClientId });
      if (room.size === 0) rooms.delete(currentRoomId);
    }
  });
});

process.on('SIGINT', () => {
  console.log('\n[signaling] shutting down');
  wss.close(() => process.exit(0));
});

