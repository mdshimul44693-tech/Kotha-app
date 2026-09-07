package com.kotha.app.data.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import android.util.Log
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Playback state for voice messages.
 */
data class VoicePlaybackState(
    val currentAudioUrl: String? = null,
    val isPlaying: Boolean = false,
    val currentPositionMs: Long = 0L,
    val totalDurationMs: Long = 0L
)

/**
 * MediaPlayer-based audio player for voice messages in chats.
 * Supports play/pause, seek, duration tracking, and clean resource disposal.
 */
class VoiceMessagePlayer(private val context: Context) {

    companion object {
        private const val TAG = "VoiceMessagePlayer"
    }

    private var mediaPlayer: MediaPlayer? = null
    private var progressJob: Job? = null
    private val scope = CoroutineScope(Dispatchers.Main + Job())

    private val _playbackState = MutableStateFlow(VoicePlaybackState())
    val playbackState: StateFlow<VoicePlaybackState> = _playbackState.asStateFlow()

    /**
     * Plays the audio from the given URL or local file path.
     * If the specified audio is already playing, toggles pause/resume.
     */
    fun play(audioUrl: String, durationHintMs: Long? = null) {
        val currentState = _playbackState.value

        // If clicking the same currently playing audio
        if (currentState.currentAudioUrl == audioUrl && mediaPlayer != null) {
            if (currentState.isPlaying) {
                pause()
            } else {
                resume()
            }
            return
        }

        // Switching to a new audio track
        stop()

        try {
            val player = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .build()
                )

                if (audioUrl.startsWith("http://") || audioUrl.startsWith("https://") || audioUrl.startsWith("content://")) {
                    setDataSource(context, Uri.parse(audioUrl))
                } else {
                    setDataSource(audioUrl)
                }

                setOnPreparedListener { mp ->
                    mp.start()
                    val totalDuration = if (mp.duration > 0) mp.duration.toLong() else (durationHintMs ?: 0L)
                    _playbackState.value = VoicePlaybackState(
                        currentAudioUrl = audioUrl,
                        isPlaying = true,
                        currentPositionMs = 0L,
                        totalDurationMs = totalDuration
                    )
                    startProgressTracking()
                }

                setOnCompletionListener {
                    _playbackState.value = _playbackState.value.copy(
                        isPlaying = false,
                        currentPositionMs = 0L
                    )
                    progressJob?.cancel()
                }

                setOnErrorListener { _, what, extra ->
                    Log.e(TAG, "MediaPlayer error: what=$what extra=$extra")
                    stop()
                    true
                }

                prepareAsync()
            }

            mediaPlayer = player
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start audio playback for $audioUrl", e)
            stop()
        }
    }

    fun pause() {
        try {
            mediaPlayer?.let {
                if (it.isPlaying) {
                    it.pause()
                    _playbackState.value = _playbackState.value.copy(isPlaying = false)
                    progressJob?.cancel()
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error pausing MediaPlayer", e)
        }
    }

    fun resume() {
        try {
            mediaPlayer?.let {
                it.start()
                _playbackState.value = _playbackState.value.copy(isPlaying = true)
                startProgressTracking()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error resuming MediaPlayer", e)
        }
    }

    fun seekTo(positionMs: Long) {
        try {
            mediaPlayer?.seekTo(positionMs.toInt())
            _playbackState.value = _playbackState.value.copy(currentPositionMs = positionMs)
        } catch (e: Exception) {
            Log.e(TAG, "Error seeking MediaPlayer", e)
        }
    }

    fun stop() {
        progressJob?.cancel()
        try {
            mediaPlayer?.apply {
                if (isPlaying) stop()
                reset()
                release()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping MediaPlayer", e)
        }
        mediaPlayer = null
        _playbackState.value = VoicePlaybackState()
    }

    fun release() {
        stop()
        scope.cancel()
    }

    private fun startProgressTracking() {
        progressJob?.cancel()
        progressJob = scope.launch {
            while (isActive && _playbackState.value.isPlaying) {
                try {
                    mediaPlayer?.let { mp ->
                        if (mp.isPlaying) {
                            val currentPos = mp.currentPosition.toLong()
                            val totalDur = if (mp.duration > 0) mp.duration.toLong() else _playbackState.value.totalDurationMs
                            _playbackState.value = _playbackState.value.copy(
                                currentPositionMs = currentPos,
                                totalDurationMs = totalDur
                            )
                        }
                    }
                } catch (e: Exception) {
                    // Safe ignore
                }
                delay(100)
            }
        }
    }
}
