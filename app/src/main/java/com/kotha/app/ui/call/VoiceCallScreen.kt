package com.kotha.app.ui.call

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.kotha.app.R
import com.kotha.app.data.repository.FirestoreSignalingClient
import com.kotha.app.data.webrtc.AudioDevice
import com.kotha.app.data.webrtc.KothaAudioSwitchManager
import com.kotha.app.data.webrtc.KothaRingtoneManager
import com.kotha.app.data.webrtc.WebRtcClient
import com.kotha.app.domain.model.CallState
import com.kotha.app.domain.model.CallType
import com.kotha.app.domain.model.SdpModel
import com.kotha.app.domain.model.WebRtcCallSession
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.Locale

/**
 * Production 1-to-1 Voice Call Screen for Kotha Android.
 * Requests RECORD_AUDIO permission at call initiation.
 * Manages real Android WebRTC AudioTrack, AudioManager routing (Earpiece/Speaker/Bluetooth),
 * ringtone cutoff upon accept, and synchronized authoritative Firestore duration.
 */
@Composable
fun VoiceCallScreen(
    session: WebRtcCallSession,
    isCaller: Boolean,
    onCallEnded: () -> Unit
) {
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()

    var callState by remember { mutableStateOf(session.callState) }
    var connectedAt by remember { mutableStateOf(session.connectedAt) }
    var isMuted by remember { mutableStateOf(session.isMuted) }
    var selectedAudioDevice by remember { mutableStateOf(AudioDevice.EARPIECE) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var elapsedSeconds by remember { mutableStateOf(0L) }

    val ringtoneManager = remember { KothaRingtoneManager(context) }
    val audioSwitchManager = remember {
        KothaAudioSwitchManager(context) { newDevice ->
            selectedAudioDevice = newDevice
        }
    }
    val signalingClient = remember { FirestoreSignalingClient() }

    var webRtcClient by remember { mutableStateOf<WebRtcClient?>(null) }

    // Synchronized duration timer based on authoritative Firestore connectedAt timestamp
    LaunchedEffect(callState, connectedAt) {
        if (callState == CallState.CONNECTED && connectedAt != null) {
            while (true) {
                val now = System.currentTimeMillis()
                val diff = (now - (connectedAt ?: now)) / 1000
                elapsedSeconds = if (diff >= 0) diff else 0L
                delay(1000)
            }
        }
    }

    // Initialize WebRTC and Call Flow once permission is verified
    fun initializeCall() {
        try {
            val client = WebRtcClient(
                context = context,
                eglBaseContext = null,
                onLocalIceCandidate = { candidate ->
                    coroutineScope.launch {
                        if (isCaller) {
                            signalingClient.sendCallerCandidate(session.callId, candidate)
                        } else {
                            signalingClient.sendReceiverCandidate(session.callId, candidate)
                        }
                    }
                },
                onConnectionStateChanged = { newState ->
                    callState = newState
                    if (newState == CallState.CONNECTED) {
                        ringtoneManager.stopRingtone()
                        audioSwitchManager.start(defaultSpeaker = false)
                        val authTime = connectedAt ?: System.currentTimeMillis()
                        connectedAt = authTime
                        coroutineScope.launch {
                            signalingClient.updateCallState(session.callId, CallState.CONNECTED, authTime)
                        }
                    } else if (newState == CallState.ENDED || newState == CallState.FAILED) {
                        ringtoneManager.stopRingtone()
                        audioSwitchManager.stop()
                        onCallEnded()
                    }
                },
                onRemoteAudioTrackReceived = { audioTrack ->
                    // WebRTC JavaAudioDeviceModule automatically renders the decoded audio to AudioManager
                    audioTrack.setEnabled(true)
                }
            )
            webRtcClient = client

            // Initialize local microphone audio track (real hardware)
            client.initPeerConnection(CallType.AUDIO)

            if (isCaller) {
                // Outgoing Ringback: play ringback tone through earpiece while waiting for remote answer
                ringtoneManager.startOutgoingRingback(speaker = false)
                client.createOffer(CallType.AUDIO) { offerDesc ->
                    coroutineScope.launch {
                        signalingClient.sendOffer(
                            session.callId,
                            SdpModel(offerDesc.type.canonicalForm(), offerDesc.description)
                        )
                    }
                }
            } else {
                // Incoming call: ringtone played through loudspeaker until accept
                ringtoneManager.startIncomingRingtone()
            }

            // Subscribe to remote ICE candidates
            signalingClient.subscribeToRemoteCandidates(session.callId, isCaller) { remoteCandidate ->
                client.addRemoteIceCandidate(remoteCandidate)
            }

            // Subscribe to call session updates (answer SDP, call state, hangup)
            signalingClient.subscribeToCallSession(session.callId) { data ->
                val stateStr = data["callState"] as? String
                if (stateStr != null) {
                    val parsedState = try { CallState.valueOf(stateStr) } catch (e: Exception) { null }
                    if (parsedState != null && parsedState != callState) {
                        callState = parsedState
                        if (parsedState == CallState.CONNECTED) {
                            ringtoneManager.stopRingtone()
                            audioSwitchManager.start(defaultSpeaker = false)
                            val firestoreConnectedAt = data["connectedAt"] as? Long
                            if (firestoreConnectedAt != null) {
                                connectedAt = firestoreConnectedAt
                            }
                        } else if (parsedState == CallState.ENDED || parsedState == CallState.REJECTED) {
                            ringtoneManager.stopRingtone()
                            audioSwitchManager.stop()
                            onCallEnded()
                        }
                    }
                }

                // If Caller receives Answer SDP
                if (isCaller && callState != CallState.CONNECTED) {
                    val answerMap = data["answer"] as? Map<*, *>
                    if (answerMap != null) {
                        val sdp = answerMap["sdp"] as? String
                        if (!sdp.isNullOrEmpty()) {
                            client.applyRemoteAnswer(sdp)
                        }
                    }
                }
            }
        } catch (e: Exception) {
            errorMessage = e.message ?: "Failed to initialize audio call"
        }
    }

    // Permission launcher for RECORD_AUDIO
    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        if (isGranted) {
            initializeCall()
        } else {
            errorMessage = "RECORD_AUDIO permission is required for voice calls. Microphone access was denied."
        }
    }

    // Check permission on mount
    LaunchedEffect(Unit) {
        val hasPermission = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED

        if (hasPermission) {
            initializeCall()
        } else {
            permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    // Cleanup resources upon exiting screen
    DisposableEffect(Unit) {
        onDispose {
            ringtoneManager.stopRingtone()
            audioSwitchManager.stop()
            webRtcClient?.close()
            signalingClient.cleanup()
        }
    }

    // UI Content
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF0F172A)),
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            // Header Info
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier.padding(top = 48.dp)
            ) {
                Text(
                    text = if (isCaller) session.receiverName else session.callerName,
                    fontSize = 28.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color.White
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = when (callState) {
                        CallState.CALLING -> stringResource(R.string.calling)
                        CallState.RINGING -> if (isCaller) stringResource(R.string.ringing) else stringResource(R.string.incoming_call)
                        CallState.CONNECTING -> stringResource(R.string.connecting)
                        CallState.CONNECTED -> String.format(
                            Locale.US,
                            "%02d:%02d",
                            elapsedSeconds / 60,
                            elapsedSeconds % 60
                        )
                        CallState.ENDED -> stringResource(R.string.call_ended)
                        CallState.FAILED -> stringResource(R.string.call_failed)
                        else -> callState.name
                    },
                    fontSize = 16.sp,
                    color = Color(0xFF94A3B8)
                )
            }

            // Center Avatar
            Box(
                modifier = Modifier
                    .size(160.dp)
                    .clip(CircleShape)
                    .background(Color(0xFF1E293B)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Default.Person,
                    contentDescription = "Contact Avatar",
                    tint = Color(0xFF64748B),
                    modifier = Modifier.size(96.dp)
                )
            }

            // Audio routing feedback
            Row(
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(vertical = 8.dp)
            ) {
                Icon(
                    imageVector = when (selectedAudioDevice) {
                        AudioDevice.SPEAKERPHONE -> Icons.Default.VolumeUp
                        AudioDevice.BLUETOOTH_HEADSET -> Icons.Default.BluetoothAudio
                        AudioDevice.EARPIECE -> Icons.Default.PhoneInTalk
                    },
                    contentDescription = "Audio Route",
                    tint = Color(0xFF38BDF8),
                    modifier = Modifier.size(20.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = when (selectedAudioDevice) {
                        AudioDevice.SPEAKERPHONE -> "Speakerphone Active"
                        AudioDevice.BLUETOOTH_HEADSET -> "Bluetooth Headset Active"
                        AudioDevice.EARPIECE -> "Earpiece Active"
                    },
                    fontSize = 13.sp,
                    color = Color(0xFF38BDF8)
                )
            }

            // Bottom Controls
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier.padding(bottom = 32.dp)
            ) {
                if (!isCaller && callState == CallState.RINGING) {
                    // Incoming Call Accept/Reject Buttons
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceEvenly
                    ) {
                        // Reject Button
                        IconButton(
                            onClick = {
                                ringtoneManager.stopRingtone()
                                coroutineScope.launch {
                                    signalingClient.updateCallState(session.callId, CallState.REJECTED)
                                    onCallEnded()
                                }
                            },
                            modifier = Modifier
                                .size(64.dp)
                                .background(Color(0xFFEF4444), CircleShape)
                        ) {
                            Icon(Icons.Default.CallEnd, contentDescription = "Reject Call", tint = Color.White)
                        }

                        // Accept Button
                        IconButton(
                            onClick = {
                                ringtoneManager.stopRingtone()
                                audioSwitchManager.start(defaultSpeaker = false)
                                callState = CallState.CONNECTING
                                val now = System.currentTimeMillis()
                                coroutineScope.launch {
                                    signalingClient.updateCallState(session.callId, CallState.CONNECTING)
                                    val offerSdp = session.offer?.sdp
                                    if (offerSdp != null && webRtcClient != null) {
                                        webRtcClient?.handleOfferAndCreateAnswer(offerSdp, CallType.AUDIO) { answerDesc ->
                                            coroutineScope.launch {
                                                signalingClient.sendAnswer(
                                                    session.callId,
                                                    SdpModel(answerDesc.type.canonicalForm(), answerDesc.description)
                                                )
                                            }
                                        }
                                    }
                                }
                            },
                            modifier = Modifier
                                .size(64.dp)
                                .background(Color(0xFF22C55E), CircleShape)
                        ) {
                            Icon(Icons.Default.Call, contentDescription = "Accept Call", tint = Color.White)
                        }
                    }
                } else {
                    // Active or Outgoing Call Controls
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceEvenly,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        // Mute Button
                        IconButton(
                            onClick = {
                                isMuted = !isMuted
                                webRtcClient?.toggleAudio(isMuted)
                            },
                            modifier = Modifier
                                .size(56.dp)
                                .background(if (isMuted) Color(0xFFEF4444) else Color(0xFF334155), CircleShape)
                        ) {
                            Icon(
                                imageVector = if (isMuted) Icons.Default.MicOff else Icons.Default.Mic,
                                contentDescription = if (isMuted) "Unmute" else "Mute",
                                tint = Color.White
                            )
                        }

                        // End Call Button
                        IconButton(
                            onClick = {
                                coroutineScope.launch {
                                    signalingClient.updateCallState(session.callId, CallState.ENDED)
                                    onCallEnded()
                                }
                            },
                            modifier = Modifier
                                .size(64.dp)
                                .background(Color(0xFFEF4444), CircleShape)
                        ) {
                            Icon(Icons.Default.CallEnd, contentDescription = "End Call", tint = Color.White)
                        }

                        // Audio Route Selector (Toggle between Earpiece and Speakerphone)
                        IconButton(
                            onClick = {
                                val nextDevice = if (selectedAudioDevice == AudioDevice.SPEAKERPHONE) {
                                    AudioDevice.EARPIECE
                                } else {
                                    AudioDevice.SPEAKERPHONE
                                }
                                audioSwitchManager.selectAudioDevice(nextDevice)
                            },
                            modifier = Modifier
                                .size(56.dp)
                                .background(if (selectedAudioDevice == AudioDevice.SPEAKERPHONE) Color(0xFF0284C7) else Color(0xFF334155), CircleShape)
                        ) {
                            Icon(
                                imageVector = if (selectedAudioDevice == AudioDevice.SPEAKERPHONE) Icons.Default.VolumeUp else Icons.Default.VolumeDown,
                                contentDescription = "Toggle Speakerphone",
                                tint = Color.White
                            )
                        }
                    }
                }
            }
        }

        // Error Dialog
        errorMessage?.let { msg ->
            AlertDialog(
                onDismissRequest = {
                    errorMessage = null
                    onCallEnded()
                },
                title = { Text("Call Error", color = Color.White) },
                text = { Text(msg, color = Color(0xFFCBD5E1)) },
                confirmButton = {
                    TextButton(onClick = {
                        errorMessage = null
                        onCallEnded()
                    }) {
                        Text("OK", color = Color(0xFF38BDF8))
                    }
                },
                containerColor = Color(0xFF1E293B)
            )
        }
    }
}
