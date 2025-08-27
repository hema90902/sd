package com.example.p2pgroupchat

import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class SignalingClient {
    private val http = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    private var ws: WebSocket? = null
    var selfId: String = ""
    var roomId: String = ""

    private val _events = MutableSharedFlow<SignalEvent>(
        replay = 0, extraBufferCapacity = 64, onBufferOverflow = BufferOverflow.DROP_OLDEST
    )
    val events: SharedFlow<SignalEvent> = _events

    fun connect(url: String = DEFAULT_URL) {
        if (ws != null) return
        val req = Request.Builder().url(url).build()
        ws = http.newWebSocket(req, object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                val obj = JSONObject(text)
                when (obj.getString("type")) {
                    "peers" -> {
                        val peers = obj.getJSONArray("peers")
                        val list = mutableListOf<String>()
                        for (i in 0 until peers.length()) list += peers.getString(i)
                        emit(SignalEvent.Peers(list))
                    }
                    "peer-joined" -> emit(SignalEvent.PeerJoined(obj.getString("clientId")))
                    "peer-left" -> emit(SignalEvent.PeerLeft(obj.getString("clientId")))
                    "signal" -> emit(SignalEvent.SignalFrom(obj.getString("from"), obj.getJSONObject("data").toString()))
                }
            }
        })
    }

    fun joinRoom(room: String) {
        roomId = room
        val msg = JSONObject()
            .put("type", "join")
            .put("roomId", room)
            .put("clientId", selfId)
        ws?.send(msg.toString())
    }

    fun leaveRoom() {
        val msg = JSONObject().put("type", "leave")
        ws?.send(msg.toString())
    }

    fun sendSignal(targetId: String, payload: JSONObject) {
        val msg = JSONObject()
            .put("type", "signal")
            .put("targetId", targetId)
            .put("data", payload)
        ws?.send(msg.toString())
    }

    private fun emit(e: SignalEvent) {
        _events.tryEmit(e)
    }

    companion object {
        const val DEFAULT_URL = "ws://10.0.2.2:8080" // Android emulator -> host
    }
}

sealed class SignalEvent {
    data class Peers(val peers: List<String>) : SignalEvent()
    data class PeerJoined(val clientId: String) : SignalEvent()
    data class PeerLeft(val clientId: String) : SignalEvent()
    data class SignalFrom(val from: String, val data: String) : SignalEvent()
}

