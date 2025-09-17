#!/usr/bin/env node

/**
 * Test client for WebRTC Signaling Server
 * Simulates multiple Android TV clients connecting to test room clustering
 */

const WebSocket = require('ws');

const SERVER_URL = 'ws://localhost:8080';
const NUM_CLIENTS = 5;

class TestClient {
    constructor(id, username, gender) {
        this.id = `test_peer_${id}`;
        this.username = username;
        this.gender = gender;
        this.ws = null;
        this.roomId = null;
        this.peers = new Map();
    }

    connect() {
        return new Promise((resolve, reject) => {
            const url = `${SERVER_URL}?peerId=${this.id}&username=${this.username}&gender=${this.gender}`;
            this.ws = new WebSocket(url);

            this.ws.on('open', () => {
                console.log(`✅ ${this.username} connected`);
                resolve();
            });

            this.ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data);
                    this.handleMessage(message);
                } catch (error) {
                    console.error(`❌ ${this.username}: Invalid JSON:`, error.message);
                }
            });

            this.ws.on('close', () => {
                console.log(`🔌 ${this.username} disconnected`);
            });

            this.ws.on('error', (error) => {
                console.error(`❌ ${this.username}: WebSocket error:`, error.message);
                reject(error);
            });
        });
    }

    handleMessage(message) {
        const { type } = message;

        switch (type) {
            case 'welcome':
                this.roomId = message.roomId;
                console.log(`🏠 ${this.username} joined room: ${this.roomId}`);
                if (message.existingPeers.length > 0) {
                    console.log(`👥 ${this.username} sees ${message.existingPeers.length} existing peers`);
                }
                break;

            case 'peer_joined':
                console.log(`👋 ${this.username} sees new peer: ${message.username} (${message.gender})`);
                this.peers.set(message.peerId, {
                    id: message.peerId,
                    username: message.username,
                    gender: message.gender
                });
                break;

            case 'peer_left':
                console.log(`👋 ${this.username} sees peer left: ${message.username}`);
                this.peers.delete(message.peerId);
                break;

            case 'peer_updated':
                console.log(`👤 ${this.username} sees peer updated: ${message.username} (${message.gender})`);
                this.peers.set(message.peerId, {
                    id: message.peerId,
                    username: message.username,
                    gender: message.gender
                });
                break;

            case 'error':
                console.error(`❌ ${this.username} received error: ${message.message}`);
                break;

            case 'pong':
                // Handle ping response
                break;

            default:
                console.log(`📨 ${this.username} received: ${type}`);
        }
    }

    sendMessage(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        }
    }

    updateProfile(username, gender) {
        this.sendMessage({
            type: 'update_profile',
            username: username,
            gender: gender
        });
    }

    sendPing() {
        this.sendMessage({
            type: 'ping',
            timestamp: Date.now()
        });
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
        }
    }
}

// Test scenarios
async function runTests() {
    console.log('🧪 Starting WebRTC Signaling Server Tests');
    console.log('==========================================');

    const clients = [];
    const genders = ['male', 'female', 'other'];
    const usernames = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry'];

    // Create and connect clients
    for (let i = 0; i < NUM_CLIENTS; i++) {
        const client = new TestClient(
            i,
            usernames[i] || `User${i}`,
            genders[i % genders.length]
        );
        clients.push(client);
    }

    try {
        // Connect all clients
        console.log('\n🔌 Connecting clients...');
        for (const client of clients) {
            await client.connect();
            await new Promise(resolve => setTimeout(resolve, 100)); // Small delay
        }

        // Wait a bit for all connections to settle
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Test profile updates
        console.log('\n👤 Testing profile updates...');
        clients[0].updateProfile('AliceUpdated', 'female');
        await new Promise(resolve => setTimeout(resolve, 500));

        // Test ping/pong
        console.log('\n🏓 Testing ping/pong...');
        clients.forEach(client => client.sendPing());
        await new Promise(resolve => setTimeout(resolve, 500));

        // Test room clustering by creating more clients
        console.log('\n📦 Testing room clustering...');
        const extraClients = [];
        for (let i = NUM_CLIENTS; i < NUM_CLIENTS + 3; i++) {
            const client = new TestClient(
                i,
                usernames[i] || `User${i}`,
                genders[i % genders.length]
            );
            extraClients.push(client);
            await client.connect();
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        // Wait and then disconnect some clients
        await new Promise(resolve => setTimeout(resolve, 2000));
        console.log('\n👋 Testing disconnections...');
        clients[0].disconnect();
        clients[1].disconnect();
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Clean up
        console.log('\n🧹 Cleaning up...');
        clients.forEach(client => client.disconnect());
        extraClients.forEach(client => client.disconnect());

        console.log('\n✅ Tests completed successfully!');
        console.log('==========================================');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        process.exit(1);
    }
}

// Run tests if this file is executed directly
if (require.main === module) {
    runTests().then(() => {
        process.exit(0);
    }).catch(error => {
        console.error('❌ Test suite failed:', error);
        process.exit(1);
    });
}

module.exports = { TestClient };
