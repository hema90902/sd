#!/usr/bin/env node

/**
 * WebRTC Signaling Server with Automatic Room Clustering
 * Supports up to 24 peers per room with automatic room management
 */

const WebSocket = require('ws');
const http = require('http');
const url = require('url');

// Configuration
const PORT = process.env.PORT || 8080;
const MAX_PEERS_PER_ROOM = 24;

// Data structures
const rooms = new Map(); // roomId -> Set of peer objects
const peers = new Map(); // peerId -> peer object
const peerToRoom = new Map(); // peerId -> roomId

// Peer object structure
class Peer {
    constructor(id, ws, username, gender) {
        this.id = id;
        this.ws = ws;
        this.username = username || `User_${id.substring(0, 8)}`;
        this.gender = gender || 'unknown';
        this.roomId = null;
        this.isAlive = true;
        this.lastPing = Date.now();
    }

    send(data) {
        if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    updateLastPing() {
        this.lastPing = Date.now();
    }
}

// Room management functions
function findAvailableRoom() {
    for (const [roomId, peers] of rooms.entries()) {
        if (peers.size < MAX_PEERS_PER_ROOM) {
            return roomId;
        }
    }
    return null;
}

function createNewRoom() {
    const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    rooms.set(roomId, new Set());
    console.log(`📦 Created new room: ${roomId}`);
    return roomId;
}

function addPeerToRoom(peer, roomId) {
    // Remove peer from previous room if exists
    if (peer.roomId) {
        removePeerFromRoom(peer);
    }

    // Add to new room
    peer.roomId = roomId;
    peerToRoom.set(peer.id, roomId);
    
    if (!rooms.has(roomId)) {
        rooms.set(roomId, new Set());
    }
    
    rooms.get(roomId).add(peer);
    console.log(`👤 Peer ${peer.username} (${peer.id}) joined room ${roomId}`);
}

function removePeerFromRoom(peer) {
    if (!peer.roomId) return;

    const room = rooms.get(peer.roomId);
    if (room) {
        room.delete(peer);
        
        // Notify other peers in the room
        const peerList = Array.from(room).map(p => ({
            id: p.id,
            username: p.username,
            gender: p.gender
        }));

        room.forEach(otherPeer => {
            if (otherPeer.id !== peer.id) {
                otherPeer.send({
                    type: 'peer_left',
                    peerId: peer.id,
                    username: peer.username,
                    remainingPeers: peerList
                });
            }
        });

        // Clean up empty rooms
        if (room.size === 0) {
            rooms.delete(peer.roomId);
            console.log(`🗑️  Deleted empty room: ${peer.roomId}`);
        }
    }

    peerToRoom.delete(peer.id);
    peer.roomId = null;
    console.log(`👋 Peer ${peer.username} (${peer.id}) left room`);
}

function getRoomPeers(roomId) {
    const room = rooms.get(roomId);
    if (!room) return [];
    
    return Array.from(room).map(peer => ({
        id: peer.id,
        username: peer.username,
        gender: peer.gender
    }));
}

// WebSocket server setup
const server = http.createServer();
const wss = new WebSocket.Server({ 
    server,
    perMessageDeflate: false // Disable compression for better performance
});

// Handle new WebSocket connections
wss.on('connection', (ws, request) => {
    const query = url.parse(request.url, true).query;
    const peerId = query.peerId || `peer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const username = query.username || `User_${peerId.substring(0, 8)}`;
    const gender = query.gender || 'unknown';

    console.log(`🔌 New connection: ${peerId} (${username})`);

    // Create peer object
    const peer = new Peer(peerId, ws, username, gender);
    peers.set(peerId, peer);

    // Find or create room
    let roomId = findAvailableRoom();
    if (!roomId) {
        roomId = createNewRoom();
    }

    // Add peer to room
    addPeerToRoom(peer, roomId);

    // Get existing peers in the room
    const existingPeers = getRoomPeers(roomId).filter(p => p.id !== peerId);

    // Send welcome message to new peer
    peer.send({
        type: 'welcome',
        peerId: peerId,
        roomId: roomId,
        existingPeers: existingPeers,
        timestamp: Date.now()
    });

    // Notify existing peers about new peer
    const room = rooms.get(roomId);
    if (room) {
        room.forEach(otherPeer => {
            if (otherPeer.id !== peerId) {
                otherPeer.send({
                    type: 'peer_joined',
                    peerId: peerId,
                    username: username,
                    gender: gender,
                    timestamp: Date.now()
                });
            }
        });
    }

    // Handle incoming messages
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            handleMessage(peer, message);
        } catch (error) {
            console.error(`❌ Invalid JSON from ${peerId}:`, error.message);
            peer.send({
                type: 'error',
                message: 'Invalid JSON format',
                timestamp: Date.now()
            });
        }
    });

    // Handle connection close
    ws.on('close', (code, reason) => {
        console.log(`🔌 Connection closed: ${peerId} (${code}: ${reason})`);
        cleanupPeer(peer);
    });

    // Handle connection errors
    ws.on('error', (error) => {
        console.error(`❌ WebSocket error for ${peerId}:`, error.message);
        cleanupPeer(peer);
    });

    // Set up ping/pong for connection health
    ws.on('pong', () => {
        peer.updateLastPing();
    });
});

// Handle different message types
function handleMessage(peer, message) {
    const { type } = message;

    switch (type) {
        case 'offer':
        case 'answer':
        case 'ice_candidate':
            handleSignalingMessage(peer, message);
            break;
        
        case 'ping':
            peer.send({ type: 'pong', timestamp: Date.now() });
            break;
        
        case 'update_profile':
            handleProfileUpdate(peer, message);
            break;
        
        default:
            console.warn(`⚠️  Unknown message type from ${peer.id}: ${type}`);
            peer.send({
                type: 'error',
                message: `Unknown message type: ${type}`,
                timestamp: Date.now()
            });
    }
}

// Handle signaling messages (SDP offers/answers, ICE candidates)
function handleSignalingMessage(sender, message) {
    const { type, targetPeerId, callId } = message;
    
    if (!targetPeerId) {
        sender.send({
            type: 'error',
            message: 'Missing targetPeerId',
            timestamp: Date.now()
        });
        return;
    }

    const targetPeer = peers.get(targetPeerId);
    if (!targetPeer) {
        sender.send({
            type: 'error',
            message: `Target peer ${targetPeerId} not found`,
            timestamp: Date.now()
        });
        return;
    }

    // Check if both peers are in the same room
    if (sender.roomId !== targetPeer.roomId) {
        sender.send({
            type: 'error',
            message: 'Peers must be in the same room to communicate',
            timestamp: Date.now()
        });
        return;
    }

    // Forward message to target peer
    targetPeer.send({
        ...message,
        senderPeerId: sender.id,
        senderUsername: sender.username,
        timestamp: Date.now()
    });

    console.log(`📡 ${type} from ${sender.username} to ${targetPeer.username}`);
}

// Handle profile updates
function handleProfileUpdate(peer, message) {
    const { username, gender } = message;
    
    if (username) peer.username = username;
    if (gender) peer.gender = gender;

    // Notify other peers in the room
    const room = rooms.get(peer.roomId);
    if (room) {
        room.forEach(otherPeer => {
            if (otherPeer.id !== peer.id) {
                otherPeer.send({
                    type: 'peer_updated',
                    peerId: peer.id,
                    username: peer.username,
                    gender: peer.gender,
                    timestamp: Date.now()
                });
            }
        });
    }

    peer.send({
        type: 'profile_updated',
        username: peer.username,
        gender: peer.gender,
        timestamp: Date.now()
    });

    console.log(`👤 Profile updated for ${peer.id}: ${peer.username} (${peer.gender})`);
}

// Clean up peer resources
function cleanupPeer(peer) {
    removePeerFromRoom(peer);
    peers.delete(peer.id);
    peer.isAlive = false;
}

// Health check and cleanup
setInterval(() => {
    const now = Date.now();
    const timeout = 30000; // 30 seconds

    peers.forEach((peer, peerId) => {
        if (now - peer.lastPing > timeout) {
            console.log(`💀 Removing inactive peer: ${peerId}`);
            cleanupPeer(peer);
        }
    });
}, 10000); // Check every 10 seconds

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down server...');
    
    // Notify all peers about server shutdown
    peers.forEach(peer => {
        peer.send({
            type: 'server_shutdown',
            message: 'Server is shutting down',
            timestamp: Date.now()
        });
    });

    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
    console.log('🚀 WebRTC Signaling Server Started');
    console.log(`📡 Listening on port ${PORT}`);
    console.log(`👥 Max peers per room: ${MAX_PEERS_PER_ROOM}`);
    console.log(`🌐 WebSocket URL: ws://0.0.0.0:${PORT}`);
    console.log('📱 Ready for Android TV connections');
    console.log('=====================================');
});

// Log server stats periodically
setInterval(() => {
    const totalPeers = peers.size;
    const totalRooms = rooms.size;
    const roomStats = Array.from(rooms.entries()).map(([id, roomPeers]) => 
        `${id}: ${roomPeers.size} peers`
    ).join(', ');

    console.log(`📊 Stats - Peers: ${totalPeers}, Rooms: ${totalRooms} [${roomStats}]`);
}, 60000); // Every minute
