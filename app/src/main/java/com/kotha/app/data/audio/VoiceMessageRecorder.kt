package com.kotha.app.data.audio

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import android.util.Log
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.File
import java.io.IOException
import java.util.UUID

/**
 * Result of a completed voice message recording.
 */
data class VoiceRecordResult(
    val audioFile: File,
    val durationMs: Long
)

/**
 * Production-ready voice message audio recorder using Android MediaRecorder (MPEG-4 / AAC).
 * Provides live duration tracking and amplitude sampling for animated visual feedback.
 */
class VoiceMessageRecorder(private val context: Context) {

    companion object {
        private const val TAG = "VoiceMessageRecorder"
        private const val MAX_RECORDING_DURATION_MS = 120_000L // 2 minutes max
    }

    private var mediaRecorder: MediaRecorder? = null
    private var currentOutputFile: File? = null
    private var recordingStartTime: Long = 0L

    private var durationJob: Job? = null
    private val scope = CoroutineScope(Dispatchers.Main + Job())

    private val _isRecording = MutableStateFlow(false)
    val isRecording: StateFlow<Boolean> = _isRecording.asStateFlow()

    private val _durationMs = MutableStateFlow(0L)
    val durationMs: StateFlow<Long> = _durationMs.asStateFlow()

    private val _amplitude = MutableStateFlow(0)
    val amplitude: StateFlow<Int> = _amplitude.asStateFlow()

    /**
     * Initializes and starts audio recording to a temporary M4A file.
     * Returns true if recording successfully started.
     */
    fun startRecording(): Boolean {
        if (_isRecording.value) {
            Log.w(TAG, "Recording is already active")
            return false
        }

        return try {
            val recordDir = File(context.cacheDir, "voice_messages").apply { mkdirs() }
            val outputFile = File(recordDir, "voice_${System.currentTimeMillis()}_${UUID.randomUUID().toString().take(6)}.m4a")
            currentOutputFile = outputFile

            val recorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                MediaRecorder(context)
            } else {
                @Suppress("DEPRECATION")
                MediaRecorder()
            }

            recorder.apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setAudioEncodingBitRate(64_000)
                setAudioSamplingRate(44_100)
                setOutputFile(outputFile.absolutePath)
                prepare()
                start()
            }

            mediaRecorder = recorder
            recordingStartTime = System.currentTimeMillis()
            _isRecording.value = true
            _durationMs.value = 0L

            // Start duration and amplitude polling loop
            startMonitoringLoop()
            Log.d(TAG, "Voice recording started: ${outputFile.absolutePath}")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start MediaRecorder", e)
            cleanup()
            false
        }
    }

    /**
     * Stops the active recording and returns the recorded file and duration.
     * If recording is shorter than 500ms, the file is discarded.
     */
    fun stopRecording(): VoiceRecordResult? {
        if (!_isRecording.value || mediaRecorder == null) {
            cleanup()
            return null
        }

        val elapsed = System.currentTimeMillis() - recordingStartTime
        val file = currentOutputFile

        try {
            mediaRecorder?.apply {
                stop()
                release()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping MediaRecorder (likely too short)", e)
            file?.delete()
            cleanup()
            return null
        }

        mediaRecorder = null
        _isRecording.value = false
        durationJob?.cancel()

        if (elapsed < 500 || file == null || !file.exists() || file.length() == 0L) {
            Log.d(TAG, "Voice recording too short (${elapsed}ms) or empty, discarded")
            file?.delete()
            currentOutputFile = null
            return null
        }

        Log.d(TAG, "Voice recording finished successfully: ${file.length()} bytes, duration: ${elapsed}ms")
        currentOutputFile = null
        return VoiceRecordResult(file, elapsed)
    }

    /**
     * Cancels the active recording and deletes the temporary audio file.
     */
    fun cancelRecording() {
        if (!_isRecording.value) return

        try {
            mediaRecorder?.apply {
                stop()
                release()
            }
        } catch (e: Exception) {
            Log.d(TAG, "Exception while stopping cancelled recording (safe to ignore)", e)
        }

        currentOutputFile?.delete()
        cleanup()
        Log.d(TAG, "Voice recording cancelled and deleted")
    }

    private fun startMonitoringLoop() {
        durationJob?.cancel()
        durationJob = scope.launch {
            while (_isRecording.value) {
                val elapsed = System.currentTimeMillis() - recordingStartTime
                _durationMs.value = elapsed

                try {
                    val maxAmp = mediaRecorder?.maxAmplitude ?: 0
                    _amplitude.value = maxAmp
                } catch (e: Exception) {
                    _amplitude.value = 0
                }

                if (elapsed >= MAX_RECORDING_DURATION_MS) {
                    Log.d(TAG, "Maximum recording duration reached ($MAX_RECORDING_DURATION_MS ms)")
                    break
                }
                delay(100)
            }
        }
    }

    private fun cleanup() {
        try {
            mediaRecorder?.release()
        } catch (e: Exception) {
            // Ignore
        }
        mediaRecorder = null
        currentOutputFile = null
        _isRecording.value = false
        _durationMs.value = 0L
        _amplitude.value = 0
        durationJob?.cancel()
    }
}
