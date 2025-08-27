package com.example.p2pgroupchat

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.webrtc.*
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap

class RtcMesh(
    private val context: Context,
    private val signalingClient: SignalingClient,
    private val onPeerListUpdated: (List<String>) -> Unit,
    private val onMessageReceived: (from: String, message: String) -> Unit,
) {
    private val scope = CoroutineScope(Dispatchers.IO)

    private var factory: PeerConnectionFactory? = null
    private var eglBase: EglBase? = null

    private val peerIdToPeer = ConcurrentHashMap<String, Peer>()
    private var collectJob: Job? = null

    fun start() {
        if (factory != null) return
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context.applicationContext)
                .createInitializationOptions()
        )
        eglBase = EglBase.create()
        val encoderFactory = DefaultVideoEncoderFactory(eglBase!!.eglBaseContext, true, true)
        val decoderFactory = DefaultVideoDecoderFactory(eglBase!!.eglBaseContext)
        factory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(encoderFactory)
            .setVideoDecoderFactory(decoderFactory)
            .createPeerConnectionFactory()

        collectJob = scope.launch {
            signalingClient.events.collect { event ->
                when (event) {
                    is SignalEvent.Peers -> handlePeers(event.peers)
                    is SignalEvent.PeerJoined -> handlePeerJoined(event.clientId)
                    is SignalEvent.PeerLeft -> handlePeerLeft(event.clientId)
                    is SignalEvent.SignalFrom -> handleSignal(event.from, event.data)
                }
            }
        }
    }

    fun stop() {
        collectJob?.cancel()
        collectJob = null
        peerIdToPeer.values.forEach { it.close() }
        peerIdToPeer.clear()
        factory?.dispose()
        factory = null
        eglBase?.release()
        eglBase = null
    }

    fun broadcastMessage(text: String) {
        val buffer = DataChannel.Buffer(ByteBuffer.wrap(text.toByteArray(Charsets.UTF_8)), false)
        peerIdToPeer.forEach { (_, peer) ->
            peer.dataChannel?.takeIf { it.state() == DataChannel.State.OPEN }?.send(buffer)
        }
    }

    private fun handlePeers(peers: List<String>) {
        onPeerListUpdated(peers)
        for (remoteId in peers) ensurePeer(remoteId)
        // Offer policy: the lexicographically larger id initiates
        for (remoteId in peers) if (shouldInitiateOffer(remoteId)) createAndSendOffer(remoteId)
    }

    private fun handlePeerJoined(remoteId: String) {
        val peers = (peerIdToPeer.keys + remoteId).distinct()
        onPeerListUpdated(peers)
        ensurePeer(remoteId)
        if (shouldInitiateOffer(remoteId)) createAndSendOffer(remoteId)
    }

    private fun handlePeerLeft(remoteId: String) {
        peerIdToPeer.remove(remoteId)?.close()
        onPeerListUpdated(peerIdToPeer.keys.toList())
    }

    private fun handleSignal(from: String, data: String) {
        ensurePeer(from)
        val peer = peerIdToPeer[from] ?: return
        val obj = JSONObject(data)
        when (obj.getString("type")) {
            "sdp" -> {
                val sdpObj = obj.getJSONObject("sdp")
                val desc = SessionDescription(
                    SessionDescription.Type.fromCanonicalForm(sdpObj.getString("type")),
                    sdpObj.getString("sdp")
                )
                peer.pc.setRemoteDescription(object : SimpleSdpObserver() {}, desc)
                if (desc.type == SessionDescription.Type.OFFER) {
                    peer.pc.createAnswer(object : SimpleSdpObserver() {
                        override fun onCreateSuccess(answer: SessionDescription) {
                            peer.pc.setLocalDescription(object : SimpleSdpObserver() {}, answer)
                            val payload = JSONObject()
                                .put("type", "sdp")
                                .put("sdp", JSONObject().put("type", "answer").put("sdp", answer.description))
                            signalingClient.sendSignal(from, payload)
                        }
                    }, MediaConstraints())
                }
            }
            "ice" -> {
                val ice = obj.getJSONObject("ice")
                val candidate = IceCandidate(
                    ice.getString("sdpMid"),
                    ice.getInt("sdpMLineIndex"),
                    ice.getString("candidate")
                )
                peer.pc.addIceCandidate(candidate)
            }
        }
    }

    private fun ensurePeer(remoteId: String) {
        if (peerIdToPeer.containsKey(remoteId)) return
        val rtcConfig = PeerConnection.RTCConfiguration(listOf(
            PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
            PeerConnection.IceServer.builder("stun:global.stun.twilio.com:3478?transport=udp").createIceServer()
        ))
        val pc = factory!!.createPeerConnection(rtcConfig, object : PeerConnection.Observer {
            override fun onIceCandidate(candidate: IceCandidate) {
                val payload = JSONObject()
                    .put("type", "ice")
                    .put("ice", JSONObject()
                        .put("sdpMid", candidate.sdpMid)
                        .put("sdpMLineIndex", candidate.sdpMLineIndex)
                        .put("candidate", candidate.sdp))
                signalingClient.sendSignal(remoteId, payload)
            }
            override fun onDataChannel(dc: DataChannel) {
                val peer = peerIdToPeer[remoteId] ?: return
                peer.dataChannel = dc
                dc.registerObserver(object : DataChannel.Observer {
                    override fun onBufferedAmountChange(previousAmount: Long) {}
                    override fun onStateChange() {}
                    override fun onMessage(buffer: DataChannel.Buffer) {
                        val data = ByteArray(buffer.data.remaining())
                        buffer.data.get(data)
                        onMessageReceived(remoteId, data.toString(Charsets.UTF_8))
                    }
                })
            }
            override fun onConnectionChange(newState: PeerConnection.PeerConnectionState) {}
            override fun onIceConnectionChange(newState: PeerConnection.IceConnectionState) {}
            override fun onStandardizedIceConnectionChange(newState: PeerConnection.IceConnectionState) {}
            override fun onSignalingChange(newState: PeerConnection.SignalingState) {}
            override fun onIceGatheringChange(newState: PeerConnection.IceGatheringState) {}
            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) {}
            override fun onSelectedCandidatePairChanged(event: CandidatePairChangeEvent?) {}
            override fun onAddStream(stream: MediaStream) {}
            override fun onRemoveStream(stream: MediaStream) {}
            override fun onTrack(transceiver: RtpTransceiver) {}
            override fun onAddTrack(receiver: RtpReceiver, streams: Array<out MediaStream>) {}
            override fun onNegotiationNeeded() {}
        }) ?: throw IllegalStateException("Failed to create PeerConnection")

        val peer = Peer(remoteId, pc, null)
        peerIdToPeer[remoteId] = peer
    }

    private fun shouldInitiateOffer(remoteId: String): Boolean {
        val self = signalingClient.selfId
        return self.isNotEmpty() && self > remoteId
    }

    private fun createAndSendOffer(remoteId: String) {
        val peer = peerIdToPeer[remoteId] ?: return
        if (peer.dataChannel == null) {
            peer.dataChannel = peer.pc.createDataChannel("chat", DataChannel.Init())
            peer.dataChannel?.registerObserver(object : DataChannel.Observer {
                override fun onBufferedAmountChange(previousAmount: Long) {}
                override fun onStateChange() {}
                override fun onMessage(buffer: DataChannel.Buffer) {
                    val data = ByteArray(buffer.data.remaining())
                    buffer.data.get(data)
                    onMessageReceived(remoteId, data.toString(Charsets.UTF_8))
                }
            })
        }
        peer.pc.createOffer(object : SimpleSdpObserver() {
            override fun onCreateSuccess(offer: SessionDescription) {
                peer.pc.setLocalDescription(object : SimpleSdpObserver() {}, offer)
                val payload = JSONObject()
                    .put("type", "sdp")
                    .put("sdp", JSONObject().put("type", "offer").put("sdp", offer.description))
                signalingClient.sendSignal(remoteId, payload)
            }
        }, MediaConstraints())
    }

    private data class Peer(
        val remoteId: String,
        val pc: PeerConnection,
        var dataChannel: DataChannel?
    ) {
        fun close() {
            dataChannel?.close()
            pc.close()
        }
    }
}

open class SimpleSdpObserver : SdpObserver {
    override fun onCreateSuccess(sessionDescription: SessionDescription) {}
    override fun onSetSuccess() {}
    override fun onCreateFailure(s: String) {}
    override fun onSetFailure(s: String) {}
}

