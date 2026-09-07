package com.kotha.app.ui.chat

import android.Manifest
import android.content.pm.PackageManager
import android.text.format.DateFormat
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.kotha.app.R
import com.kotha.app.data.audio.VoiceMessagePlayer
import com.kotha.app.data.audio.VoiceMessageRecorder
import com.kotha.app.data.repository.ChatRepository
import com.kotha.app.domain.model.CallType
import com.kotha.app.domain.model.Message
import com.kotha.app.domain.model.MessageType
import com.kotha.app.domain.model.User
import kotlinx.coroutines.launch
import java.util.Date
import java.util.UUID

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    currentUserId: String,
    targetUser: User,
    onBack: () -> Unit,
    onStartCall: (User, CallType) -> Unit,
    chatRepository: ChatRepository = remember { ChatRepository() }
) {
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()
    val listState = rememberLazyListState()

    val chatId = remember(currentUserId, targetUser.userId) {
        ChatRepository.getDeterministicChatId(currentUserId, targetUser.userId)
    }

    var messages by remember { mutableStateOf<List<Message>>(emptyList()) }
    var textInput by remember { mutableStateOf("") }
    var isUploadingVoice by remember { mutableStateOf(false) }

    // Audio recorder and player instances
    val recorder = remember { VoiceMessageRecorder(context) }
    val player = remember { VoiceMessagePlayer(context) }

    val isRecording by recorder.isRecording.collectAsState()
    val recordingDurationMs by recorder.durationMs.collectAsState()
    val recordingAmplitude by recorder.amplitude.collectAsState()

    val playbackState by player.playbackState.collectAsState()

    // Permission launcher for microphone recording
    val micPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        if (isGranted) {
            val started = recorder.startRecording()
            if (!started) {
                Toast.makeText(context, "Failed to start audio recording", Toast.LENGTH_SHORT).show()
            }
        } else {
            Toast.makeText(context, context.getString(R.string.mic_permission_required), Toast.LENGTH_LONG).show()
        }
    }

    // Subscribe to real-time chat messages
    DisposableEffect(chatId) {
        val listener = chatRepository.subscribeToMessages(chatId) { updatedList ->
            messages = updatedList
            if (updatedList.isNotEmpty()) {
                coroutineScope.launch {
                    listState.animateScrollToItem(updatedList.size - 1)
                }
            }
        }
        onDispose {
            listener.remove()
            player.release()
            recorder.cancelRecording()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(40.dp)
                                .clip(CircleShape)
                                .background(Color(0xFF334155)),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                imageVector = Icons.Default.Person,
                                contentDescription = null,
                                tint = Color.White,
                                modifier = Modifier.size(24.dp)
                            )
                        }
                        Spacer(modifier = Modifier.width(12.dp))
                        Column {
                            Text(
                                text = targetUser.fullName,
                                color = Color.White,
                                fontSize = 16.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                            Text(
                                text = if (targetUser.isOnline) stringResource(R.string.online) else targetUser.phoneNumber,
                                color = if (targetUser.isOnline) Color(0xFF22C55E) else Color(0xFF94A3B8),
                                fontSize = 12.sp
                            )
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = {
                        player.stop()
                        onBack()
                    }) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back", tint = Color.White)
                    }
                },
                actions = {
                    IconButton(onClick = {
                        player.stop()
                        onStartCall(targetUser, CallType.AUDIO)
                    }) {
                        Icon(Icons.Default.Call, contentDescription = stringResource(R.string.audio_call), tint = Color(0xFF38BDF8))
                    }
                    IconButton(onClick = {
                        player.stop()
                        onStartCall(targetUser, CallType.VIDEO)
                    }) {
                        Icon(Icons.Default.Videocam, contentDescription = stringResource(R.string.video_call), tint = Color(0xFF22C55E))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Color(0xFF0F172A))
            )
        },
        containerColor = Color(0xFF0F172A)
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .imePadding()
        ) {
            // Messages List
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
            ) {
                if (messages.isEmpty()) {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = stringResource(R.string.no_messages_yet),
                            color = Color(0xFF64748B),
                            fontSize = 14.sp
                        )
                    }
                } else {
                    LazyColumn(
                        state = listState,
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        items(messages, key = { it.messageId }) { msg ->
                            val isMe = msg.senderId == currentUserId
                            ChatMessageBubble(
                                message = msg,
                                isMe = isMe,
                                playbackState = playbackState,
                                onPlayVoice = { audioUrl, durationHint ->
                                    player.play(audioUrl, durationHint)
                                },
                                onPauseVoice = {
                                    player.pause()
                                }
                            )
                        }
                    }
                }

                // Voice upload progress indicator overlay
                if (isUploadingVoice) {
                    Surface(
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .padding(bottom = 16.dp),
                        shape = RoundedCornerShape(20.dp),
                        color = Color(0xDD1E293B)
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(16.dp),
                                strokeWidth = 2.dp,
                                color = Color(0xFF38BDF8)
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = stringResource(R.string.sending_voice),
                                color = Color.White,
                                fontSize = 12.sp
                            )
                        }
                    }
                }
            }

            // Bottom Input Dock (Text Input & Voice Message Recorder)
            Surface(
                modifier = Modifier.fillMaxWidth(),
                color = Color(0xFF1E293B),
                tonalElevation = 6.dp
            ) {
                if (isRecording) {
                    // Active Voice Recording Bar
                    ActiveRecordingDock(
                        durationMs = recordingDurationMs,
                        amplitude = recordingAmplitude,
                        onCancel = {
                            recorder.cancelRecording()
                        },
                        onSend = {
                            val result = recorder.stopRecording()
                            if (result != null) {
                                coroutineScope.launch {
                                    isUploadingVoice = true
                                    val uploadResult = chatRepository.uploadVoiceMessage(chatId, result.audioFile)
                                    isUploadingVoice = false

                                    if (uploadResult.isSuccess) {
                                        val downloadUrl = uploadResult.getOrThrow()
                                        val voiceMsg = Message(
                                            messageId = "msg_${UUID.randomUUID()}",
                                            senderId = currentUserId,
                                            receiverId = targetUser.userId,
                                            type = MessageType.VOICE,
                                            mediaUrl = downloadUrl,
                                            mediaDurationMs = result.durationMs,
                                            timestamp = System.currentTimeMillis()
                                        )
                                        chatRepository.sendMessage(chatId, voiceMsg)
                                    } else {
                                        Toast.makeText(context, "Voice upload failed", Toast.LENGTH_SHORT).show()
                                    }
                                }
                            }
                        }
                    )
                } else {
                    // Standard Text Message & Record Dock
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 8.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        TextField(
                            value = textInput,
                            onValueChange = { textInput = it },
                            placeholder = {
                                Text(
                                    text = stringResource(R.string.type_a_message),
                                    color = Color(0xFF64748B),
                                    fontSize = 14.sp
                                )
                            },
                            colors = TextFieldDefaults.colors(
                                focusedContainerColor = Color(0xFF0F172A),
                                unfocusedContainerColor = Color(0xFF0F172A),
                                focusedTextColor = Color.White,
                                unfocusedTextColor = Color.White,
                                focusedIndicatorColor = Color.Transparent,
                                unfocusedIndicatorColor = Color.Transparent
                            ),
                            shape = RoundedCornerShape(24.dp),
                            modifier = Modifier
                                .weight(1f)
                                .heightIn(min = 44.dp, max = 100.dp)
                        )

                        Spacer(modifier = Modifier.width(8.dp))

                        if (textInput.isNotBlank()) {
                            // Send Text Message Button
                            IconButton(
                                onClick = {
                                    val textToSend = textInput.trim()
                                    if (textToSend.isNotEmpty()) {
                                        textInput = ""
                                        coroutineScope.launch {
                                            val textMsg = Message(
                                                messageId = "msg_${UUID.randomUUID()}",
                                                senderId = currentUserId,
                                                receiverId = targetUser.userId,
                                                text = textToSend,
                                                type = MessageType.TEXT,
                                                timestamp = System.currentTimeMillis()
                                            )
                                            chatRepository.sendMessage(chatId, textMsg)
                                        }
                                    }
                                },
                                modifier = Modifier
                                    .size(44.dp)
                                    .background(Color(0xFF38BDF8), CircleShape)
                            ) {
                                Icon(Icons.Default.Send, contentDescription = stringResource(R.string.send), tint = Color.White)
                            }
                        } else {
                            // Start Voice Recording Button
                            IconButton(
                                onClick = {
                                    val permissionCheck = ContextCompat.checkSelfPermission(
                                        context,
                                        Manifest.permission.RECORD_AUDIO
                                    )
                                    if (permissionCheck == PackageManager.PERMISSION_GRANTED) {
                                        val started = recorder.startRecording()
                                        if (!started) {
                                            Toast.makeText(context, "Could not start recording", Toast.LENGTH_SHORT).show()
                                        }
                                    } else {
                                        micPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                                    }
                                },
                                modifier = Modifier
                                    .size(44.dp)
                                    .background(Color(0xFF22C55E), CircleShape)
                            ) {
                                Icon(Icons.Default.Mic, contentDescription = stringResource(R.string.record_voice_message), tint = Color.White)
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * Dock displayed when actively recording a voice message.
 */
@Composable
private fun ActiveRecordingDock(
    durationMs: Long,
    amplitude: Int,
    onCancel: () -> Unit,
    onSend: () -> Unit
) {
    val seconds = (durationMs / 1000) % 60
    val minutes = (durationMs / 1000) / 60
    val formattedDuration = String.format("%02d:%02d", minutes, seconds)

    // Pulsing recording indicator animation
    val infiniteTransition = rememberInfiniteTransition(label = "pulse")
    val alpha by infiniteTransition.animateFloat(
        initialValue = 0.3f,
        targetValue = 1.0f,
        animationSpec = infiniteRepeatable(
            animation = tween(600, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "alpha"
    )

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        // Cancel Action
        IconButton(
            onClick = onCancel,
            modifier = Modifier
                .size(40.dp)
                .background(Color(0xFFEF4444).copy(alpha = 0.2f), CircleShape)
        ) {
            Icon(Icons.Default.Delete, contentDescription = stringResource(R.string.cancel), tint = Color(0xFFEF4444))
        }

        // Live Duration & Pulsing Red Dot
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(10.dp)
                    .clip(CircleShape)
                    .background(Color(0xFFEF4444).copy(alpha = alpha))
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = formattedDuration,
                color = Color.White,
                fontSize = 15.sp,
                fontWeight = FontWeight.Bold
            )
            Spacer(modifier = Modifier.width(12.dp))
            Text(
                text = stringResource(R.string.recording),
                color = Color(0xFF94A3B8),
                fontSize = 12.sp
            )
        }

        // Send Voice Message Action
        IconButton(
            onClick = onSend,
            modifier = Modifier
                .size(44.dp)
                .background(Color(0xFF22C55E), CircleShape)
        ) {
            Icon(Icons.Default.Send, contentDescription = stringResource(R.string.send), tint = Color.White)
        }
    }
}

/**
 * Message bubble supporting both Text and Voice messages.
 */
@Composable
private fun ChatMessageBubble(
    message: Message,
    isMe: Boolean,
    playbackState: com.kotha.app.data.audio.VoicePlaybackState,
    onPlayVoice: (String, Long?) -> Unit,
    onPauseVoice: () -> Unit
) {
    val bubbleColor = if (isMe) Color(0xFF1E3A8A) else Color(0xFF334155)
    val alignment = if (isMe) Alignment.CenterEnd else Alignment.CenterStart
    val timeFormat = DateFormat.format("hh:mm a", Date(message.timestamp)).toString()

    Box(
        modifier = Modifier.fillMaxWidth(),
        contentAlignment = alignment
    ) {
        Surface(
            color = bubbleColor,
            shape = RoundedCornerShape(
                topStart = 16.dp,
                topEnd = 16.dp,
                bottomStart = if (isMe) 16.dp else 4.dp,
                bottomEnd = if (isMe) 4.dp else 16.dp
            ),
            modifier = Modifier.widthIn(max = 300.dp)
        ) {
            Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                if (message.type == MessageType.VOICE && message.mediaUrl != null) {
                    // Voice Message Audio Player Bubble
                    VoiceMessagePlaybackBubble(
                        audioUrl = message.mediaUrl,
                        durationMs = message.mediaDurationMs ?: 0L,
                        playbackState = playbackState,
                        onPlay = { onPlayVoice(message.mediaUrl, message.mediaDurationMs) },
                        onPause = onPauseVoice
                    )
                } else {
                    // Regular Text Message
                    Text(
                        text = message.text ?: "",
                        color = Color.White,
                        fontSize = 15.sp,
                        lineHeight = 20.sp
                    )
                }

                Spacer(modifier = Modifier.height(4.dp))
                Row(
                    modifier = Modifier.align(Alignment.End),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = timeFormat,
                        color = Color(0x99FFFFFF),
                        fontSize = 10.sp
                    )
                    if (isMe) {
                        Spacer(modifier = Modifier.width(4.dp))
                        Icon(
                            imageVector = Icons.Default.DoneAll,
                            contentDescription = null,
                            tint = Color(0xFF38BDF8),
                            modifier = Modifier.size(12.dp)
                        )
                    }
                }
            }
        }
    }
}

/**
 * Audio playback bubble inside a chat message item.
 */
@Composable
private fun VoiceMessagePlaybackBubble(
    audioUrl: String,
    durationMs: Long,
    playbackState: com.kotha.app.data.audio.VoicePlaybackState,
    onPlay: () -> Unit,
    onPause: () -> Unit
) {
    val isThisAudioPlaying = playbackState.currentAudioUrl == audioUrl && playbackState.isPlaying
    val currentPos = if (playbackState.currentAudioUrl == audioUrl) playbackState.currentPositionMs else 0L
    val totalDuration = if (durationMs > 0) durationMs else playbackState.totalDurationMs

    val progress = if (totalDuration > 0) (currentPos.toFloat() / totalDuration.toFloat()).coerceIn(0f, 1f) else 0f

    val displayElapsed = (currentPos / 1000)
    val displayTotal = (totalDuration / 1000)
    val durationText = if (isThisAudioPlaying) {
        String.format("%02d:%02d / %02d:%02d", displayElapsed / 60, displayElapsed % 60, displayTotal / 60, displayTotal % 60)
    } else {
        String.format("%02d:%02d", displayTotal / 60, displayTotal % 60)
    }

    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.padding(vertical = 4.dp)
    ) {
        // Play / Pause Circle Button
        IconButton(
            onClick = {
                if (isThisAudioPlaying) onPause() else onPlay()
            },
            modifier = Modifier
                .size(36.dp)
                .background(Color(0xFF38BDF8), CircleShape)
        ) {
            Icon(
                imageVector = if (isThisAudioPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                contentDescription = if (isThisAudioPlaying) "Pause" else "Play",
                tint = Color.White,
                modifier = Modifier.size(20.dp)
            )
        }

        Spacer(modifier = Modifier.width(10.dp))

        Column(modifier = Modifier.weight(1f)) {
            // Audio Progress Bar
            LinearProgressIndicator(
                progress = { progress },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(4.dp)
                    .clip(RoundedCornerShape(2.dp)),
                color = Color(0xFF38BDF8),
                trackColor = Color(0x33FFFFFF)
            )

            Spacer(modifier = Modifier.height(4.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = durationText,
                    color = Color(0xFFCBD5E1),
                    fontSize = 11.sp
                )
                Icon(
                    imageVector = Icons.Default.GraphicEq,
                    contentDescription = null,
                    tint = if (isThisAudioPlaying) Color(0xFF38BDF8) else Color(0xFF94A3B8),
                    modifier = Modifier.size(14.dp)
                )
            }
        }
    }
}
