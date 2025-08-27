package com.example.p2pgroupchat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class ChatViewModel : ViewModel() {
    private val signalingClient = SignalingClient()
    private lateinit var rtcMesh: RtcMesh
        onPeerListUpdated = { peersFlow.value = it },
        onMessageReceived = { from, text ->
            viewModelScope.launch(Dispatchers.Main) {
                val list = messagesFlow.value.toMutableList()
                list.add(from to text)
                messagesFlow.value = list
            }
        }
    )

    private val peersFlow = MutableStateFlow<List<String>>(emptyList())
    val peers: List<String> get() = peersFlow.value

    private val messagesFlow = MutableStateFlow<List<Pair<String, String>>>(emptyList())
    val messages: List<Pair<String, String>> get() = messagesFlow.value

    var connected: Boolean = false
        private set

    fun setSelfId(id: String) {
        signalingClient.selfId = id
    }

    fun connectAndJoin(roomId: String, selfId: String) {
        viewModelScope.launch(Dispatchers.IO) {
            signalingClient.selfId = selfId
            signalingClient.connect()
            if (!this@ChatViewModel::rtcMesh.isInitialized) {
                // Lazy create with application context via reflection-less fallback
                val appContext = try {
                    Class.forName("android.app.ActivityThread").getMethod("currentApplication").invoke(null) as android.app.Application
                } catch (t: Throwable) {
                    null
                }?.applicationContext
                requireNotNull(appContext) { "Application context unavailable" }
                rtcMesh = RtcMesh(appContext, signalingClient,
                    onPeerListUpdated = { peersFlow.value = it },
                    onMessageReceived = { from, text ->
                        viewModelScope.launch(Dispatchers.Main) {
                            val list = messagesFlow.value.toMutableList()
                            list.add(from to text)
                            messagesFlow.value = list
                        }
                    }
                )
            }
            rtcMesh.start()
            signalingClient.joinRoom(roomId)
            connected = true
        }
    }

    fun leaveRoom() {
        viewModelScope.launch(Dispatchers.IO) {
            signalingClient.leaveRoom()
            rtcMesh.stop()
            connected = false
        }
    }

    fun sendMessageToAll(text: String) {
        if (this::rtcMesh.isInitialized) rtcMesh.broadcastMessage(text)
        viewModelScope.launch(Dispatchers.Main) {
            val list = messagesFlow.value.toMutableList()
            list.add("me" to text)
            messagesFlow.value = list
        }
    }
}

