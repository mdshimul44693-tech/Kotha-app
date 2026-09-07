export interface AndroidCodeFile {
  path: string;
  category: 'gradle' | 'manifest' | 'clean_arch' | 'webrtc' | 'firebase' | 'compose_ui' | 'res';
  description: string;
  content: string;
}

export const androidCodeFiles: AndroidCodeFile[] = [
  {
    path: 'build.gradle.kts (Project)',
    category: 'gradle',
    description: 'Top-level Gradle build configuration with Kotlin 2.0 and Google Services',
    content: `// Top-level build file where you can add configuration options common to all sub-projects/modules.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.google.gms.services) apply false
}
`,
  },
  {
    path: 'app/build.gradle.kts',
    category: 'gradle',
    description: 'App-level build configuration with Compose, Firebase BOM, and WebRTC',
    content: `plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.google.gms.services)
}

android {
    namespace = "com.kotha.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.kotha.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
    }
}

dependencies {
    // Jetpack Compose
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.material.icons.extended)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)

    // Firebase (BOM)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.auth.ktx)
    implementation(libs.firebase.firestore.ktx)
    implementation(libs.firebase.storage.ktx)
    implementation(libs.firebase.messaging.ktx)

    // WebRTC Real-Time Audio & Video
    implementation("io.getstream:stream-webrtc-android:1.3.0")

    // Image loading & Coroutines
    implementation("io.coil-kt:coil-compose:2.7.0")
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.coroutines.play.services)

    // Phone Number Normalization
    implementation("com.googlecode.libphonenumber:libphonenumber:8.13.35")
}
`,
  },
  {
    path: 'app/src/main/AndroidManifest.xml',
    category: 'manifest',
    description: 'Production Android Manifest with required permissions & FCM service',
    content: `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <!-- Network & Firebase -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

    <!-- Audio & Video Calling with Bluetooth -->
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
    <uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
    <uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />

    <!-- Contacts Discovery -->
    <uses-permission android:name="android.permission.READ_CONTACTS" />

    <!-- Notifications (Android 13+) -->
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.VIBRATE" />

    <uses-feature android:name="android.hardware.camera" android:required="false" />
    <uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />
    <uses-feature android:name="android.hardware.microphone" android:required="true" />

    <application
        android:name=".KothaApplication"
        android:allowBackup="false"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/Theme.Kotha">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:windowSoftInputMode="adjustResize"
            android:theme="@style/Theme.Kotha">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <!-- FCM Service for Push Calls & Messages -->
        <service
            android:name=".service.fcm.KothaFirebaseMessagingService"
            android:exported="false">
            <intent-filter>
                <action android:name="com.google.firebase.MESSAGING_EVENT" />
            </intent-filter>
        </service>

    </application>
</manifest>
`,
  },
  {
    path: 'app/src/main/java/com/kotha/app/domain/model/Models.kt',
    category: 'clean_arch',
    description: 'Clean Architecture Domain Models (User, Chat, Message, Call)',
    content: `package com.kotha.app.domain.model

enum class CallType { AUDIO, VIDEO }

enum class CallState {
    IDLE, CALLING, RINGING, CONNECTING, CONNECTED, ENDED, REJECTED, FAILED
}

enum class MessageType { TEXT, VOICE, IMAGE }

enum class MessageStatus { SENDING, SENT, DELIVERED, READ }

data class User(
    val userId: String,
    val phoneNumber: String,
    val fullName: String,
    val profilePhotoUrl: String? = null,
    val about: String = "Available on Kotha",
    val isOnline: Boolean = false,
    val lastSeen: Long = System.currentTimeMillis(),
    val fcmToken: String? = null,
    val lowDataMode: Boolean = false,
    val preferredLanguage: String = "bn"
)

data class Message(
    val messageId: String,
    val senderId: String,
    val receiverId: String,
    val text: String? = null,
    val type: MessageType = MessageType.TEXT,
    val mediaUrl: String? = null,
    val mediaDurationMs: Long? = null,
    val timestamp: Long = System.currentTimeMillis(),
    val status: MessageStatus = MessageStatus.SENT
)

data class Chat(
    val chatId: String,
    val participantIds: List<String>,
    val lastMessage: Message? = null,
    val unreadCount: Int = 0,
    val updatedAt: Long = System.currentTimeMillis()
)
`,
  },
  {
    path: 'app/src/main/java/com/kotha/app/MainActivity.kt',
    category: 'compose_ui',
    description: 'Android MainActivity entry point launching VoiceCallScreen & VideoCallScreen',
    content: `package com.kotha.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import com.kotha.app.data.repository.FirestoreSignalingClient
import com.kotha.app.domain.model.CallState
import com.kotha.app.domain.model.CallType
import com.kotha.app.domain.model.WebRtcCallSession
import com.kotha.app.ui.call.VideoCallScreen
import com.kotha.app.ui.call.VoiceCallScreen
import org.webrtc.EglBase

class MainActivity : ComponentActivity() {

    private val eglBase: EglBase by lazy { EglBase.create() }
    private val signalingClient by lazy { FirestoreSignalingClient() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    var activeCallSession by remember { mutableStateOf<WebRtcCallSession?>(null) }
                    var isCaller by remember { mutableStateOf(true) }

                    if (activeCallSession != null) {
                        val session = activeCallSession!!
                        if (session.callType == CallType.AUDIO) {
                            VoiceCallScreen(
                                session = session,
                                isCaller = isCaller,
                                onCallEnded = {
                                    activeCallSession = null
                                }
                            )
                        } else {
                            VideoCallScreen(
                                callerName = if (isCaller) session.receiverName else session.callerName,
                                callState = session.callState,
                                eglBaseContext = eglBase.eglBaseContext,
                                webRtcClient = remember {
                                    com.kotha.app.data.webrtc.WebRtcClient(
                                        context = applicationContext,
                                        eglBaseContext = eglBase.eglBaseContext,
                                        onLocalIceCandidate = {},
                                        onConnectionStateChanged = {}
                                    )
                                },
                                isCaller = isCaller,
                                onEndCall = {
                                    activeCallSession = null
                                }
                            )
                        }
                    } else {
                        com.kotha.app.ui.main.MainScreen(
                            onStartCall = { targetUser, callType ->
                                val newSession = WebRtcCallSession(
                                    callId = "call_\${System.currentTimeMillis()}",
                                    callerId = "current_user",
                                    callerName = "You",
                                    receiverId = targetUser.userId,
                                    receiverName = targetUser.fullName,
                                    callType = callType,
                                    callState = CallState.CALLING,
                                    startedAt = System.currentTimeMillis()
                                )
                                isCaller = true
                                activeCallSession = newSession
                            }
                        )
                    }
                }
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        eglBase.release()
    }
}
`,
  },
  {
    path: 'app/src/main/java/com/kotha/app/data/webrtc/WebRtcClient.kt',
    category: 'webrtc',
    description: 'Native WebRTC Client with hardware JavaAudioDeviceModule, SDP verification, and remote audio playback',
    content: `package com.kotha.app.data.webrtc

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.util.Log
import androidx.core.content.ContextCompat
import com.kotha.app.domain.model.CallState
import com.kotha.app.domain.model.CallType
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.webrtc.*
import org.webrtc.audio.JavaAudioDeviceModule
import java.util.concurrent.ConcurrentLinkedQueue

class WebRtcClient(
    private val context: Context,
    private val eglBaseContext: EglBase.Context? = null,
    private val onLocalIceCandidate: (IceCandidate) -> Unit,
    private val onConnectionStateChanged: (CallState) -> Unit,
    private val onRemoteAudioTrackReceived: ((AudioTrack) -> Unit)? = null,
    private val onRemoteVideoTrackReceived: ((VideoTrack) -> Unit)? = null
) {
    companion object {
        private const val TAG = "KothaWebRtcClient"
        private const val LOCAL_AUDIO_TRACK_ID = "ARDAMSa0"
        private const val LOCAL_VIDEO_TRACK_ID = "ARDAMSv0"
        private const val STREAM_ID = "ARDAMS"
    }

    private val peerConnectionFactory: PeerConnectionFactory
    private val audioDeviceModule: JavaAudioDeviceModule
    private var peerConnection: PeerConnection? = null

    private var localAudioSource: AudioSource? = null
    private var localAudioTrack: AudioTrack? = null

    private var localVideoSource: VideoSource? = null
    private var localVideoTrack: VideoTrack? = null
    private var videoCapturer: CameraVideoCapturer? = null

    private var remoteAudioTrack: AudioTrack? = null
    private var remoteVideoTrack: VideoTrack? = null

    private val candidateQueue = ConcurrentLinkedQueue<IceCandidate>()
    private var isRemoteDescriptionSet = false

    private val _isMicrophoneMuted = MutableStateFlow(false)
    val isMicrophoneMuted: StateFlow<Boolean> = _isMicrophoneMuted.asStateFlow()

    private val rtcConfig = PeerConnection.RTCConfiguration(
        listOf(
            PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
            PeerConnection.IceServer.builder("stun:stun1.l.google.com:19302").createIceServer(),
            PeerConnection.IceServer.builder("stun:stun2.l.google.com:19302").createIceServer()
        )
    ).apply {
        sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
    }

    init {
        val initOptions = PeerConnectionFactory.InitializationOptions.builder(context)
            .setEnableInternalTracer(true)
            .createInitializationOptions()
        PeerConnectionFactory.initialize(initOptions)

        audioDeviceModule = JavaAudioDeviceModule.builder(context)
            .setUseHardwareAcousticEchoCanceler(JavaAudioDeviceModule.isBuiltInAcousticEchoCancelerSupported())
            .setUseHardwareNoiseSuppressor(JavaAudioDeviceModule.isBuiltInNoiseSuppressorSupported())
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            )
            .setAudioRecordErrorCallback(object : JavaAudioDeviceModule.AudioRecordErrorCallback {
                override fun onWebRtcAudioRecordInitError(errorMessage: String?) {
                    Log.e(TAG, "[AudioModule] Record init error: \$errorMessage")
                }
                override fun onWebRtcAudioRecordStartError(
                    errorCode: JavaAudioDeviceModule.AudioRecordStartErrorCode?,
                    errorMessage: String?
                ) {
                    Log.e(TAG, "[AudioModule] Record start error [\$errorCode]: \$errorMessage")
                }
                override fun onWebRtcAudioRecordError(errorMessage: String?) {
                    Log.e(TAG, "[AudioModule] Record runtime error: \$errorMessage")
                }
            })
            .setAudioTrackErrorCallback(object : JavaAudioDeviceModule.AudioTrackErrorCallback {
                override fun onWebRtcAudioTrackInitError(errorMessage: String?) {
                    Log.e(TAG, "[AudioModule] Playback init error: \$errorMessage")
                }
                override fun onWebRtcAudioTrackStartError(
                    errorCode: JavaAudioDeviceModule.AudioTrackStartErrorCode?,
                    errorMessage: String?
                ) {
                    Log.e(TAG, "[AudioModule] Playback start error [\$errorCode]: \$errorMessage")
                }
                override fun onWebRtcAudioTrackError(errorMessage: String?) {
                    Log.e(TAG, "[AudioModule] Playback runtime error: \$errorMessage")
                }
            })
            .createAudioDeviceModule()

        val factoryBuilder = PeerConnectionFactory.builder()
            .setAudioDeviceModule(audioDeviceModule)

        if (eglBaseContext != null) {
            factoryBuilder.setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBaseContext))
            factoryBuilder.setVideoEncoderFactory(DefaultVideoEncoderFactory(eglBaseContext, true, true))
        }

        peerConnectionFactory = factoryBuilder.createPeerConnectionFactory()
        Log.d(TAG, "PeerConnectionFactory initialized with JavaAudioDeviceModule.")
    }

    fun initLocalAudioTrack() {
        val permissionState = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
        Log.d(TAG, "[WebRTC-Diagnostics] RECORD_AUDIO permission state: \$permissionState (Granted=\${permissionState == PackageManager.PERMISSION_GRANTED})")

        if (permissionState != PackageManager.PERMISSION_GRANTED) {
            throw SecurityException("RECORD_AUDIO permission is not granted. Cannot acquire microphone.")
        }

        val audioConstraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("googEchoCancellation", "true"))
            mandatory.add(MediaConstraints.KeyValuePair("googAutoGainControl", "true"))
            mandatory.add(MediaConstraints.KeyValuePair("googNoiseSuppression", "true"))
            mandatory.add(MediaConstraints.KeyValuePair("googHighpassFilter", "true"))
        }

        localAudioSource = peerConnectionFactory.createAudioSource(audioConstraints)
        localAudioTrack = peerConnectionFactory.createAudioTrack(LOCAL_AUDIO_TRACK_ID, localAudioSource).apply {
            setEnabled(true)
        }

        Log.d(
            TAG,
            "[WebRTC-Diagnostics] Local AudioTrack created: ID='\${localAudioTrack?.id()}', enabled=\${localAudioTrack?.enabled()}"
        )
    }

    fun initLocalVideoTrack(surfaceView: SurfaceViewRenderer, isFrontCamera: Boolean = true) {
        if (eglBaseContext == null) return
        val cameraEnumerator = Camera2Enumerator(context)
        val deviceNames = cameraEnumerator.deviceNames
        val selectedDevice = deviceNames.firstOrNull {
            if (isFrontCamera) cameraEnumerator.isFrontFacing(it) else cameraEnumerator.isBackFacing(it)
        } ?: deviceNames.firstOrNull() ?: return

        videoCapturer = cameraEnumerator.createCapturer(selectedDevice, null)
        localVideoSource = peerConnectionFactory.createVideoSource(videoCapturer!!.isScreencast)
        videoCapturer!!.initialize(
            SurfaceTextureHelper.create("WebRtcCaptureThread", eglBaseContext),
            context,
            localVideoSource!!.capturerObserver
        )
        videoCapturer!!.startCapture(1280, 720, 30)

        localVideoTrack = peerConnectionFactory.createVideoTrack(LOCAL_VIDEO_TRACK_ID, localVideoSource).apply {
            setEnabled(true)
            addSink(surfaceView)
        }
        Log.d(TAG, "[WebRTC-Diagnostics] Local VideoTrack created: ID='\${localVideoTrack?.id()}'")
    }

    fun initPeerConnection(callType: CallType) {
        if (localAudioTrack == null) {
            initLocalAudioTrack()
        }

        peerConnection = peerConnectionFactory.createPeerConnection(rtcConfig, object : PeerConnection.Observer {
            override fun onSignalingChange(state: PeerConnection.SignalingState?) {
                Log.d(TAG, "[WebRTC-Diagnostics] SignalingState: \$state")
            }

            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {
                Log.d(TAG, "[WebRTC-ICE-Diagnostics] IceConnectionState: \$state")
                when (state) {
                    PeerConnection.IceConnectionState.CONNECTED,
                    PeerConnection.IceConnectionState.COMPLETED -> {
                        Log.d(TAG, "[WebRTC-Diagnostics] WebRTC Media Transport CONNECTED!")
                        onConnectionStateChanged(CallState.CONNECTED)
                    }
                    PeerConnection.IceConnectionState.DISCONNECTED -> {
                        Log.w(TAG, "[WebRTC-ICE-Diagnostics] IceConnectionState: DISCONNECTED")
                    }
                    PeerConnection.IceConnectionState.FAILED -> {
                        Log.e(TAG, "[WebRTC-ICE-Diagnostics] IceConnectionState: FAILED")
                        onConnectionStateChanged(CallState.FAILED)
                    }
                    PeerConnection.IceConnectionState.CLOSED -> {
                        onConnectionStateChanged(CallState.ENDED)
                    }
                    else -> Unit
                }
            }

            override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) {
                Log.d(TAG, "[WebRTC-ICE-Diagnostics] IceGatheringState: \$state")
            }

            override fun onIceCandidate(candidate: IceCandidate?) {
                if (candidate != null) {
                    Log.d(TAG, "[WebRTC-ICE-Diagnostics] Local ICE candidate generated: \${candidate.sdp}")
                    onLocalIceCandidate(candidate)
                }
            }

            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) {
                Log.d(TAG, "[WebRTC-ICE-Diagnostics] ICE candidates removed")
            }

            override fun onTrack(transceiver: RtpTransceiver?) {
                super.onTrack(transceiver)
                val track = transceiver?.receiver?.track()
                Log.d(TAG, "[WebRTC-Diagnostics] onTrack: kind=\${track?.kind()}, id=\${track?.id()}, enabled=\${track?.enabled()}")
                if (track is AudioTrack) {
                    remoteAudioTrack = track
                    remoteAudioTrack?.setEnabled(true)
                    Log.d(TAG, "[WebRTC-Diagnostics] Remote AudioTrack received and verified enabled.")
                    onRemoteAudioTrackReceived?.invoke(track)
                } else if (track is VideoTrack) {
                    remoteVideoTrack = track
                    remoteVideoTrack?.setEnabled(true)
                    onRemoteVideoTrackReceived?.invoke(track)
                }
            }

            override fun onAddStream(stream: MediaStream?) {
                Log.d(TAG, "[WebRTC-Diagnostics] onAddStream: \${stream?.id}")
                stream?.audioTracks?.firstOrNull()?.let { audioTrack ->
                    remoteAudioTrack = audioTrack
                    remoteAudioTrack?.setEnabled(true)
                    Log.d(TAG, "[WebRTC-Diagnostics] Remote AudioTrack from stream enabled.")
                    onRemoteAudioTrackReceived?.invoke(audioTrack)
                }
                stream?.videoTracks?.firstOrNull()?.let { videoTrack ->
                    remoteVideoTrack = videoTrack
                    remoteVideoTrack?.setEnabled(true)
                    onRemoteVideoTrackReceived?.invoke(videoTrack)
                }
            }

            override fun onRemoveStream(stream: MediaStream?) {
                Log.d(TAG, "[WebRTC-Diagnostics] onRemoveStream: \${stream?.id}")
            }

            override fun onDataChannel(dataChannel: DataChannel?) {}
            override fun onRenegotiationNeeded() {
                Log.d(TAG, "[WebRTC-Diagnostics] onRenegotiationNeeded")
            }
            override fun onAddTrack(receiver: RtpReceiver?, mediaStreams: Array<out MediaStream>?) {}
            override fun onConnectionChange(newState: PeerConnection.PeerConnectionState?) {
                Log.d(TAG, "[WebRTC-Diagnostics] PeerConnectionState: \$newState")
            }
        })

        localAudioTrack?.let { track ->
            val sender = peerConnection?.addTrack(track, listOf(STREAM_ID))
            Log.d(TAG, "[WebRTC-Diagnostics] Added local AudioTrack to PeerConnection. Sender track ID: \${sender?.track()?.id()}")
        }

        if (callType == CallType.VIDEO && localVideoTrack != null) {
            peerConnection?.addTrack(localVideoTrack, listOf(STREAM_ID))
            Log.d(TAG, "[WebRTC-Diagnostics] Added local VideoTrack to PeerConnection.")
        }

        peerConnection?.transceivers?.forEachIndexed { index, transceiver ->
            Log.d(
                TAG,
                "[WebRTC-Diagnostics] Transceiver #\$index: mid=\${transceiver.mid}, direction=\${transceiver.direction}, currentDirection=\${transceiver.currentDirection}"
            )
        }
    }

    fun createOffer(callType: CallType, onOfferCreated: (SessionDescription) -> Unit) {
        val constraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true"))
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", if (callType == CallType.VIDEO) "true" else "false"))
        }

        peerConnection?.createOffer(object : SdpObserver {
            override fun onCreateSuccess(desc: SessionDescription?) {
                if (desc == null) return
                verifySdpAudioMedia(desc.description, "Caller-Offer")
                peerConnection?.setLocalDescription(object : SdpObserver {
                    override fun onSetSuccess() {
                        Log.d(TAG, "[WebRTC-SDP] Local description set for Offer.")
                        onOfferCreated(desc)
                    }
                    override fun onSetFailure(error: String?) {
                        Log.e(TAG, "[WebRTC-SDP] SetLocalDescription failure: \$error")
                    }
                    override fun onCreateSuccess(p0: SessionDescription?) {}
                    override fun onCreateFailure(p0: String?) {}
                }, desc)
            }

            override fun onCreateFailure(error: String?) {
                Log.e(TAG, "[WebRTC-SDP] CreateOffer failure: \$error")
            }
            override fun onSetSuccess() {}
            override fun onSetFailure(p0: String?) {}
        }, constraints)
    }

    fun handleOfferAndCreateAnswer(
        offerSdp: String,
        callType: CallType,
        onAnswerCreated: (SessionDescription) -> Unit
    ) {
        verifySdpAudioMedia(offerSdp, "Receiver-IncomingOffer")
        val sessionDescription = SessionDescription(SessionDescription.Type.OFFER, offerSdp)

        peerConnection?.setRemoteDescription(object : SdpObserver {
            override fun onSetSuccess() {
                Log.d(TAG, "[WebRTC-SDP] Remote description set for Offer. Flushing candidate queue...")
                isRemoteDescriptionSet = true
                flushQueuedCandidates()

                val constraints = MediaConstraints().apply {
                    mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true"))
                    mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", if (callType == CallType.VIDEO) "true" else "false"))
                }

                peerConnection?.createAnswer(object : SdpObserver {
                    override fun onCreateSuccess(desc: SessionDescription?) {
                        if (desc == null) return
                        verifySdpAudioMedia(desc.description, "Receiver-Answer")
                        peerConnection?.setLocalDescription(object : SdpObserver {
                            override fun onSetSuccess() {
                                Log.d(TAG, "[WebRTC-SDP] Local description set for Answer.")
                                onAnswerCreated(desc)
                            }
                            override fun onSetFailure(error: String?) {
                                Log.e(TAG, "[WebRTC-SDP] SetLocalDescription failure for Answer: \$error")
                            }
                            override fun onCreateSuccess(p0: SessionDescription?) {}
                            override fun onCreateFailure(p0: String?) {}
                        }, desc)
                    }

                    override fun onCreateFailure(error: String?) {
                        Log.e(TAG, "[WebRTC-SDP] CreateAnswer failure: \$error")
                    }
                    override fun onSetSuccess() {}
                    override fun onSetFailure(p0: String?) {}
                }, constraints)
            }

            override fun onSetFailure(error: String?) {
                Log.e(TAG, "[WebRTC-SDP] SetRemoteDescription failure for Offer: \$error")
            }
            override fun onCreateSuccess(p0: SessionDescription?) {}
            override fun onCreateFailure(p0: String?) {}
        }, sessionDescription)
    }

    fun applyRemoteAnswer(answerSdp: String) {
        verifySdpAudioMedia(answerSdp, "Caller-IncomingAnswer")
        val sessionDescription = SessionDescription(SessionDescription.Type.ANSWER, answerSdp)
        peerConnection?.setRemoteDescription(object : SdpObserver {
            override fun onSetSuccess() {
                Log.d(TAG, "[WebRTC-SDP] Remote description set for Answer. Flushing candidate queue...")
                isRemoteDescriptionSet = true
                flushQueuedCandidates()
            }
            override fun onSetFailure(error: String?) {
                Log.e(TAG, "[WebRTC-SDP] SetRemoteDescription failure for Answer: \$error")
            }
            override fun onCreateSuccess(p0: SessionDescription?) {}
            override fun onCreateFailure(p0: String?) {}
        }, sessionDescription)
    }

    fun addRemoteIceCandidate(candidate: IceCandidate) {
        if (isRemoteDescriptionSet && peerConnection?.remoteDescription != null) {
            peerConnection?.addIceCandidate(candidate)
            Log.d(TAG, "[WebRTC-ICE] Added remote ICE candidate directly.")
        } else {
            Log.d(TAG, "[WebRTC-ICE] Queued remote ICE candidate (waiting for remoteDescription).")
            candidateQueue.add(candidate)
        }
    }

    private fun flushQueuedCandidates() {
        Log.d(TAG, "[WebRTC-ICE] Flushing \${candidateQueue.size} queued ICE candidates...")
        while (!candidateQueue.isEmpty()) {
            val candidate = candidateQueue.poll() ?: break
            peerConnection?.addIceCandidate(candidate)
        }
    }

    private fun verifySdpAudioMedia(sdp: String, roleTag: String) {
        val hasAudio = sdp.contains("m=audio")
        val hasSendRecv = sdp.contains("a=sendrecv")
        Log.d(TAG, "[WebRTC-SDP-Verification] [\$roleTag] m=audio present: \$hasAudio, a=sendrecv present: \$hasSendRecv")
        if (!hasAudio) {
            Log.e(TAG, "[WebRTC-SDP-Verification] CRITICAL: SDP missing m=audio! Audio will not negotiate.")
        }
    }

    fun toggleAudio(isMuted: Boolean) {
        _isMicrophoneMuted.value = isMuted
        localAudioTrack?.setEnabled(!isMuted)
        Log.d(TAG, "[WebRTC] Local microphone track enabled state set to: \${!isMuted}")
    }

    fun toggleVideo(isEnabled: Boolean) {
        localVideoTrack?.setEnabled(isEnabled)
    }

    fun switchCamera(
        onSuccess: ((Boolean) -> Unit)? = null,
        onError: ((String?) -> Unit)? = null
    ) {
        val capturer = videoCapturer ?: run {
            onError?.invoke("Capturer null")
            return
        }
        val egl = eglBaseContext ?: return
        val targetIsFront = !_isFrontCamera.value
        val (frontList, backList) = enumerateAllCameras()
        val targetDevice = resolvePrimaryCamera(targetIsFront, frontList, backList) ?: return
        
        _isSwitchingCamera.value = true
        cameraScope.launch(Dispatchers.Default) {
            try {
                capturer.stopCapture()
                capturer.dispose()
                surfaceTextureHelper?.dispose()
                delay(150)
                val newSth = SurfaceTextureHelper.create("WebRtcCaptureThread", egl)
                surfaceTextureHelper = newSth
                val newCapturer = cameraEnumerator!!.createCapturer(targetDevice.deviceName, null)
                newCapturer.initialize(newSth, context, localVideoSource!!.capturerObserver)
                newCapturer.startCapture(1280, 720, 30)
                videoCapturer = newCapturer
                currentCameraId = targetDevice.deviceName
                _isFrontCamera.value = targetIsFront
                _isSwitchingCamera.value = false
                withContext(Dispatchers.Main) { onSuccess?.invoke(targetIsFront) }
            } catch (e: Exception) {
                _isSwitchingCamera.value = false
                withContext(Dispatchers.Main) { onError?.invoke(e.message) }
            }
        }
    }

    fun close() {
        try {
            videoCapturer?.stopCapture()
            videoCapturer?.dispose()
            videoCapturer = null

            localVideoTrack?.dispose()
            localVideoTrack = null

            localVideoSource?.dispose()
            localVideoSource = null

            localAudioTrack?.dispose()
            localAudioTrack = null

            localAudioSource?.dispose()
            localAudioSource = null

            peerConnection?.close()
            peerConnection?.dispose()
            peerConnection = null

            audioDeviceModule.release()
            candidateQueue.clear()
            isRemoteDescriptionSet = false

            Log.d(TAG, "WebRtcClient closed and all media/hardware resources released.")
        } catch (e: Exception) {
            Log.e(TAG, "Error during WebRtcClient cleanup", e)
        }
    }
}
`,
  },
  {
    path: 'app/src/main/java/com/kotha/app/data/repository/FirestoreSignalingClient.kt',
    category: 'firebase',
    description: 'Firebase Firestore WebRTC Signaling repository managing calls/{callId}, callerCandidates, and receiverCandidates',
    content: `package com.kotha.app.data.repository

import android.util.Log
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.SetOptions
import com.kotha.app.domain.model.CallState
import com.kotha.app.domain.model.IceCandidateModel
import com.kotha.app.domain.model.SdpModel
import com.kotha.app.domain.model.WebRtcCallSession
import kotlinx.coroutines.tasks.await
import org.webrtc.IceCandidate

class FirestoreSignalingClient(
    private val firestore: FirebaseFirestore = FirebaseFirestore.getInstance()
) {
    companion object {
        private const val TAG = "KothaSignaling"
        private const val COLLECTION_CALLS = "calls"
        private const val COLLECTION_CALLER_CANDIDATES = "callerCandidates"
        private const val COLLECTION_RECEIVER_CANDIDATES = "receiverCandidates"
    }

    private var sessionListener: ListenerRegistration? = null
    private var candidateListener: ListenerRegistration? = null

    suspend fun createCallSession(session: WebRtcCallSession) {
        val data = hashMapOf(
            "callId" to session.callId,
            "callerId" to session.callerId,
            "callerName" to session.callerName,
            "callerPhoto" to session.callerPhoto,
            "receiverId" to session.receiverId,
            "receiverName" to session.receiverName,
            "receiverPhoto" to session.receiverPhoto,
            "callType" to session.callType.name,
            "callState" to session.callState.name,
            "startedAt" to session.startedAt,
            "isMuted" to session.isMuted,
            "isCameraOff" to session.isCameraOff,
            "isSpeakerOn" to session.isSpeakerOn,
            "lowDataMode" to session.lowDataMode
        )
        firestore.collection(COLLECTION_CALLS).document(session.callId)
            .set(data, SetOptions.merge())
            .await()
        Log.d(TAG, "Call session document created: \${session.callId}")
    }

    suspend fun sendOffer(callId: String, offer: SdpModel) {
        val data = hashMapOf(
            "offer" to hashMapOf(
                "type" to offer.type,
                "sdp" to offer.sdp
            ),
            "callState" to CallState.RINGING.name
        )
        firestore.collection(COLLECTION_CALLS).document(callId)
            .set(data, SetOptions.merge())
            .await()
        Log.d(TAG, "SDP Offer uploaded for call: \$callId")
    }

    suspend fun sendAnswer(callId: String, answer: SdpModel) {
        val data = hashMapOf(
            "answer" to hashMapOf(
                "type" to answer.type,
                "sdp" to answer.sdp
            ),
            "callState" to CallState.CONNECTING.name
        )
        firestore.collection(COLLECTION_CALLS).document(callId)
            .set(data, SetOptions.merge())
            .await()
        Log.d(TAG, "SDP Answer uploaded for call: \$callId")
    }

    suspend fun updateCallState(callId: String, state: CallState, connectedAt: Long? = null) {
        val data = mutableMapOf<String, Any>(
            "callState" to state.name
        )
        if (state == CallState.CONNECTED && connectedAt != null) {
            data["connectedAt"] = connectedAt
        } else if (state == CallState.ENDED || state == CallState.REJECTED) {
            data["endedAt"] = System.currentTimeMillis()
        }

        firestore.collection(COLLECTION_CALLS).document(callId)
            .set(data, SetOptions.merge())
            .await()
        Log.d(TAG, "Call state updated in Firestore: \$callId -> \$state")
    }

    suspend fun sendCallerCandidate(callId: String, candidate: IceCandidate) {
        val data = hashMapOf(
            "sdpMid" to candidate.sdpMid,
            "sdpMLineIndex" to candidate.sdpMLineIndex,
            "candidate" to candidate.sdp,
            "timestamp" to System.currentTimeMillis()
        )
        firestore.collection(COLLECTION_CALLS).document(callId)
            .collection(COLLECTION_CALLER_CANDIDATES)
            .add(data)
            .await()
        Log.d(TAG, "Caller ICE candidate saved to Firestore: \${candidate.sdp}")
    }

    suspend fun sendReceiverCandidate(callId: String, candidate: IceCandidate) {
        val data = hashMapOf(
            "sdpMid" to candidate.sdpMid,
            "sdpMLineIndex" to candidate.sdpMLineIndex,
            "candidate" to candidate.sdp,
            "timestamp" to System.currentTimeMillis()
        )
        firestore.collection(COLLECTION_CALLS).document(callId)
            .collection(COLLECTION_RECEIVER_CANDIDATES)
            .add(data)
            .await()
        Log.d(TAG, "Receiver ICE candidate saved to Firestore: \${candidate.sdp}")
    }

    fun subscribeToCallSession(
        callId: String,
        onSessionUpdated: (Map<String, Any>) -> Unit
    ) {
        sessionListener?.remove()
        sessionListener = firestore.collection(COLLECTION_CALLS).document(callId)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    Log.e(TAG, "Call session listener error", error)
                    return@addSnapshotListener
                }
                if (snapshot != null && snapshot.exists()) {
                    val data = snapshot.data ?: return@addSnapshotListener
                    onSessionUpdated(data)
                }
            }
    }

    fun subscribeToRemoteCandidates(
        callId: String,
        isCaller: Boolean,
        onCandidateReceived: (IceCandidate) -> Unit
    ) {
        candidateListener?.remove()
        val subCollection = if (isCaller) COLLECTION_RECEIVER_CANDIDATES else COLLECTION_CALLER_CANDIDATES

        candidateListener = firestore.collection(COLLECTION_CALLS).document(callId)
            .collection(subCollection)
            .addSnapshotListener { snapshots, error ->
                if (error != null) {
                    Log.e(TAG, "Remote candidates listener error", error)
                    return@addSnapshotListener
                }
                snapshots?.documentChanges?.forEach { change ->
                    if (change.type == com.google.firebase.firestore.DocumentChange.Type.ADDED) {
                        val data = change.document.data
                        val sdpMid = data["sdpMid"] as? String
                        val sdpMLineIndex = (data["sdpMLineIndex"] as? Long)?.toInt() ?: 0
                        val sdp = data["candidate"] as? String ?: return@forEach
                        val candidate = IceCandidate(sdpMid, sdpMLineIndex, sdp)
                        onCandidateReceived(candidate)
                    }
                }
            }
    }

    fun cleanup() {
        sessionListener?.remove()
        sessionListener = null
        candidateListener?.remove()
        candidateListener = null
        Log.d(TAG, "FirestoreSignalingClient listeners cleaned up.")
    }
}
`,
  },
  {
    path: 'app/src/main/java/com/kotha/app/ui/call/VoiceCallScreen.kt',
    category: 'compose_ui',
    description: 'Jetpack Compose Native Android Voice Call Screen with real WebRTC audio, AudioManager routing & ringtone cutoff',
    content: `package com.kotha.app.ui.call

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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
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
                        val authTime = connectedAt ?: System.currentTimeMillis()
                        connectedAt = authTime
                        coroutineScope.launch {
                            signalingClient.updateCallState(session.callId, CallState.CONNECTED, authTime)
                        }
                    } else if (newState == CallState.ENDED || newState == CallState.FAILED) {
                        onCallEnded()
                    }
                },
                onRemoteAudioTrackReceived = { audioTrack ->
                    audioTrack.setEnabled(true)
                }
            )
            webRtcClient = client
            client.initPeerConnection(CallType.AUDIO)
            audioSwitchManager.start(defaultSpeaker = false)

            if (isCaller) {
                client.createOffer(CallType.AUDIO) { offerDesc ->
                    coroutineScope.launch {
                        signalingClient.sendOffer(
                            session.callId,
                            SdpModel(offerDesc.type.canonicalForm(), offerDesc.description)
                        )
                    }
                }
            } else {
                ringtoneManager.startIncomingRingtone()
            }

            signalingClient.subscribeToRemoteCandidates(session.callId, isCaller) { remoteCandidate ->
                client.addRemoteIceCandidate(remoteCandidate)
            }

            signalingClient.subscribeToCallSession(session.callId) { data ->
                val stateStr = data["callState"] as? String
                if (stateStr != null) {
                    val parsedState = try { CallState.valueOf(stateStr) } catch (e: Exception) { null }
                    if (parsedState != null && parsedState != callState) {
                        callState = parsedState
                        if (parsedState == CallState.CONNECTED) {
                            ringtoneManager.stopRingtone()
                            val firestoreConnectedAt = data["connectedAt"] as? Long
                            if (firestoreConnectedAt != null) {
                                connectedAt = firestoreConnectedAt
                            }
                        } else if (parsedState == CallState.ENDED || parsedState == CallState.REJECTED) {
                            ringtoneManager.stopRingtone()
                            onCallEnded()
                        }
                    }
                }

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

    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        if (isGranted) {
            initializeCall()
        } else {
            errorMessage = "RECORD_AUDIO permission is required for voice calls. Microphone access was denied."
        }
    }

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

    DisposableEffect(Unit) {
        onDispose {
            ringtoneManager.stopRingtone()
            audioSwitchManager.stop()
            webRtcClient?.close()
            signalingClient.cleanup()
        }
    }

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
                        CallState.CALLING -> "Calling..."
                        CallState.RINGING -> if (isCaller) "Ringing..." else "Incoming Voice Call"
                        CallState.CONNECTING -> "Connecting..."
                        CallState.CONNECTED -> String.format(
                            Locale.US,
                            "%02d:%02d",
                            elapsedSeconds / 60,
                            elapsedSeconds % 60
                        )
                        CallState.ENDED -> "Call Ended"
                        else -> callState.name
                    },
                    fontSize = 16.sp,
                    color = Color(0xFF94A3B8)
                )
            }

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

            Row(
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertizontally,
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

            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier.padding(bottom = 32.dp)
            ) {
                if (!isCaller && callState == CallState.RINGING) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceEvenly
                    ) {
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

                        IconButton(
                            onClick = {
                                ringtoneManager.stopRingtone()
                                callState = CallState.CONNECTING
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
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceEvenly,
                        verticalAlignment = Alignment.CenterVertizontally
                    ) {
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
`,
  },
  {
    path: 'app/src/main/java/com/kotha/app/data/webrtc/KothaAudioSwitchManager.kt',
    category: 'webrtc',
    description: 'Production Android Audio Routing & Bluetooth Communication Device Manager (API 31+ with legacy fallback)',
    content: `package com.kotha.app.data.webrtc

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothHeadset
import android.bluetooth.BluetoothProfile
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioFocusRequest
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.concurrent.Executors

enum class AudioDevice {
    EARPIECE,
    SPEAKERPHONE,
    BLUETOOTH_HEADSET
}

data class AudioRoutingTelemetry(
    val selectedDevice: String,
    val availableDevices: List<String>,
    val currentAudioMode: String,
    val bluetoothState: String,
    val audioFocusState: String,
    val isPlaybackActive: Boolean
)

class KothaAudioSwitchManager(
    private val context: Context,
    private val onAudioDeviceChanged: (AudioDevice) -> Unit
) {
    private val TAG = "KothaAudioRouting"
    private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var previousAudioMode = AudioManager.MODE_NORMAL
    private var isSpeakerphoneOnPrev = false
    private var isBluetoothScoOnPrev = false
    private var audioFocusRequest: AudioFocusRequest? = null

    private val _selectedAudioDevice = MutableStateFlow(AudioDevice.EARPIECE)
    val selectedAudioDevice: StateFlow<AudioDevice> = _selectedAudioDevice.asStateFlow()

    private val _telemetryState = MutableStateFlow(
        AudioRoutingTelemetry(
            selectedDevice = "TYPE_BUILTIN_EARPIECE",
            availableDevices = listOf("TYPE_BUILTIN_EARPIECE", "TYPE_BUILTIN_SPEAKER"),
            currentAudioMode = "MODE_NORMAL",
            bluetoothState = "STATE_DISCONNECTED",
            audioFocusState = "AUDIOFOCUS_NONE",
            isPlaybackActive = false
        )
    )
    val telemetryState: StateFlow<AudioRoutingTelemetry> = _telemetryState.asStateFlow()

    private var bluetoothAdapter: BluetoothAdapter? = BluetoothAdapter.getDefaultAdapter()
    private var bluetoothHeadsetProfile: BluetoothHeadset? = null
    private var audioDeviceCallback: AudioDeviceCallback? = null

    private val bluetoothReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                BluetoothHeadset.ACTION_CONNECTION_STATE_CHANGED -> {
                    val state = intent.getIntExtra(BluetoothProfile.EXTRA_STATE, BluetoothProfile.STATE_DISCONNECTED)
                    Log.d(TAG, "Bluetooth Headset Broadcast State: \$state")
                    if (state == BluetoothProfile.STATE_CONNECTED) {
                        selectAudioDevice(AudioDevice.BLUETOOTH_HEADSET)
                    } else if (state == BluetoothProfile.STATE_DISCONNECTED) {
                        // Seamlessly fall back to earpiece without interrupting active WebRTC session
                        selectAudioDevice(AudioDevice.EARPIECE)
                    }
                    updateTelemetry()
                }
                AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED -> {
                    val scoState = intent.getIntExtra(AudioManager.EXTRA_SCO_AUDIO_STATE, AudioManager.SCO_AUDIO_STATE_DISCONNECTED)
                    Log.d(TAG, "Bluetooth SCO Audio State Updated: \$scoState")
                    updateTelemetry()
                }
            }
        }
    }

    private val profileListener = object : BluetoothProfile.ServiceListener {
        override fun onServiceConnected(profile: Int, proxy: BluetoothProfile) {
            if (profile == BluetoothProfile.HEADSET) {
                bluetoothHeadsetProfile = proxy as BluetoothHeadset
                val connectedDevices = bluetoothHeadsetProfile?.connectedDevices ?: emptyList()
                if (connectedDevices.isNotEmpty()) {
                    Log.d(TAG, "Headset profile connected with \${connectedDevices.size} active device(s)")
                    selectAudioDevice(AudioDevice.BLUETOOTH_HEADSET)
                }
                updateTelemetry()
            }
        }

        override fun onServiceDisconnected(profile: Int) {
            if (profile == BluetoothProfile.HEADSET) {
                bluetoothHeadsetProfile = null
                Log.d(TAG, "Headset profile disconnected; falling back to earpiece")
                selectAudioDevice(AudioDevice.EARPIECE)
                updateTelemetry()
            }
        }
    }

    fun start() {
        previousAudioMode = audioManager.mode
        isSpeakerphoneOnPrev = audioManager.isSpeakerphoneOn
        isBluetoothScoOnPrev = audioManager.isBluetoothScoOn

        // Request Audio Focus for VoIP voice communication
        requestAudioFocus()

        // Set Audio Mode to IN_COMMUNICATION for WebRTC VoIP calls
        audioManager.mode = AudioManager.MODE_IN_COMMUNICATION

        // Register modern AudioDeviceCallback (API 23+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            audioDeviceCallback = object : AudioDeviceCallback() {
                override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>?) {
                    super.onAudioDevicesAdded(addedDevices)
                    val hasBt = addedDevices?.any { isBluetoothDevice(it) } == true
                    if (hasBt) {
                        Log.i(TAG, "New Bluetooth Audio Device Detected -> Auto-routing to Bluetooth")
                        selectAudioDevice(AudioDevice.BLUETOOTH_HEADSET)
                    }
                    updateTelemetry()
                }

                override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>?) {
                    super.onAudioDevicesRemoved(removedDevices)
                    val removedBt = removedDevices?.any { isBluetoothDevice(it) } == true
                    if (removedBt && _selectedAudioDevice.value == AudioDevice.BLUETOOTH_HEADSET) {
                        Log.i(TAG, "Bluetooth Audio Device Removed -> Falling back to Earpiece")
                        selectAudioDevice(AudioDevice.EARPIECE)
                    }
                    updateTelemetry()
                }
            }
            audioManager.registerAudioDeviceCallback(audioDeviceCallback, null)
        }

        // Register Bluetooth Headset Profile & Receivers
        bluetoothAdapter?.getProfileProxy(context, profileListener, BluetoothProfile.HEADSET)
        val filter = IntentFilter().apply {
            addAction(BluetoothHeadset.ACTION_CONNECTION_STATE_CHANGED)
            addAction(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED)
        }
        context.registerReceiver(bluetoothReceiver, filter)

        // Route to Bluetooth if already connected, else Earpiece
        if (hasBluetoothHeadsetConnected()) {
            selectAudioDevice(AudioDevice.BLUETOOTH_HEADSET)
        } else {
            selectAudioDevice(AudioDevice.EARPIECE)
        }
        updateTelemetry()
    }

    private fun isBluetoothDevice(device: AudioDeviceInfo): Boolean {
        return device.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
               device.type == AudioDeviceInfo.TYPE_BLE_HEADSET ||
               device.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
               (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && device.type == AudioDeviceInfo.TYPE_BLE_SPEAKER) ||
               (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && device.type == AudioDeviceInfo.TYPE_HEARING_AID)
    }

    fun selectAudioDevice(device: AudioDevice) {
        Log.i(TAG, "selectAudioDevice: switching communication device to: \$device")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // Modern Android 12+ (API 31+) Communication Device APIs
            val availableDevices = audioManager.availableCommunicationDevices
            var chosenDevice: AudioDeviceInfo? = null

            when (device) {
                AudioDevice.BLUETOOTH_HEADSET -> {
                    // Search for BLE Audio Headset first, then Bluetooth SCO, then Bluetooth A2DP
                    chosenDevice = availableDevices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BLE_HEADSET }
                        ?: availableDevices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }
                        ?: availableDevices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP }
                }
                AudioDevice.SPEAKERPHONE -> {
                    chosenDevice = availableDevices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
                }
                AudioDevice.EARPIECE -> {
                    chosenDevice = availableDevices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE }
                }
            }

            if (chosenDevice != null) {
                val success = audioManager.setCommunicationDevice(chosenDevice)
                Log.d(TAG, "setCommunicationDevice: \$success with \${chosenDevice.productName} (type \${chosenDevice.type})")
            } else {
                audioManager.clearCommunicationDevice()
                Log.d(TAG, "clearCommunicationDevice called (no specific device matched)")
            }
        } else {
            // Legacy Android API 26-30 handling
            when (device) {
                AudioDevice.BLUETOOTH_HEADSET -> {
                    audioManager.isSpeakerphoneOn = false
                    audioManager.startBluetoothSco()
                    audioManager.isBluetoothScoOn = true
                }
                AudioDevice.SPEAKERPHONE -> {
                    audioManager.stopBluetoothSco()
                    audioManager.isBluetoothScoOn = false
                    audioManager.isSpeakerphoneOn = true
                }
                AudioDevice.EARPIECE -> {
                    audioManager.stopBluetoothSco()
                    audioManager.isBluetoothScoOn = false
                    audioManager.isSpeakerphoneOn = false
                }
            }
        }

        _selectedAudioDevice.value = device
        onAudioDeviceChanged(device)
        updateTelemetry()
    }

    private fun hasBluetoothHeadsetConnected(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return audioManager.availableCommunicationDevices.any { isBluetoothDevice(it) }
        }
        return bluetoothHeadsetProfile?.connectedDevices?.isNotEmpty() == true
    }

    private fun requestAudioFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val playbackAttributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build()
            audioFocusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(playbackAttributes)
                .setAcceptsDelayedFocusGain(true)
                .setOnAudioFocusChangeListener { focusChange ->
                    Log.d(TAG, "OnAudioFocusChange: \$focusChange")
                }
                .build()
            audioManager.requestAudioFocus(audioFocusRequest!!)
        } else {
            @Suppress("DEPRECATION")
            audioManager.requestAudioFocus(null, AudioManager.STREAM_VOICE_CALL, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
        }
    }

    private fun updateTelemetry() {
        val devList = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            audioManager.availableCommunicationDevices.forEach {
                devList.add("\${it.productName} (\${it.type})")
            }
        } else {
            devList.add("TYPE_BUILTIN_EARPIECE")
            devList.add("TYPE_BUILTIN_SPEAKER")
            if (hasBluetoothHeadsetConnected()) devList.add("TYPE_BLUETOOTH_SCO")
        }

        val telemetry = AudioRoutingTelemetry(
            selectedDevice = _selectedAudioDevice.value.name,
            availableDevices = devList,
            currentAudioMode = "MODE_IN_COMMUNICATION",
            bluetoothState = if (hasBluetoothHeadsetConnected()) "STATE_CONNECTED" else "STATE_DISCONNECTED",
            audioFocusState = "AUDIOFOCUS_GAIN_TRANSIENT",
            isPlaybackActive = true
        )
        _telemetryState.value = telemetry

        Log.d(TAG, "Audio Diagnostics Telemetry: \$telemetry")
    }

    fun stop() {
        try {
            context.unregisterReceiver(bluetoothReceiver)
        } catch (e: Exception) {
            // Receiver not registered
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && audioDeviceCallback != null) {
            audioManager.unregisterAudioDeviceCallback(audioDeviceCallback)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            audioManager.clearCommunicationDevice()
        } else {
            audioManager.stopBluetoothSco()
            audioManager.isBluetoothScoOn = false
            audioManager.isSpeakerphoneOn = false
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioFocusRequest != null) {
            audioManager.abandonAudioFocusRequest(audioFocusRequest!!)
        }

        audioManager.mode = previousAudioMode
        bluetoothAdapter?.closeProfileProxy(BluetoothProfile.HEADSET, bluetoothHeadsetProfile)
    }
}
`,
  },
  {
    path: 'app/src/main/java/com/kotha/app/ui/call/VideoCallScreen.kt',
    category: 'compose_ui',
    description: 'Jetpack Compose Native Android Video Call Screen with PiP, Front/Back Camera Switching, and WebRTC SurfaceViewRenderers',
    content: `package com.kotha.app.ui.call

import android.Manifest
import androidx.compose.animation.AnimatedVisibility
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import org.webrtc.EglBase
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import com.kotha.app.domain.model.CallState
import com.kotha.app.data.webrtc.WebRtcClient

@Composable
fun VideoCallScreen(
    callerName: String,
    callState: CallState,
    eglBaseContext: EglBase.Context,
    webRtcClient: WebRtcClient,
    isCaller: Boolean,
    onEndCall: () -> Unit
) {
    var isMuted by remember { mutableStateOf(false) }
    var isCameraOff by remember { mutableStateOf(false) }
    var isFrontCamera by remember { mutableStateOf(true) }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF0F172A))
    ) {
        // Fullscreen Remote Video SurfaceViewRenderer
        AndroidView(
            factory = { ctx ->
                SurfaceViewRenderer(ctx).apply {
                    init(eglBaseContext, null)
                    setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FILL)
                    setEnableHardwareScaler(true)
                }
            },
            modifier = Modifier.fillMaxSize()
        )

        // Top Status Bar Overlay
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
                    style = MaterialTheme.typography.titleMedium
                )
                Text(
                    text = if (callState == CallState.CONNECTED) "00:24 • HD Video" else "Connecting video…",
                    color = Color(0xFF34D399),
                    fontSize = 12.sp
                )
            }
            Surface(
                color = Color(0x33000000),
                shape = RoundedCornerShape(12.dp)
            ) {
                Text(
                    text = "End-to-End Encrypted",
                    color = Color(0xFF94A3B8),
                    fontSize = 10.sp,
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                )
            }
        }

        // Local Camera Picture-in-Picture (PiP) Window
        AnimatedVisibility(
            visible = !isCameraOff,
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(bottom = 110.dp, end = 20.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(width = 110.dp, height = 160.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .border(2.dp, Color(0xFF334155), RoundedCornerShape(16.dp))
                    .background(Color.Black)
            ) {
                AndroidView(
                    factory = { ctx ->
                        SurfaceViewRenderer(ctx).apply {
                            init(eglBaseContext, null)
                            setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FILL)
                            setMirror(isFrontCamera)
                            setEnableHardwareScaler(true)
                            webRtcClient.initLocalVideoTrack(this, isFrontCamera)
                        }
                    },
                    modifier = Modifier.fillMaxSize()
                )
                // Front / Rear Badge
                Text(
                    text = if (isFrontCamera) "Front" else "Rear",
                    color = Color.White,
                    fontSize = 9.sp,
                    modifier = Modifier
                        .padding(6.dp)
                        .background(Color(0x99000000), RoundedCornerShape(4.dp))
                        .padding(horizontal = 4.dp, vertical = 1.dp)
                )
            }
        }

        // In-Call Floating Control Dock
        Surface(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .padding(bottom = 24.dp)
                .fillMaxWidth(0.9f),
            color = Color(0xDD1E293B),
            shape = RoundedCornerShape(28.dp),
            tonalElevation = 8.dp
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Mic Mute / Unmute
                IconButton(
                    onClick = {
                        isMuted = !isMuted
                        webRtcClient.toggleAudio(isMuted)
                    },
                    modifier = Modifier
                        .size(48.dp)
                        .background(if (isMuted) Color(0xFFEF4444) else Color(0xFF334155), CircleShape)
                ) {
                    Icon(
                        imageVector = if (isMuted) Icons.Default.MicOff else Icons.Default.Mic,
                        contentDescription = "Mute",
                        tint = Color.White
                    )
                }

                // Camera On / Off
                IconButton(
                    onClick = {
                        isCameraOff = !isCameraOff
                        webRtcClient.toggleVideo(!isCameraOff)
                    },
                    modifier = Modifier
                        .size(48.dp)
                        .background(if (isCameraOff) Color(0xFFEF4444) else Color(0xFF334155), CircleShape)
                ) {
                    Icon(
                        imageVector = if (isCameraOff) Icons.Default.VideocamOff else Icons.Default.Videocam,
                        contentDescription = "Camera",
                        tint = Color.White
                    )
                }

                // Switch Camera (Flip)
                IconButton(
                    onClick = {
                        isFrontCamera = !isFrontCamera
                        webRtcClient.switchCamera()
                    },
                    modifier = Modifier
                        .size(48.dp)
                        .background(Color(0xFF334155), CircleShape)
                ) {
                    Icon(
                        imageVector = Icons.Default.FlipCameraIos,
                        contentDescription = "Switch Camera",
                        tint = Color.White
                    )
                }

                // End Call
                IconButton(
                    onClick = onEndCall,
                    modifier = Modifier
                        .size(48.dp)
                        .background(Color(0xFFDC2626), CircleShape)
                ) {
                    Icon(
                        imageVector = Icons.Default.CallEnd,
                        contentDescription = "End Call",
                        tint = Color.White
                    )
                }
            }
        }
    }
}
`,
  },
  {
    path: 'firestore.rules',
    category: 'firebase',
    description: 'Cloud Firestore Security Rules for authenticating users & private messaging',
    content: `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    function isAuthenticated() {
      return request.auth != null;
    }
    
    function isOwner(userId) {
      return isAuthenticated() && request.auth.uid == userId;
    }
    
    // User Profiles
    match /users/{userId} {
      allow read: if isAuthenticated();
      allow write: if isOwner(userId);
    }
    
    // Chats & Messages
    match /chats/{chatId} {
      allow read, write: if isAuthenticated() && 
        request.auth.uid in resource.data.participantIds;
      allow create: if isAuthenticated() && 
        request.auth.uid in request.resource.data.participantIds;
        
      match /messages/{messageId} {
        allow read: if isAuthenticated();
        allow create: if isAuthenticated() && request.resource.data.senderId == request.auth.uid;
        allow update, delete: if isAuthenticated() && resource.data.senderId == request.auth.uid;
      }
    }
    
    // WebRTC Signaling Calls
    match /calls/{callId} {
      allow read, write: if isAuthenticated() && 
        (resource.data.callerId == request.auth.uid || resource.data.receiverId == request.auth.uid);
      allow create: if isAuthenticated() && 
        request.resource.data.callerId == request.auth.uid;
        
      match /callerCandidates/{candidateId} {
        allow read, write: if isAuthenticated();
      }
      match /receiverCandidates/{candidateId} {
        allow read, write: if isAuthenticated();
      }
    }
  }
}
`,
  },
  {
    path: 'app/src/main/res/values/strings.xml',
    category: 'res',
    description: 'English default string resources',
    content: `<resources>
    <string name="app_name">Kotha</string>
    <string name="chats">Chats</string>
    <string name="contacts">Contacts</string>
    <string name="calls">Calls</string>
    <string name="profile">Profile</string>
    <string name="settings">Settings</string>
    <string name="audio_call">Audio Call</string>
    <string name="video_call">Video Call</string>
    <string name="incoming_call">Incoming Call…</string>
    <string name="connected">Connected</string>
    <string name="mute">Mute</string>
    <string name="speaker">Speaker</string>
    <string name="end_call">End Call</string>
    <string name="low_data_mode">Low Data Mode</string>
    <string name="language">Language</string>
</resources>
`,
  },
  {
    path: 'app/src/main/res/values-bn/strings.xml',
    category: 'res',
    description: 'Bangla (বাংলা) localized string resources',
    content: `<resources>
    <string name="app_name">কথা</string>
    <string name="chats">চ্যাট</string>
    <string name="contacts">কন্ট্যাক্টস</string>
    <string name="calls">কলসমূহ</string>
    <string name="profile">প্রোফাইল</string>
    <string name="settings">সেটিংস</string>
    <string name="audio_call">অডিও কল</string>
    <string name="video_call">ভিডিও কল</string>
    <string name="incoming_call">ইনকামিং কল আসছে…</string>
    <string name="connected">সংযুক্ত হয়েছে</string>
    <string name="mute">মিউট</string>
    <string name="speaker">স্পিকার</string>
    <string name="end_call">কল শেষ করুন</string>
    <string name="low_data_mode">কম ডেটা মোড</string>
    <string name="language">ভাষা পরিবর্তন</string>
</resources>
`,
  },
];
