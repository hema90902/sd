package com.example.p2pgroupchat

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                App()
            }
        }
    }
}

@Composable
fun App(vm: ChatViewModel = viewModel()) {
    var roomId by remember { mutableStateOf("test-room") }
    var name by remember { mutableStateOf(randomClientId()) }
    var input by remember { mutableStateOf("") }

    LaunchedEffect(Unit) {
        vm.setSelfId(name)
    }

    Surface(Modifier.fillMaxSize()) {
        Column(Modifier.padding(16.dp)) {
            Text(text = "Room", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(value = roomId, onValueChange = { roomId = it }, label = { Text("Room ID") })
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("Your ID") })
            Spacer(Modifier.height(8.dp))
            Row {
                Button(onClick = { vm.connectAndJoin(roomId, name) }) { Text("Join") }
                Spacer(Modifier.width(8.dp))
                Button(onClick = { vm.leaveRoom() }, enabled = vm.connected) { Text("Leave") }
            }
            Spacer(Modifier.height(16.dp))
            Text(text = "Peers: ${'$'}{vm.peers.joinToString()}")
            Spacer(Modifier.height(16.dp))
            OutlinedTextField(
                value = input,
                onValueChange = { input = it },
                label = { Text("Message") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = {
                    if (input.isNotBlank()) {
                        vm.sendMessageToAll(input)
                        input = ""
                    }
                }),
            )
            Spacer(Modifier.height(8.dp))
            Button(onClick = {
                if (input.isNotBlank()) {
                    vm.sendMessageToAll(input)
                    input = ""
                }
            }) { Text("Send") }
            Spacer(Modifier.height(16.dp))
            Text("Messages:")
            for (m in vm.messages) {
                Text("${'$'}{m.first}: ${'$'}{m.second}")
            }
        }
    }
}

fun randomClientId(): String = (1000..9999).random().toString()

