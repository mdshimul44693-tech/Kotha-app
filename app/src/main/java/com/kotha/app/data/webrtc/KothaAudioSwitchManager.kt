package com.kotha.app.data.webrtc

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
    private val onAudioDeviceChanged: ((AudioDevice) -> Unit)? = null
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
            selectedDevice = "EARPIECE",
            availableDevices = listOf("EARPIECE", "SPEAKERPHONE"),
            currentAudioMode = "MODE_NORMAL",
            bluetoothState = "STATE_DISCONNECTED",
            audioFocusState = "AUDIOFOCUS_NONE",
            isPlaybackActive = false
        )
    )
    val telemetryState: StateFlow<AudioRoutingTelemetry> = _telemetryState.asStateFlow()

    @Suppress("DEPRECATION")
    private var bluetoothAdapter: BluetoothAdapter? = BluetoothAdapter.getDefaultAdapter()
    private var bluetoothHeadsetProfile: BluetoothHeadset? = null
    private var audioDeviceCallback: AudioDeviceCallback? = null

    private val bluetoothReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                BluetoothHeadset.ACTION_CONNECTION_STATE_CHANGED -> {
                    val state = intent.getIntExtra(BluetoothProfile.EXTRA_STATE, BluetoothProfile.STATE_DISCONNECTED)
                    Log.d(TAG, "Bluetooth Headset State Changed: $state")
                    if (state == BluetoothProfile.STATE_CONNECTED) {
                        selectAudioDevice(AudioDevice.BLUETOOTH_HEADSET)
                    } else if (state == BluetoothProfile.STATE_DISCONNECTED) {
                        selectAudioDevice(AudioDevice.EARPIECE)
                    }
                    updateTelemetry()
                }
                AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED -> {
                    val scoState = intent.getIntExtra(AudioManager.EXTRA_SCO_AUDIO_STATE, AudioManager.SCO_AUDIO_STATE_DISCONNECTED)
                    Log.d(TAG, "Bluetooth SCO Audio State Updated: $scoState")
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
                    Log.d(TAG, "Headset profile connected with ${connectedDevices.size} active device(s)")
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

    /**
     * Activates VoIP call mode: requests AudioFocus, switches mode to MODE_IN_COMMUNICATION,
     * and sets default audio device (Speakerphone for video call, Earpiece for audio call).
     */
    fun start(defaultSpeaker: Boolean = false) {
        previousAudioMode = audioManager.mode
        isSpeakerphoneOnPrev = audioManager.isSpeakerphoneOn
        isBluetoothScoOnPrev = audioManager.isBluetoothScoOn

        requestCallAudioFocus()

        audioManager.mode = AudioManager.MODE_IN_COMMUNICATION

        val filter = IntentFilter().apply {
            addAction(BluetoothHeadset.ACTION_CONNECTION_STATE_CHANGED)
            addAction(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED)
        }
        try {
            context.registerReceiver(bluetoothReceiver, filter)
        } catch (e: Exception) {
            Log.w(TAG, "Could not register Bluetooth broadcast receiver", e)
        }

        bluetoothAdapter?.getProfileProxy(context, profileListener, BluetoothProfile.HEADSET)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            audioDeviceCallback = object : AudioDeviceCallback() {
                override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>?) {
                    updateTelemetry()
                }
                override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>?) {
                    updateTelemetry()
                }
            }
            audioManager.registerAudioDeviceCallback(audioDeviceCallback, null)
        }

        if (defaultSpeaker) {
            selectAudioDevice(AudioDevice.SPEAKERPHONE)
        } else {
            selectAudioDevice(AudioDevice.EARPIECE)
        }

        updateTelemetry()
        Log.d(TAG, "KothaAudioSwitchManager started with mode=MODE_IN_COMMUNICATION")
    }

    /**
     * Switches the active audio device (Earpiece, Speakerphone, or Bluetooth Headset)
     * using Android 12+ setCommunicationDevice API with robust backwards-compatible fallback.
     */
    fun selectAudioDevice(device: AudioDevice) {
        Log.d(TAG, "Switching audio device to: $device")

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val commDevices = audioManager.availableCommunicationDevices
            val targetType = when (device) {
                AudioDevice.SPEAKERPHONE -> AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
                AudioDevice.EARPIECE -> AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
                AudioDevice.BLUETOOTH_HEADSET -> AudioDeviceInfo.TYPE_BLUETOOTH_SCO
            }

            val matchingDevice = commDevices.firstOrNull { it.type == targetType }
                ?: if (device == AudioDevice.BLUETOOTH_HEADSET) {
                    commDevices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BLE_HEADSET || it.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP }
                } else null

            if (matchingDevice != null) {
                val success = audioManager.setCommunicationDevice(matchingDevice)
                Log.d(TAG, "API 31+ setCommunicationDevice($targetType) result: $success")
            } else {
                Log.w(TAG, "No matching CommunicationDevice for type $targetType, using fallback")
                applyLegacyRouting(device)
            }
        } else {
            applyLegacyRouting(device)
        }

        _selectedAudioDevice.value = device
        onAudioDeviceChanged?.invoke(device)
        updateTelemetry()
    }

    @Suppress("DEPRECATION")
    private fun applyLegacyRouting(device: AudioDevice) {
        when (device) {
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
            AudioDevice.BLUETOOTH_HEADSET -> {
                audioManager.isSpeakerphoneOn = false
                audioManager.startBluetoothSco()
                audioManager.isBluetoothScoOn = true
            }
        }
    }

    private fun requestCallAudioFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val playbackAttributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build()

            audioFocusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
                .setAudioAttributes(playbackAttributes)
                .setAcceptsDelayedFocusGain(false)
                .setOnAudioFocusChangeListener { focusChange ->
                    Log.d(TAG, "AudioFocus change: $focusChange")
                    updateTelemetry()
                }
                .build()

            audioFocusRequest?.let { audioManager.requestAudioFocus(it) }
        } else {
            @Suppress("DEPRECATION")
            audioManager.requestAudioFocus(
                { focusChange -> Log.d(TAG, "Legacy AudioFocus change: $focusChange") },
                AudioManager.STREAM_VOICE_CALL,
                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
            )
        }
    }

    private fun abandonCallAudioFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            audioFocusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
            audioFocusRequest = null
        } else {
            @Suppress("DEPRECATION")
            audioManager.abandonAudioFocus(null)
        }
    }

    /**
     * Stops audio routing and restores previous audio settings upon call completion.
     */
    fun stop() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                audioManager.clearCommunicationDevice()
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && audioDeviceCallback != null) {
                audioManager.unregisterAudioDeviceCallback(audioDeviceCallback)
            }
            context.unregisterReceiver(bluetoothReceiver)
            bluetoothHeadsetProfile?.let {
                bluetoothAdapter?.closeProfileProxy(BluetoothProfile.HEADSET, it)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Cleanup exception (expected on unregister)", e)
        }

        abandonCallAudioFocus()

        @Suppress("DEPRECATION")
        if (audioManager.isBluetoothScoOn) {
            audioManager.stopBluetoothSco()
            audioManager.isBluetoothScoOn = false
        }
        audioManager.isSpeakerphoneOn = isSpeakerphoneOnPrev
        audioManager.mode = previousAudioMode

        Log.d(TAG, "KothaAudioSwitchManager stopped. Restored audio mode=$previousAudioMode")
    }

    private fun updateTelemetry() {
        val devList = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            audioManager.availableCommunicationDevices.forEach {
                devList.add(it.productName.toString() + " (" + it.type + ")")
            }
        } else {
            devList.add("Builtin Earpiece")
            devList.add("Builtin Speakerphone")
            if (bluetoothHeadsetProfile?.connectedDevices?.isNotEmpty() == true) {
                devList.add("Bluetooth Headset")
            }
        }

        _telemetryState.value = AudioRoutingTelemetry(
            selectedDevice = _selectedAudioDevice.value.name,
            availableDevices = devList,
            currentAudioMode = when (audioManager.mode) {
                AudioManager.MODE_IN_COMMUNICATION -> "MODE_IN_COMMUNICATION"
                AudioManager.MODE_IN_CALL -> "MODE_IN_CALL"
                AudioManager.MODE_RINGTONE -> "MODE_RINGTONE"
                else -> "MODE_NORMAL"
            },
            bluetoothState = if (bluetoothHeadsetProfile?.connectedDevices?.isNotEmpty() == true) "CONNECTED" else "DISCONNECTED",
            audioFocusState = "AUDIOFOCUS_GAIN",
            isPlaybackActive = true
        )
    }
}
