package com.kotha.app.data.webrtc

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CameraMetadata
import android.media.AudioAttributes
import android.util.Log
import androidx.core.content.ContextCompat
import com.kotha.app.domain.model.CallState
import com.kotha.app.domain.model.CallType
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.webrtc.*
import org.webrtc.audio.JavaAudioDeviceModule
import java.util.concurrent.ConcurrentLinkedQueue

/**
 * Production Native WebRTC Client for Kotha 1-to-1 Voice and Video Calling.
 * Handles hardware microphone acquisition, SDP offer/answer negotiation,
 * ICE candidate queueing, and remote audio playback.
 * 
 * STRICT MANDATE: Never simulates microphone audio or generates synthetic fallback streams.
 */
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
    private var surfaceTextureHelper: SurfaceTextureHelper? = null
    private var cameraEnumerator: CameraEnumerator? = null
    private var frontCameraId: String? = null
    private var backCameraId: String? = null
    private var currentCameraId: String? = null
    private val attachedSinks = java.util.Collections.newSetFromMap(java.util.WeakHashMap<VideoSink, Boolean>())
    private val cameraScope = CoroutineScope(Dispatchers.Default + SupervisorJob())
    private val switchMutex = Mutex()

    data class CameraDeviceInfo(
        val deviceName: String,
        val isFrontFacing: Boolean,
        val isBackFacing: Boolean,
        val isBackwardCompatible: Boolean,
        val hardwareLevel: Int?,
        val focalLengths: FloatArray?
    )

    private fun createCameraEventsHandler(cameraName: String): CameraVideoCapturer.CameraEventsHandler {
        return object : CameraVideoCapturer.CameraEventsHandler {
            override fun onCameraError(errorDescription: String?) {
                Log.e(TAG, "[WebRTC-Camera] Camera error on '$cameraName': $errorDescription")
            }
            override fun onCameraDisconnected() {
                Log.w(TAG, "[WebRTC-Camera] Camera disconnected on '$cameraName'")
            }
            override fun onCameraFreezed(errorDescription: String?) {
                Log.w(TAG, "[WebRTC-Camera] Camera freezed on '$cameraName': $errorDescription")
            }
            override fun onCameraOpening(openedCameraName: String?) {
                Log.d(TAG, "[WebRTC-Camera] Hardware camera opening: '$openedCameraName'")
            }
            override fun onFirstFrameAvailable() {
                Log.d(TAG, "[WebRTC-Camera] First hardware video frame available from '$cameraName'")
            }
            override fun onCameraClosed() {
                Log.d(TAG, "[WebRTC-Camera] Hardware camera closed: '$cameraName'")
            }
        }
    }

    /**
     * Inspects actual WebRTC camera enumeration (Camera2Enumerator.getDeviceNames())
     * and queries Android CameraManager characteristics for every camera.
     * Accurately categorizes devices into verified FRONT and BACK lists.
     */
    fun enumerateAllCameras(): Pair<List<CameraDeviceInfo>, List<CameraDeviceInfo>> {
        val enumerator = cameraEnumerator ?: run {
            val created = if (Camera2Enumerator.isSupported(context)) {
                Log.d(TAG, "[WebRTC-Camera] Camera2Enumerator is supported on this device.")
                Camera2Enumerator(context)
            } else {
                Log.w(TAG, "[WebRTC-Camera] Camera2Enumerator is NOT supported, falling back to Camera1Enumerator.")
                Camera1Enumerator(true)
            }
            cameraEnumerator = created
            created
        }

        val deviceNames = enumerator.deviceNames ?: emptyArray()
        val cameraManager = try {
            context.getSystemService(Context.CAMERA_SERVICE) as? CameraManager
        } catch (e: Exception) {
            null
        }

        val frontList = mutableListOf<CameraDeviceInfo>()
        val backList = mutableListOf<CameraDeviceInfo>()

        Log.d(TAG, "[WebRTC-Camera] === Enumerating all camera devices (total=${deviceNames.size}) ===")
        for (deviceName in deviceNames) {
            val isFront = enumerator.isFrontFacing(deviceName)
            val isBack = enumerator.isBackFacing(deviceName)

            var isBackwardComp = true
            var hwLevel: Int? = null
            var focals: FloatArray? = null

            if (cameraManager != null) {
                try {
                    val chars = cameraManager.getCameraCharacteristics(deviceName)
                    hwLevel = chars.get(CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL)
                    focals = chars.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)
                    val caps = chars.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES)
                    if (caps != null) {
                        isBackwardComp = caps.contains(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_BACKWARD_COMPATIBLE)
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "[WebRTC-Camera] Could not query CameraCharacteristics for $deviceName: ${e.message}")
                }
            }

            val info = CameraDeviceInfo(
                deviceName = deviceName,
                isFrontFacing = isFront,
                isBackFacing = isBack,
                isBackwardCompatible = isBackwardComp,
                hardwareLevel = hwLevel,
                focalLengths = focals
            )

            Log.d(
                TAG,
                "[WebRTC-Camera] -> Found Device: '$deviceName' | isFront=$isFront, isBack=$isBack, backwardCompatible=$isBackwardComp, hwLevel=$hwLevel"
            )

            if (isFront) {
                frontList.add(info)
            }
            if (isBack) {
                backList.add(info)
            }
        }

        return Pair(frontList, backList)
    }

    /**
     * Resolves the primary camera device for the requested direction (FRONT vs BACK).
     * Strictly verifies physical lens facing (isFrontFacing / isBackFacing) and selects real sensors
     * without assuming hardcoded camera indexes or device IDs.
     */
    fun resolvePrimaryCamera(
        targetIsFront: Boolean,
        frontList: List<CameraDeviceInfo>,
        backList: List<CameraDeviceInfo>
    ): CameraDeviceInfo? {
        return if (targetIsFront) {
            // Pick physical front-facing camera: prioritize backward-compatible selfie sensor
            frontList.firstOrNull { it.isFrontFacing && it.isBackwardCompatible }
                ?: frontList.firstOrNull { it.isFrontFacing }
        } else {
            // Pick physical rear-facing camera: prioritize backward-compatible standard sensor
            val standardWide = backList.firstOrNull { device ->
                device.isBackFacing && device.isBackwardCompatible &&
                    device.focalLengths?.any { f -> f in 3.0f..6.5f } == true
            }
            standardWide
                ?: backList.firstOrNull { it.isBackFacing && it.isBackwardCompatible }
                ?: backList.firstOrNull { it.isBackFacing }
        }
    }

    private var remoteAudioTrack: AudioTrack? = null
    private var remoteVideoTrack: VideoTrack? = null

    private val candidateQueue = ConcurrentLinkedQueue<IceCandidate>()
    private var isRemoteDescriptionSet = false

    private val _isMicrophoneMuted = MutableStateFlow(false)
    val isMicrophoneMuted: StateFlow<Boolean> = _isMicrophoneMuted.asStateFlow()

    private val _isFrontCamera = MutableStateFlow(true)
    val isFrontCamera: StateFlow<Boolean> = _isFrontCamera.asStateFlow()

    private val _isSwitchingCamera = MutableStateFlow(false)
    val isSwitchingCamera: StateFlow<Boolean> = _isSwitchingCamera.asStateFlow()

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
        // Initialize WebRTC globals
        val initOptions = PeerConnectionFactory.InitializationOptions.builder(context)
            .setEnableInternalTracer(true)
            .createInitializationOptions()
        PeerConnectionFactory.initialize(initOptions)

        // Configure production JavaAudioDeviceModule with USAGE_VOICE_COMMUNICATION
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
                    Log.e(TAG, "[AudioModule] Record init error: $errorMessage")
                }
                override fun onWebRtcAudioRecordStartError(
                    errorCode: JavaAudioDeviceModule.AudioRecordStartErrorCode?,
                    errorMessage: String?
                ) {
                    Log.e(TAG, "[AudioModule] Record start error [$errorCode]: $errorMessage")
                }
                override fun onWebRtcAudioRecordError(errorMessage: String?) {
                    Log.e(TAG, "[AudioModule] Record runtime error: $errorMessage")
                }
            })
            .setAudioTrackErrorCallback(object : JavaAudioDeviceModule.AudioTrackErrorCallback {
                override fun onWebRtcAudioTrackInitError(errorMessage: String?) {
                    Log.e(TAG, "[AudioModule] Playback init error: $errorMessage")
                }
                override fun onWebRtcAudioTrackStartError(
                    errorCode: JavaAudioDeviceModule.AudioTrackStartErrorCode?,
                    errorMessage: String?
                ) {
                    Log.e(TAG, "[AudioModule] Playback start error [$errorCode]: $errorMessage")
                }
                override fun onWebRtcAudioTrackError(errorMessage: String?) {
                    Log.e(TAG, "[AudioModule] Playback runtime error: $errorMessage")
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

    /**
     * Initializes a real hardware microphone AudioTrack.
     * Enforces RECORD_AUDIO permission; throws explicit exception if missing.
     * Never generates synthetic or oscillator audio fallback.
     */
    fun initLocalAudioTrack() {
        val permissionState = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
        Log.d(TAG, "[WebRTC-Diagnostics] RECORD_AUDIO permission state: $permissionState (Granted=${permissionState == PackageManager.PERMISSION_GRANTED})")

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
            "[WebRTC-Diagnostics] Local AudioTrack created: ID='${localAudioTrack?.id()}', enabled=${localAudioTrack?.enabled()}, state=${localAudioTrack?.state()}"
        )
    }

    /**
     * Initializes camera video capturer and local video track for video calls.
     * Starts hardware camera capture immediately at 720p 30fps.
     * If PeerConnection is already active, binds the track to it.
     */
    fun initLocalVideoTrack(isFrontCamera: Boolean = true) {
        if (eglBaseContext == null) return
        if (localVideoTrack != null) return

        try {
            val (frontList, backList) = enumerateAllCameras()
            val targetDeviceInfo = resolvePrimaryCamera(isFrontCamera, frontList, backList)
                ?: run {
                    val allNames = cameraEnumerator?.deviceNames ?: emptyArray()
                    Log.w(TAG, "[WebRTC-Camera] resolvePrimaryCamera returned null, using first available camera.")
                    allNames.firstOrNull()?.let {
                        CameraDeviceInfo(
                            deviceName = it,
                            isFrontFacing = cameraEnumerator?.isFrontFacing(it) == true,
                            isBackFacing = cameraEnumerator?.isBackFacing(it) == true,
                            isBackwardCompatible = true,
                            hardwareLevel = null,
                            focalLengths = null
                        )
                    }
                }

            if (targetDeviceInfo == null) {
                Log.e(TAG, "[WebRTC-Camera] No camera device found on device.")
                return
            }

            val selectedDevice = targetDeviceInfo.deviceName
            val resolvedIsFront = targetDeviceInfo.isFrontFacing
            currentCameraId = selectedDevice
            _isFrontCamera.value = resolvedIsFront

            Log.d(
                TAG,
                "[WebRTC-Camera] Initializing local camera: device='$selectedDevice', isFrontFacing=$resolvedIsFront, requestedFront=$isFrontCamera"
            )

            val enumerator = cameraEnumerator!!
            val capturer = enumerator.createCapturer(selectedDevice, createCameraEventsHandler(selectedDevice))
                ?: run {
                    Log.e(TAG, "[WebRTC-Camera] Failed to create capturer for camera '$selectedDevice'")
                    return
                }
            videoCapturer = capturer

            localVideoSource = peerConnectionFactory.createVideoSource(capturer.isScreencast)
            val sth = SurfaceTextureHelper.create("WebRtcCaptureThread", eglBaseContext)
            surfaceTextureHelper = sth

            Log.d(TAG, "[WebRTC-Camera] Initializing capturer '$selectedDevice' with SurfaceTextureHelper...")
            capturer.initialize(
                sth,
                context,
                localVideoSource!!.capturerObserver
            )
            Log.d(TAG, "[WebRTC-Camera] Starting capture at 1280x720 30fps on camera '$selectedDevice'...")
            capturer.startCapture(1280, 720, 30)

            localVideoTrack = peerConnectionFactory.createVideoTrack(LOCAL_VIDEO_TRACK_ID, localVideoSource).apply {
                setEnabled(true)
            }
            Log.d(TAG, "[WebRTC-Diagnostics] Local VideoTrack created: ID='${localVideoTrack?.id()}' with camera=$selectedDevice (isFront=$resolvedIsFront)")

            // If peer connection is already created, add this track immediately
            peerConnection?.let { pc ->
                pc.addTrack(localVideoTrack, listOf(STREAM_ID))
                Log.d(TAG, "[WebRTC-Diagnostics] Bound local VideoTrack to active PeerConnection.")
            }

            // Bind any pre-registered sinks
            for (sink in attachedSinks) {
                try {
                    localVideoTrack?.addSink(sink)
                } catch (e: Exception) {
                    Log.e(TAG, "[WebRTC-Video] Error attaching sink during initLocalVideoTrack", e)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "[WebRTC-Camera] Failed to initialize local video track", e)
        }
    }

    /**
     * Attaches a SurfaceViewRenderer sink to the local video track for preview.
     */
    fun attachLocalRenderer(surfaceView: SurfaceViewRenderer) {
        localVideoTrack?.let { track ->
            if (attachedSinks.contains(surfaceView)) return
            try {
                track.addSink(surfaceView)
                attachedSinks.add(surfaceView)
                Log.d(TAG, "[WebRTC] Attached SurfaceViewRenderer sink to local VideoTrack.")
            } catch (e: Exception) {
                Log.e(TAG, "[WebRTC] Error attaching local renderer sink", e)
            }
        }
    }

    /**
     * Detaches a SurfaceViewRenderer sink from the local video track.
     */
    fun detachLocalRenderer(surfaceView: SurfaceViewRenderer) {
        localVideoTrack?.let { track ->
            try {
                track.removeSink(surfaceView)
                attachedSinks.remove(surfaceView)
                Log.d(TAG, "[WebRTC] Detached SurfaceViewRenderer sink from local VideoTrack.")
            } catch (e: Exception) {
                Log.e(TAG, "[WebRTC] Error detaching local renderer sink", e)
            }
        }
    }

    /**
     * Overload: Initializes camera video capturer and attaches local preview renderer.
     */
    fun initLocalVideoTrack(surfaceView: SurfaceViewRenderer, isFrontCamera: Boolean = true) {
        initLocalVideoTrack(isFrontCamera)
        attachLocalRenderer(surfaceView)
    }

    /**
     * Creates PeerConnection and binds local audio (and video) tracks.
     */
    fun initPeerConnection(callType: CallType) {
        if (localAudioTrack == null) {
            initLocalAudioTrack()
        }

        peerConnection = peerConnectionFactory.createPeerConnection(rtcConfig, object : PeerConnection.Observer {
            override fun onSignalingChange(state: PeerConnection.SignalingState?) {
                Log.d(TAG, "[WebRTC-Diagnostics] SignalingState: $state")
            }

            override fun onIceConnectionReceivingChange(receiving: Boolean) {
                Log.d(TAG, "[WebRTC-ICE-Diagnostics] IceConnectionReceivingChange: $receiving")
            }
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {
                Log.d(TAG, "[WebRTC-ICE-Diagnostics] IceConnectionState: $state")
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
                Log.d(TAG, "[WebRTC-ICE-Diagnostics] IceGatheringState: $state")
            }

            override fun onIceCandidate(candidate: IceCandidate?) {
                if (candidate != null) {
                    Log.d(TAG, "[WebRTC-ICE-Diagnostics] Local ICE candidate generated: ${candidate.sdp}")
                    onLocalIceCandidate(candidate)
                }
            }

            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) {
                Log.d(TAG, "[WebRTC-ICE-Diagnostics] ICE candidates removed")
            }

            override fun onTrack(transceiver: RtpTransceiver?) {
                super.onTrack(transceiver)
                val track = transceiver?.receiver?.track()
                Log.d(TAG, "[WebRTC-Diagnostics] onTrack: kind=${track?.kind()}, id=${track?.id()}, enabled=${track?.enabled()}")
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
                Log.d(TAG, "[WebRTC-Diagnostics] onAddStream: ${stream?.id}")
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
                Log.d(TAG, "[WebRTC-Diagnostics] onRemoveStream: ${stream?.id}")
            }

            override fun onDataChannel(dataChannel: DataChannel?) {}
            override fun onRenegotiationNeeded() {
                Log.d(TAG, "[WebRTC-Diagnostics] onRenegotiationNeeded")
            }
            override fun onAddTrack(receiver: RtpReceiver?, mediaStreams: Array<out MediaStream>?) {}
            override fun onConnectionChange(newState: PeerConnection.PeerConnectionState?) {
                Log.d(TAG, "[WebRTC-Diagnostics] PeerConnectionState: $newState")
            }
        })

        // Attach local audio track to PeerConnection
        localAudioTrack?.let { track ->
            val sender = peerConnection?.addTrack(track, listOf(STREAM_ID))
            Log.d(TAG, "[WebRTC-Diagnostics] Added local AudioTrack to PeerConnection. Sender track ID: ${sender?.track()?.id()}")
        }

        if (callType == CallType.VIDEO) {
            if (localVideoTrack == null) {
                initLocalVideoTrack()
            }
            localVideoTrack?.let { track ->
                peerConnection?.addTrack(track, listOf(STREAM_ID))
                Log.d(TAG, "[WebRTC-Diagnostics] Added local VideoTrack to PeerConnection.")
            }
        }

        // Log Send/Receive Transceivers diagnostic
        peerConnection?.transceivers?.forEachIndexed { index, transceiver ->
            Log.d(
                TAG,
                "[WebRTC-Diagnostics] Transceiver #$index: mid=${transceiver.mid}, direction=${transceiver.direction}, currentDirection=${transceiver.currentDirection}"
            )
        }
    }

    /**
     * Creates SDP Offer, validates m=audio section, and sets local description.
     */
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
                        Log.e(TAG, "[WebRTC-SDP] SetLocalDescription failure: $error")
                    }
                    override fun onCreateSuccess(p0: SessionDescription?) {}
                    override fun onCreateFailure(p0: String?) {}
                }, desc)
            }

            override fun onCreateFailure(error: String?) {
                Log.e(TAG, "[WebRTC-SDP] CreateOffer failure: $error")
            }
            override fun onSetSuccess() {}
            override fun onSetFailure(p0: String?) {}
        }, constraints)
    }

    /**
     * Sets remote SDP Offer, creates SDP Answer, validates m=audio, and sets local description.
     */
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
                                Log.e(TAG, "[WebRTC-SDP] SetLocalDescription failure for Answer: $error")
                            }
                            override fun onCreateSuccess(p0: SessionDescription?) {}
                            override fun onCreateFailure(p0: String?) {}
                        }, desc)
                    }

                    override fun onCreateFailure(error: String?) {
                        Log.e(TAG, "[WebRTC-SDP] CreateAnswer failure: $error")
                    }
                    override fun onSetSuccess() {}
                    override fun onSetFailure(p0: String?) {}
                }, constraints)
            }

            override fun onSetFailure(error: String?) {
                Log.e(TAG, "[WebRTC-SDP] SetRemoteDescription failure for Offer: $error")
            }
            override fun onCreateSuccess(p0: SessionDescription?) {}
            override fun onCreateFailure(p0: String?) {}
        }, sessionDescription)
    }

    /**
     * Sets remote SDP Answer on caller side, flushing any queued ICE candidates.
     */
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
                Log.e(TAG, "[WebRTC-SDP] SetRemoteDescription failure for Answer: $error")
            }
            override fun onCreateSuccess(p0: SessionDescription?) {}
            override fun onCreateFailure(p0: String?) {}
        }, sessionDescription)
    }

    /**
     * Adds an ICE candidate received from signaling. If remoteDescription has not yet
     * been applied, queues the candidate to prevent WebRTC native state exceptions.
     */
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
        Log.d(TAG, "[WebRTC-ICE] Flushing ${candidateQueue.size} queued ICE candidates...")
        while (!candidateQueue.isEmpty()) {
            val candidate = candidateQueue.poll() ?: break
            peerConnection?.addIceCandidate(candidate)
        }
    }

    /**
     * Validates that SDP contains m=audio and sendrecv.
     */
    private fun verifySdpAudioMedia(sdp: String, roleTag: String) {
        val hasAudio = sdp.contains("m=audio")
        val hasSendRecv = sdp.contains("a=sendrecv")
        Log.d(TAG, "[WebRTC-SDP-Verification] [$roleTag] m=audio present: $hasAudio, a=sendrecv present: $hasSendRecv")
        if (!hasAudio) {
            Log.e(TAG, "[WebRTC-SDP-Verification] CRITICAL: SDP missing m=audio! Audio will not negotiate.")
        }
    }

    fun toggleAudio(isMuted: Boolean) {
        _isMicrophoneMuted.value = isMuted
        localAudioTrack?.setEnabled(!isMuted)
        Log.d(TAG, "[WebRTC] Local microphone track enabled state set to: ${!isMuted}")
    }

    fun toggleVideo(isEnabled: Boolean) {
        localVideoTrack?.setEnabled(isEnabled)
    }

    /**
     * Executes hardware camera flip between Front and Back physical cameras.
     * 1. Locks/serializes camera switch using switchMutex to prevent multiple concurrent flips.
     * 2. Safely stops and disposes current capturer.
     * 3. Retains existing SurfaceTextureHelper and localVideoSource pipeline.
     * 4. Creates target physical FRONT/BACK CameraVideoCapturer.
     * 5. Verifies that the requested physical camera actually started capturing (waits for first video frame).
     * 6. Only then updates UI camera state.
     * 7. Safely restores previous working camera on any failure.
     */
    fun switchCamera(
        onSuccess: ((Boolean) -> Unit)? = null,
        onError: ((String?) -> Unit)? = null
    ) {
        val capturer = videoCapturer
        if (capturer == null) {
            Log.w(TAG, "[WebRTC-Camera] Cannot switch camera: videoCapturer is null.")
            onError?.invoke("Video capturer is not initialized")
            return
        }

        if (_isSwitchingCamera.value) {
            Log.w(TAG, "[WebRTC-Camera] Camera switch already in progress, ignoring duplicate request.")
            onError?.invoke("Camera switch in progress")
            return
        }

        val egl = eglBaseContext
        if (egl == null) {
            Log.e(TAG, "[WebRTC-Camera] Cannot switch camera: eglBaseContext is null.")
            onError?.invoke("EGL context unavailable")
            return
        }

        val currentIsFront = _isFrontCamera.value
        val targetIsFront = !currentIsFront
        val requestedDirection = if (targetIsFront) "FRONT" else "BACK"

        Log.d(TAG, "[WebRTC-Camera] === STARTING CAMERA SWITCH ===")
        Log.d(TAG, "[WebRTC-Camera] Current active camera: $currentCameraId (isFront=$currentIsFront)")
        Log.d(TAG, "[WebRTC-Camera] Requested camera direction: $requestedDirection (targetIsFront=$targetIsFront)")

        val (frontList, backList) = enumerateAllCameras()
        val targetDeviceInfo = resolvePrimaryCamera(targetIsFront, frontList, backList)

        if (targetDeviceInfo == null) {
            val errorMsg = "No valid physical $requestedDirection camera found on this device."
            Log.e(TAG, "[WebRTC-Camera] $errorMsg (frontCount=${frontList.size}, backCount=${backList.size})")
            onError?.invoke(errorMsg)
            return
        }

        val targetCameraName = targetDeviceInfo.deviceName
        Log.d(
            TAG,
            "[WebRTC-Camera] Resolved target device: '$targetCameraName' | isFront=${targetDeviceInfo.isFrontFacing}, isBack=${targetDeviceInfo.isBackFacing}, backwardComp=${targetDeviceInfo.isBackwardCompatible}"
        )

        // Strict verification: Ensure target camera device physically matches requested facing
        if (targetIsFront && !targetDeviceInfo.isFrontFacing) {
            val errorMsg = "Selected target '$targetCameraName' is NOT physical front-facing!"
            Log.e(TAG, "[WebRTC-Camera] $errorMsg")
            onError?.invoke(errorMsg)
            return
        }
        if (!targetIsFront && !targetDeviceInfo.isBackFacing) {
            val errorMsg = "Selected target '$targetCameraName' is NOT physical back-facing!"
            Log.e(TAG, "[WebRTC-Camera] $errorMsg")
            onError?.invoke(errorMsg)
            return
        }

        _isSwitchingCamera.value = true

        cameraScope.launch(Dispatchers.Default) {
            // 1. Prevent multiple simultaneous operations and lock/serialize
            if (!switchMutex.tryLock()) {
                Log.w(TAG, "[WebRTC-Camera] Switch mutex locked, another switch operation is currently running.")
                _isSwitchingCamera.value = false
                withContext(Dispatchers.Main) {
                    onError?.invoke("Camera switch in progress")
                }
                return@launch
            }

            val prevCapturer = videoCapturer
            val prevCameraId = currentCameraId
            val prevIsFront = currentIsFront

            try {
                // 2. Stop capture safely on old capturer
                Log.d(TAG, "[WebRTC-Camera] [1/5] Stopping capture on previous camera '$prevCameraId'...")
                try {
                    prevCapturer?.stopCapture()
                    Log.d(TAG, "[WebRTC-Camera] [1/5] stopCapture completed successfully.")
                } catch (e: Exception) {
                    Log.w(TAG, "[WebRTC-Camera] [1/5] stopCapture warning: ${e.message}")
                }

                // 3. Dispose old capturer correctly
                Log.d(TAG, "[WebRTC-Camera] [2/5] Disposing previous capturer...")
                try {
                    prevCapturer?.dispose()
                    Log.d(TAG, "[WebRTC-Camera] [2/5] dispose completed successfully.")
                } catch (e: Exception) {
                    Log.w(TAG, "[WebRTC-Camera] [2/5] dispose warning: ${e.message}")
                }
                videoCapturer = null

                // Hardware settle delay: give Android Camera HAL 150ms to release hardware lock
                delay(150)

                // 4. Retain existing SurfaceTextureHelper and localVideoSource pipeline
                Log.d(TAG, "[WebRTC-Camera] [3/5] Reusing existing SurfaceTextureHelper & observer pipeline...")
                val sth = surfaceTextureHelper ?: run {
                    Log.d(TAG, "[WebRTC-Camera] [3/5] SurfaceTextureHelper was null, creating new one...")
                    val created = SurfaceTextureHelper.create("WebRtcCaptureThread", egl)
                    surfaceTextureHelper = created
                    created
                }

                val observer = localVideoSource?.capturerObserver
                    ?: throw IllegalStateException("localVideoSource or capturerObserver is null")

                val enumerator = cameraEnumerator ?: if (Camera2Enumerator.isSupported(context)) Camera2Enumerator(context) else Camera1Enumerator(true)
                cameraEnumerator = enumerator

                // 5. Create target physical CameraVideoCapturer
                Log.d(TAG, "[WebRTC-Camera] [4/5] Creating CameraVideoCapturer for '$targetCameraName' ($requestedDirection)...")
                val firstFrameSignal = CompletableDeferred<Boolean>()

                val eventsHandler = object : CameraVideoCapturer.CameraEventsHandler {
                    override fun onCameraError(errorDescription: String?) {
                        Log.e(TAG, "[WebRTC-Camera] Hardware error on '$targetCameraName': $errorDescription")
                        if (!firstFrameSignal.isCompleted) {
                            firstFrameSignal.completeExceptionally(RuntimeException("Camera error: $errorDescription"))
                        }
                    }
                    override fun onCameraDisconnected() {
                        Log.w(TAG, "[WebRTC-Camera] Hardware camera disconnected on '$targetCameraName'")
                        if (!firstFrameSignal.isCompleted) {
                            firstFrameSignal.completeExceptionally(RuntimeException("Camera disconnected"))
                        }
                    }
                    override fun onCameraFreezed(errorDescription: String?) {
                        Log.w(TAG, "[WebRTC-Camera] Camera freezed on '$targetCameraName': $errorDescription")
                    }
                    override fun onCameraOpening(openedCameraName: String?) {
                        Log.d(TAG, "[WebRTC-Camera] Hardware camera opening: '$openedCameraName'")
                    }
                    override fun onFirstFrameAvailable() {
                        Log.d(TAG, "[WebRTC-Camera] First hardware video frame available from physical camera '$targetCameraName'!")
                        if (!firstFrameSignal.isCompleted) {
                            firstFrameSignal.complete(true)
                        }
                    }
                    override fun onCameraClosed() {
                        Log.d(TAG, "[WebRTC-Camera] Hardware camera closed: '$targetCameraName'")
                    }
                }

                val newCapturer = enumerator.createCapturer(targetCameraName, eventsHandler)
                    ?: throw IllegalStateException("enumerator.createCapturer returned null for $targetCameraName")

                Log.d(TAG, "[WebRTC-Camera] [4/5] Initializing capturer on SurfaceTextureHelper...")
                newCapturer.initialize(sth, context, observer)

                // 6. Start capture
                Log.d(TAG, "[WebRTC-Camera] [5/5] Starting capture at 1280x720 30fps...")
                newCapturer.startCapture(1280, 720, 30)

                // 7. Await verification that physical camera actually started streaming
                Log.d(TAG, "[WebRTC-Camera] Awaiting hardware first frame from '$targetCameraName' (max 4.0s)...")
                withTimeout(4000) {
                    firstFrameSignal.await()
                }

                // Camera verified active! Update state
                videoCapturer = newCapturer
                currentCameraId = targetCameraName
                _isFrontCamera.value = targetIsFront

                Log.d(
                    TAG,
                    "[WebRTC-Camera] === CAMERA SWITCH SUCCEEDED === Active physical camera: '$targetCameraName' ($requestedDirection, isFront=$targetIsFront)"
                )

                // Re-verify local video track and sinks
                localVideoTrack?.let { track ->
                    track.setEnabled(true)
                    for (sink in attachedSinks) {
                        try {
                            track.removeSink(sink)
                            track.addSink(sink)
                        } catch (e: Exception) {
                            Log.w(TAG, "[WebRTC-Camera] Re-attaching sink notice: ${e.message}")
                        }
                    }
                }

                withContext(Dispatchers.Main) {
                    onSuccess?.invoke(targetIsFront)
                }
            } catch (e: Exception) {
                Log.e(TAG, "[WebRTC-Camera] Camera switch FAILED for '$targetCameraName': ${e.message}", e)

                // Safely clean up failed capturer
                try {
                    videoCapturer?.stopCapture()
                } catch (_: Exception) {}
                try {
                    videoCapturer?.dispose()
                } catch (_: Exception) {}
                videoCapturer = null

                // Safely restore previous camera so local preview is never left black
                if (prevCameraId != null) {
                    Log.w(TAG, "[WebRTC-Camera] Safely restoring previous working camera '$prevCameraId'...")
                    try {
                        delay(150)
                        val sth = surfaceTextureHelper ?: SurfaceTextureHelper.create("WebRtcCaptureThread", egl).also { surfaceTextureHelper = it }
                        val observer = localVideoSource?.capturerObserver
                        val enumerator = cameraEnumerator ?: Camera2Enumerator(context)
                        val restoredCapturer = enumerator.createCapturer(prevCameraId, createCameraEventsHandler(prevCameraId))
                        if (restoredCapturer != null && observer != null) {
                            restoredCapturer.initialize(sth, context, observer)
                            restoredCapturer.startCapture(1280, 720, 30)
                            videoCapturer = restoredCapturer
                            currentCameraId = prevCameraId
                            _isFrontCamera.value = prevIsFront
                            Log.d(TAG, "[WebRTC-Camera] Successfully restored previous working camera '$prevCameraId'.")
                        }
                    } catch (re: Exception) {
                        Log.e(TAG, "[WebRTC-Camera] Failed to restore previous camera: ${re.message}", re)
                    }
                }

                withContext(Dispatchers.Main) {
                    onError?.invoke(e.message ?: "Camera switch failed")
                }
            } finally {
                _isSwitchingCamera.value = false
                switchMutex.unlock()
            }
        }
    }

    /**
     * Complete cleanup of all WebRTC media tracks, capturers, audio device module, and peer connection.
     */
    fun close() {
        try {
            cameraScope.cancel()
            videoCapturer?.stopCapture()
            videoCapturer?.dispose()
            videoCapturer = null

            surfaceTextureHelper?.dispose()
            surfaceTextureHelper = null

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
