package com.kotha.app.ui.call

import android.Manifest
import android.content.pm.PackageManager
import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.firebase.firestore.FirebaseFirestore
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
import kotlinx.coroutines.tasks.await
import org.webrtc.EglBase
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack
import java.util.Locale

/**
 * Production 1-to-1 WebRTC Video Call Screen for Kotha Android.
 *
 * Features:
 * - Runtime CAMERA and RECORD_AUDIO permission verification & dynamic prompting.
 * - Hardware camera local video track acquisition with front/back camera toggling.
 * - Hardware microphone initialization and JavaAudioDeviceModule integration.
 * - Full SDP Offer/Answer signaling negotiation via Firestore.
 * - Bidirectional ICE Candidate exchange with thread-safe queueing.
 * - Remote and local SurfaceViewRenderer rendering via EglBase.
 * - In-call controls: Mute/Unmute, Camera On/Off, Camera Flip, Speaker toggle, and End Call.
 * - Real-time state observation: Calling, Ringing, Connecting, Connected, Ended, and Failed.
 * - Complete resource cleanup on screen disposal.
 */
@Composable
fun VideoCallScreen(
    callerName: String = "Contact",
    callState: CallState = CallState.CALLING,
    eglBaseContext: EglBase.Context,
    webRtcClient: WebRtcClient? = null,
    isCaller: Boolean = true,
    session: WebRtcCallSession? = null,
    callId: String? = null,
    onEndCall: () -> Unit = {},
    onCallEnded: () -> Unit = onEndCall
) {
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()
    val TAG = "KothaVideoCall"

    // Call identifiers and states
    var currentCallId by remember {
        mutableStateOf(
            session?.callId
                ?: callId
                ?: if (callerName.isNotBlank() && callerName != "You") {
                    "call_video_${callerName.trim().lowercase().replace(Regex("[^a-zA-Z0-9]"), "_")}"
                } else {
                    "call_video_session"
                }
        )
    }
    var currentCallState by remember { mutableStateOf(session?.callState ?: callState) }
    var connectedAtTimestamp by remember { mutableStateOf(session?.connectedAt) }
    var elapsedSeconds by remember { mutableStateOf(0L) }

    // Media and device control states
    var isMuted by remember { mutableStateOf(session?.isMuted ?: false) }
    var isCameraOff by remember { mutableStateOf(session?.isCameraOff ?: false) }
    var isFrontCamera by remember { mutableStateOf(session?.isFrontCamera ?: true) }
    var isSwitchingCamera by remember { mutableStateOf(false) }
    var isSpeakerOn by remember { mutableStateOf(true) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    // Signaling & Negotiation Flags
    var cachedOfferSdp by remember { mutableStateOf(session?.offer?.sdp) }
    var isAnswerCreated by remember { mutableStateOf(false) }
    var isAnswerApplied by remember { mutableStateOf(false) }
    var isReceiverAccepted by remember { mutableStateOf(false) }
    var isPipelineInitialized by remember { mutableStateOf(false) }
    // Surface Renderers and Tracks
    var localRenderer by remember { mutableStateOf<SurfaceViewRenderer?>(null) }
    var remoteRenderer by remember { mutableStateOf<SurfaceViewRenderer?>(null) }
    var remoteVideoTrack by remember { mutableStateOf<VideoTrack?>(null) }
    var internalWebRtcClient by remember { mutableStateOf<WebRtcClient?>(null) }
    // Infrastructure Managers
    val ringtoneManager = remember { KothaRingtoneManager(context) }
    val audioSwitchManager = remember {
        KothaAudioSwitchManager(context) { device ->
            isSpeakerOn = (device == AudioDevice.SPEAKERPHONE)
        }
    }
    val signalingClient = remember { FirestoreSignalingClient() }
    fun triggerCameraSwitch() {
        if (isSwitchingCamera || isCameraOff) return
        val client = internalWebRtcClient ?: return
        isSwitchingCamera = true
        Log.d(TAG, "Triggering camera switch. Current isFrontCamera: $isFrontCamera")
        client.switchCamera(
            onSuccess = { newIsFront ->
                coroutineScope.launch {
                    isFrontCamera = newIsFront
                    isSwitchingCamera = false
                    localRenderer?.setMirror(newIsFront)
                    signalingClient.updateCameraFacing(currentCallId, newIsFront)
                    Log.d(TAG, "Camera switch succeeded. New facing: isFront=$newIsFront")
                }
            },
            onError = { errorDesc ->
                coroutineScope.launch {
                    isSwitchingCamera = false
                    Log.e(TAG, "Camera switch failed: $errorDesc")
                }
            }
        )
    }


    // Synchronized duration timer based on authoritative Firestore connectedAt timestamp
    LaunchedEffect(currentCallState, connectedAtTimestamp) {
        if (currentCallState == CallState.CONNECTED && connectedAtTimestamp != null) {
            while (true) {
                val now = System.currentTimeMillis()
                val diff = (now - (connectedAtTimestamp ?: now)) / 1000
                elapsedSeconds = if (diff >= 0) diff else 0L
                delay(1000)
            }
        }
    }

    // Pipeline initializer
    fun startCallPipeline() {
        if (isPipelineInitialized) return
        isPipelineInitialized = true
        Log.d(TAG, "Initializing WebRTC Video Pipeline for call: $currentCallId (isCaller: $isCaller)")

        try {
            val client = WebRtcClient(
                context = context,
                eglBaseContext = eglBaseContext,
                onLocalIceCandidate = { candidate ->
                    coroutineScope.launch {
                        if (isCaller) {
                            signalingClient.sendCallerCandidate(currentCallId, candidate)
                        } else {
                            signalingClient.sendReceiverCandidate(currentCallId, candidate)
                        }
                    }
                },
                onConnectionStateChanged = { newState ->
                    Log.d(TAG, "WebRTC connection state changed: $newState")
                    currentCallState = newState
                    if (newState == CallState.CONNECTED) {
                        ringtoneManager.stopRingtone()
                        audioSwitchManager.start(defaultSpeaker = true)
                        isSpeakerOn = true
                        val authTime = connectedAtTimestamp ?: System.currentTimeMillis()
                        connectedAtTimestamp = authTime
                        coroutineScope.launch {
                            signalingClient.updateCallState(currentCallId, CallState.CONNECTED, authTime)
                        }
                    } else if (newState == CallState.ENDED || newState == CallState.FAILED) {
                        ringtoneManager.stopRingtone()
                        audioSwitchManager.stop()
                        onCallEnded()
                    }
                },
                onRemoteAudioTrackReceived = { audioTrack ->
                    Log.d(TAG, "Remote AudioTrack received in VideoCallScreen.")
                    audioTrack.setEnabled(true)
                },
                onRemoteVideoTrackReceived = { videoTrack ->
                    Log.d(TAG, "Remote VideoTrack received in VideoCallScreen.")
                    remoteVideoTrack = videoTrack
                    videoTrack.setEnabled(true)
                    remoteRenderer?.let { renderer ->
                        try {
                            videoTrack.addSink(renderer)
                            Log.d(TAG, "Attached remote VideoTrack sink to remoteRenderer.")
                        } catch (e: Exception) {
                            Log.e(TAG, "Error attaching sink to remoteRenderer", e)
                        }
                    }
                }
            )
            internalWebRtcClient = client

            // Initialize local camera video track immediately
            client.initLocalVideoTrack(isFrontCamera)
            localRenderer?.let { renderer ->
                client.attachLocalRenderer(renderer)
            }

            // Bind PeerConnection with CallType.VIDEO
            client.initPeerConnection(CallType.VIDEO)

            if (isCaller) {
                // Outgoing Ringback: play ringback tone through speakerphone while waiting for receiver
                ringtoneManager.startOutgoingRingback(speaker = true)
                coroutineScope.launch {
                    val initialSession = WebRtcCallSession(
                        callId = currentCallId,
                        callerId = "current_user",
                        callerName = "You",
                        receiverName = callerName,
                        callType = CallType.VIDEO,
                        callState = CallState.CALLING,
                        startedAt = System.currentTimeMillis()
                    )
                    signalingClient.createCallSession(initialSession)

                    client.createOffer(CallType.VIDEO) { offerDesc ->
                        coroutineScope.launch {
                            signalingClient.sendOffer(
                                currentCallId,
                                SdpModel(offerDesc.type.canonicalForm(), offerDesc.description)
                            )
                            currentCallState = CallState.RINGING
                            Log.d(TAG, "Caller SDP Offer sent to Firestore.")
                        }
                    }
                }
            } else {
                // Incoming call: sound ringtone until answered or rejected
                if (currentCallState == CallState.RINGING || currentCallState == CallState.CALLING) {
                    ringtoneManager.startIncomingRingtone()
                }
            }

            // Subscribe to remote ICE candidates from peer
            signalingClient.subscribeToRemoteCandidates(currentCallId, isCaller) { remoteCandidate ->
                Log.d(TAG, "Received remote candidate from signaling. Applying to WebRtcClient.")
                client.addRemoteIceCandidate(remoteCandidate)
            }

            // Subscribe to call session updates (Offer, Answer, State, and ConnectedAt)
            signalingClient.subscribeToCallSession(currentCallId) { data ->
                val stateStr = data["callState"] as? String
                if (stateStr != null) {
                    val parsedState = try { CallState.valueOf(stateStr) } catch (e: Exception) { null }
                    if (parsedState != null && parsedState != currentCallState) {
                        currentCallState = parsedState
                        if (parsedState == CallState.CONNECTED) {
                            ringtoneManager.stopRingtone()
                            audioSwitchManager.start(defaultSpeaker = true)
                            isSpeakerOn = true
                            val firestoreConnectedAt = (data["connectedAt"] as? Number)?.toLong()
                            if (firestoreConnectedAt != null) {
                                connectedAtTimestamp = firestoreConnectedAt
                            }
                        } else if (parsedState == CallState.ENDED || parsedState == CallState.REJECTED) {
                            ringtoneManager.stopRingtone()
                            audioSwitchManager.stop()
                            onCallEnded()
                        }
                    }
                }

                val offerMap = data["offer"] as? Map<*, *>
                val offerSdp = offerMap?.get("sdp") as? String
                if (offerSdp != null) {
                    cachedOfferSdp = offerSdp
                    // If receiver has already accepted, create answer immediately
                    if (!isCaller && isReceiverAccepted && !isAnswerCreated) {
                        isAnswerCreated = true
                        client.handleOfferAndCreateAnswer(offerSdp, CallType.VIDEO) { answerDesc ->
                            coroutineScope.launch {
                                signalingClient.sendAnswer(
                                    currentCallId,
                                    SdpModel(answerDesc.type.canonicalForm(), answerDesc.description)
                                )
                                Log.d(TAG, "Receiver generated and uploaded SDP Answer to Firestore.")
                            }
                        }
                    }
                }

                // Caller handles Answer SDP
                if (isCaller && currentCallState != CallState.CONNECTED) {
                    val answerMap = data["answer"] as? Map<*, *>
                    val answerSdp = answerMap?.get("sdp") as? String
                    if (!answerSdp.isNullOrEmpty() && !isAnswerApplied) {
                        isAnswerApplied = true
                        Log.d(TAG, "Caller received Answer SDP. Applying remote description.")
                        client.applyRemoteAnswer(answerSdp)
                        currentCallState = CallState.CONNECTING
                    }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error initiating video call pipeline", e)
            errorMessage = e.message ?: "Failed to initialize video call"
        }
    }

    // Permission Request Launcher for CAMERA and RECORD_AUDIO
    val permissions = arrayOf(
        Manifest.permission.CAMERA,
        Manifest.permission.RECORD_AUDIO
    )

    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestMultiplePermissions()
    ) { perms ->
        val cameraGranted = perms[Manifest.permission.CAMERA] == true
        val audioGranted = perms[Manifest.permission.RECORD_AUDIO] == true
        if (cameraGranted && audioGranted) {
            errorMessage = null
            startCallPipeline()
        } else {
            errorMessage = "Camera and Microphone permissions are both required for video calling."
        }
    }

    // Check permissions and resolve callId if receiver
    LaunchedEffect(Unit) {
        // If receiver without explicit session ID, scan for active incoming video call
        if (!isCaller && session == null && callId == null) {
            try {
                val query = FirebaseFirestore.getInstance()
                    .collection("calls")
                    .whereEqualTo("callType", CallType.VIDEO.name)
                    .whereIn("callState", listOf(CallState.CALLING.name, CallState.RINGING.name))
                    .limit(1)
                    .get()
                    .await()
                val doc = query.documents.firstOrNull()
                if (doc != null) {
                    currentCallId = doc.id
                    Log.d(TAG, "Resolved active incoming video call ID: $currentCallId")
                }
            } catch (e: Exception) {
                Log.w(TAG, "Failed to resolve incoming video call document", e)
            }
        }

        val cameraGranted = ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        val audioGranted = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

        if (cameraGranted && audioGranted) {
            startCallPipeline()
        } else {
            permissionLauncher.launch(permissions)
        }
    }

    // Resource teardown on disposal
    DisposableEffect(Unit) {
        onDispose {
            Log.d(TAG, "VideoCallScreen disposed. Releasing resources...")
            try {
                ringtoneManager.stopRingtone()
                audioSwitchManager.stop()
                internalWebRtcClient?.close()
                signalingClient.cleanup()
                localRenderer?.release()
                remoteRenderer?.release()
            } catch (e: Exception) {
                Log.e(TAG, "Error cleaning up VideoCallScreen resources", e)
            }
        }
    }

    // UI Formatting
    val formattedDuration = remember(elapsedSeconds) {
        val minutes = elapsedSeconds / 60
        val seconds = elapsedSeconds % 60
        String.format(Locale.US, "%02d:%02d", minutes, seconds)
    }

    val stateStatusText = when (currentCallState) {
        CallState.CONNECTED -> "${stringResource(R.string.connected)} • $formattedDuration"
        CallState.CONNECTING -> stringResource(R.string.connecting_video)
        CallState.CALLING -> if (isCaller) stringResource(R.string.calling) else stringResource(R.string.incoming_call)
        CallState.RINGING -> if (isCaller) stringResource(R.string.ringing) else stringResource(R.string.incoming_video_call)
        CallState.FAILED -> stringResource(R.string.call_failed)
        CallState.ENDED, CallState.REJECTED -> stringResource(R.string.call_ended)
        else -> stringResource(R.string.connecting)
    }

    // Pulse animation for incoming / calling
    val infiniteTransition = rememberInfiniteTransition(label = "pulse")
    val pulseScale by infiniteTransition.animateFloat(
        initialValue = 1.0f,
        targetValue = 1.15f,
        animationSpec = infiniteRepeatable(
            animation = tween(1000, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "pulseScale"
    )

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF090D16))
    ) {
        // 1. FULLSCREEN REMOTE VIDEO SURFACE
        AndroidView(
            factory = { ctx ->
                SurfaceViewRenderer(ctx).apply {
                    init(eglBaseContext, null)
                    setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FILL)
                    setEnableHardwareScaler(true)
                    setZOrderMediaOverlay(false)
                    remoteRenderer = this
                    remoteVideoTrack?.let { track ->
                        try {
                            track.addSink(this)
                        } catch (e: Exception) {
                            Log.e(TAG, "Error adding sink in factory", e)
                        }
                    }
                }
            },
            update = { renderer ->
                remoteRenderer = renderer
                remoteVideoTrack?.let { track ->
                    try {
                        track.addSink(renderer)
                    } catch (e: Exception) {
                        // Already added
                    }
                }
            },
            modifier = Modifier.fillMaxSize()
        )

        // Remote Video Placeholder Overlay if not yet connected or video track not received
        if (remoteVideoTrack == null || currentCallState != CallState.CONNECTED) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            listOf(Color(0xCC090D16), Color(0xEE0F172A))
                        )
                    ),
                contentAlignment = Alignment.Center
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    Box(
                        modifier = Modifier
                            .size((110 * if (currentCallState != CallState.CONNECTED) pulseScale else 1.0f).dp)
                            .clip(CircleShape)
                            .background(Color(0x3338BDF8)),
                        contentAlignment = Alignment.Center
                    ) {
                        Box(
                            modifier = Modifier
                                .size(90.dp)
                                .clip(CircleShape)
                                .background(Color(0xFF1E293B)),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                imageVector = Icons.Default.Person,
                                contentDescription = null,
                                tint = Color(0xFF38BDF8),
                                modifier = Modifier.size(54.dp)
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(20.dp))

                    Text(
                        text = callerName,
                        color = Color.White,
                        fontSize = 24.sp,
                        fontWeight = FontWeight.Bold
                    )

                    Spacer(modifier = Modifier.height(8.dp))

                    Text(
                        text = stateStatusText,
                        color = if (currentCallState == CallState.CONNECTED) Color(0xFF34D399) else Color(0xFF94A3B8),
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Medium
                    )
                }
            }
        }

        // 2. TOP STATUS BAR OVERLAY
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .padding(horizontal = 20.dp, vertical = 16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text(
                    text = callerName,
                    color = Color.White,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.SemiBold
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (currentCallState == CallState.CONNECTED) {
                        Box(
                            modifier = Modifier
                                .size(8.dp)
                                .clip(CircleShape)
                                .background(Color(0xFF22C55E))
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                    }
                    Text(
                        text = stateStatusText,
                        color = if (currentCallState == CallState.CONNECTED) Color(0xFF34D399) else Color(0xFF94A3B8),
                        fontSize = 13.sp
                    )
                }
            }

            Surface(
                color = Color(0x66000000),
                shape = RoundedCornerShape(12.dp)
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Lock,
                        contentDescription = null,
                        tint = Color(0xFF38BDF8),
                        modifier = Modifier.size(12.dp)
                    )
                    Spacer(modifier = Modifier.width(5.dp))
                    Text(
                        text = stringResource(R.string.encrypted),
                        color = Color(0xFFE2E8F0),
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Medium
                    )
                }
            }
        }

        // Error message banner if permission or media fails
        errorMessage?.let { error ->
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .align(Alignment.TopCenter)
                    .statusBarsPadding()
                    .padding(top = 70.dp, start = 20.dp, end = 20.dp),
                color = Color(0xEE7F1D1D),
                shape = RoundedCornerShape(12.dp)
            ) {
                Row(
                    modifier = Modifier.padding(14.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = Icons.Default.Warning,
                        contentDescription = null,
                        tint = Color(0xFFFCA5A5),
                        modifier = Modifier.size(24.dp)
                    )
                    Spacer(modifier = Modifier.width(12.dp))
                    Text(
                        text = error,
                        color = Color.White,
                        fontSize = 13.sp,
                        modifier = Modifier.weight(1f)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    TextButton(onClick = { permissionLauncher.launch(permissions) }) {
                        Text(stringResource(R.string.retry), color = Color(0xFF67E8F9), fontWeight = FontWeight.Bold)
                    }
                }
            }
        }

        // 3. LOCAL CAMERA PICTURE-IN-PICTURE (PiP) PREVIEW
        Box(
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(bottom = 120.dp, end = 16.dp)
                .size(width = 112.dp, height = 160.dp)
                .clip(RoundedCornerShape(18.dp))
                .border(2.dp, Color(0x6638BDF8), RoundedCornerShape(18.dp))
                .background(Color.Black)
        ) {
            if (!isCameraOff) {
                AndroidView(
                    factory = { ctx ->
                        SurfaceViewRenderer(ctx).apply {
                            init(eglBaseContext, null)
                            setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FILL)
                            setMirror(isFrontCamera)
                            setEnableHardwareScaler(true)
                            setZOrderMediaOverlay(true)
                            localRenderer = this
                            internalWebRtcClient?.initLocalVideoTrack(isFrontCamera)
                            internalWebRtcClient?.attachLocalRenderer(this)
                        }
                    },
                    update = { renderer ->
                        localRenderer = renderer
                        renderer.setMirror(isFrontCamera)
                        internalWebRtcClient?.attachLocalRenderer(renderer)
                    },
                    modifier = Modifier.fillMaxSize()
                )

                // Front/Rear Camera Tag
                Surface(
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(8.dp),
                    color = Color(0xAA000000),
                    shape = RoundedCornerShape(6.dp)
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 3.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .size(6.dp)
                                .background(Color(0xFF34D399), CircleShape)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(
                            text = if (isFrontCamera) stringResource(R.string.front_camera) else stringResource(R.string.rear_camera),
                            color = Color.White,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                }

                // Dedicated Flip Camera Control at lower-right side of local preview area
                Box(
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .padding(8.dp)
                        .size(38.dp)
                        .clip(CircleShape)
                        .background(Color(0xEE0F172A))
                        .border(1.5.dp, Color(0xFF38BDF8), CircleShape)
                        .clickable(enabled = !isSwitchingCamera && !isCameraOff) {
                            triggerCameraSwitch()
                        },
                    contentAlignment = Alignment.Center
                ) {
                    if (isSwitchingCamera) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            strokeWidth = 2.dp,
                            color = Color(0xFF38BDF8)
                        )
                    } else {
                        Icon(
                            imageVector = Icons.Default.FlipCameraIos,
                            contentDescription = stringResource(R.string.switch_camera),
                            tint = Color(0xFF38BDF8),
                            modifier = Modifier.size(20.dp)
                        )
                    }
                }
            } else {
                // Camera Off placeholder inside PiP
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(
                            imageVector = Icons.Default.VideocamOff,
                            contentDescription = null,
                            tint = Color(0xFFEF4444),
                            modifier = Modifier.size(28.dp)
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = stringResource(R.string.camera_off),
                            color = Color(0xFF94A3B8),
                            fontSize = 10.sp
                        )
                    }
                }
            }
        }

        // 4. IN-CALL FLOATING CONTROL DOCK
        // Receiver Incoming Call Actions (Accept / Reject) before acceptance
        if (!isCaller && (currentCallState == CallState.RINGING || currentCallState == CallState.CALLING) && !isReceiverAccepted) {
            Surface(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .navigationBarsPadding()
                    .padding(bottom = 24.dp)
                    .fillMaxWidth(0.92f),
                color = Color(0xEE111827),
                shape = RoundedCornerShape(32.dp),
                tonalElevation = 10.dp,
                border = androidx.compose.foundation.BorderStroke(1.dp, Color(0x33475569))
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 24.dp, vertical = 14.dp),
                    horizontalArrangement = Arrangement.SpaceEvenly,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // Reject / Decline Button
                    IconButton(
                        onClick = {
                            ringtoneManager.stopRingtone()
                            coroutineScope.launch {
                                signalingClient.updateCallState(currentCallId, CallState.REJECTED)
                                onCallEnded()
                            }
                        },
                        modifier = Modifier
                            .size(56.dp)
                            .background(Color(0xFFEF4444), CircleShape)
                    ) {
                        Icon(
                            imageVector = Icons.Default.CallEnd,
                            contentDescription = "Decline Call",
                            tint = Color.White,
                            modifier = Modifier.size(28.dp)
                        )
                    }

                    // Accept Video Call Button
                    IconButton(
                        onClick = {
                            ringtoneManager.stopRingtone()
                            audioSwitchManager.start(defaultSpeaker = true)
                            isSpeakerOn = true
                            isReceiverAccepted = true
                            currentCallState = CallState.CONNECTING
                            coroutineScope.launch {
                                signalingClient.updateCallState(currentCallId, CallState.CONNECTING)
                                cachedOfferSdp?.let { offerSdp ->
                                    if (!isAnswerCreated && internalWebRtcClient != null) {
                                        isAnswerCreated = true
                                        internalWebRtcClient?.handleOfferAndCreateAnswer(offerSdp, CallType.VIDEO) { answerDesc ->
                                            coroutineScope.launch {
                                                signalingClient.sendAnswer(
                                                    currentCallId,
                                                    SdpModel(answerDesc.type.canonicalForm(), answerDesc.description)
                                                )
                                                Log.d(TAG, "Accepted call and sent Answer SDP.")
                                            }
                                        }
                                    }
                                }
                            }
                        },
                        modifier = Modifier
                            .size(56.dp)
                            .background(Color(0xFF22C55E), CircleShape)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Videocam,
                            contentDescription = "Accept Video Call",
                            tint = Color.White,
                            modifier = Modifier.size(30.dp)
                        )
                    }
                }
            }
        } else {
            // Reusable, identical in-call control dock for BOTH caller and receiver
            VideoCallControlsDock(
                isMuted = isMuted,
                onToggleMute = {
                    isMuted = !isMuted
                    internalWebRtcClient?.toggleAudio(isMuted)
                    coroutineScope.launch {
                        signalingClient.updateAudioMuteStatus(currentCallId, isMuted)
                    }
                },
                isCameraOff = isCameraOff,
                onToggleCamera = {
                    isCameraOff = !isCameraOff
                    internalWebRtcClient?.toggleVideo(!isCameraOff)
                    coroutineScope.launch {
                        signalingClient.updateCameraStatus(currentCallId, isCameraOff)
                    }
                },
                isFrontCamera = isFrontCamera,
                isSwitchingCamera = isSwitchingCamera,
                onFlipCamera = {
                    triggerCameraSwitch()
                },
                isSpeakerOn = isSpeakerOn,
                onToggleSpeaker = {
                    isSpeakerOn = !isSpeakerOn
                    audioSwitchManager.selectAudioDevice(
                        if (isSpeakerOn) AudioDevice.SPEAKERPHONE else AudioDevice.EARPIECE
                    )
                },
                onEndCall = {
                    ringtoneManager.stopRingtone()
                    audioSwitchManager.stop()
                    coroutineScope.launch {
                        signalingClient.updateCallState(currentCallId, CallState.ENDED)
                        onCallEnded()
                    }
                },
                modifier = Modifier.align(Alignment.BottomCenter)
            )
        }
    }
}

/**
 * Shared, reusable video call controls dock used identically by caller and receiver.
 */
@Composable
fun VideoCallControlsDock(
    isMuted: Boolean,
    onToggleMute: () -> Unit,
    isCameraOff: Boolean,
    onToggleCamera: () -> Unit,
    isFrontCamera: Boolean,
    isSwitchingCamera: Boolean,
    onFlipCamera: () -> Unit,
    isSpeakerOn: Boolean,
    onToggleSpeaker: () -> Unit,
    onEndCall: () -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier
            .navigationBarsPadding()
            .padding(bottom = 24.dp)
            .fillMaxWidth(0.92f),
        color = Color(0xEE111827),
        shape = RoundedCornerShape(32.dp),
        tonalElevation = 10.dp,
        border = androidx.compose.foundation.BorderStroke(1.dp, Color(0x33475569))
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically
        ) {
            // 1. Microphone Mute Toggle
            IconButton(
                onClick = onToggleMute,
                modifier = Modifier
                    .size(48.dp)
                    .background(if (isMuted) Color(0xFFEF4444) else Color(0xFF334155), CircleShape)
            ) {
                Icon(
                    imageVector = if (isMuted) Icons.Default.MicOff else Icons.Default.Mic,
                    contentDescription = "Toggle Mute",
                    tint = Color.White
                )
            }

            // 2. Camera Video Toggle
            IconButton(
                onClick = onToggleCamera,
                modifier = Modifier
                    .size(48.dp)
                    .background(if (isCameraOff) Color(0xFFEF4444) else Color(0xFF334155), CircleShape)
            ) {
                Icon(
                    imageVector = if (isCameraOff) Icons.Default.VideocamOff else Icons.Default.Videocam,
                    contentDescription = "Toggle Video",
                    tint = Color.White
                )
            }

            // 3. Flip Camera (Front / Back)
            IconButton(
                onClick = onFlipCamera,
                enabled = !isSwitchingCamera && !isCameraOff,
                modifier = Modifier
                    .size(50.dp)
                    .background(
                        if (isSwitchingCamera) Color(0xFF0284C7) else Color(0xFF334155),
                        CircleShape
                    )
                    .border(
                        width = 1.dp,
                        color = if (isSwitchingCamera) Color(0xFF38BDF8) else Color(0x33FFFFFF),
                        shape = CircleShape
                    )
            ) {
                if (isSwitchingCamera) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        strokeWidth = 2.dp,
                        color = Color.White
                    )
                } else {
                    Icon(
                        imageVector = Icons.Default.FlipCameraIos,
                        contentDescription = stringResource(R.string.switch_camera),
                        tint = if (isCameraOff) Color(0xFF64748B) else Color.White,
                        modifier = Modifier.size(24.dp)
                    )
                }
            }

            // 4. Speakerphone Toggle
            IconButton(
                onClick = onToggleSpeaker,
                modifier = Modifier
                    .size(48.dp)
                    .background(if (isSpeakerOn) Color(0xFF0284C7) else Color(0xFF334155), CircleShape)
            ) {
                Icon(
                    imageVector = if (isSpeakerOn) Icons.Default.VolumeUp else Icons.Default.VolumeDown,
                    contentDescription = "Speaker",
                    tint = Color.White
                )
            }

            // 5. Hang up / End Call
            IconButton(
                onClick = onEndCall,
                modifier = Modifier
                    .size(52.dp)
                    .background(Color(0xFFDC2626), CircleShape)
            ) {
                Icon(
                    imageVector = Icons.Default.CallEnd,
                    contentDescription = stringResource(R.string.end_call),
                    tint = Color.White,
                    modifier = Modifier.size(26.dp)
                )
            }
        }
    }
}

/**
 * Convenience overload for direct session launches.
 */
@Composable
fun VideoCallScreen(
    session: WebRtcCallSession,
    isCaller: Boolean,
    eglBaseContext: EglBase.Context,
    onCallEnded: () -> Unit
) {
    VideoCallScreen(
        callerName = if (isCaller) session.receiverName else session.callerName,
        callState = session.callState,
        eglBaseContext = eglBaseContext,
        webRtcClient = null,
        isCaller = isCaller,
        session = session,
        callId = session.callId,
        onEndCall = onCallEnded,
        onCallEnded = onCallEnded
    )
}
