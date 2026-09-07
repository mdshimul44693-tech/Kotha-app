package com.kotha.app.data.repository

import android.util.Log
import com.google.firebase.firestore.DocumentChange
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.SetOptions
import com.kotha.app.domain.model.CallState
import com.kotha.app.domain.model.IceCandidateModel
import com.kotha.app.domain.model.SdpModel
import com.kotha.app.domain.model.WebRtcCallSession
import kotlinx.coroutines.tasks.await
import org.webrtc.IceCandidate

/**
 * Production Firebase Firestore WebRTC Signaling Client for Kotha 1-to-1 Voice and Video Calling.
 * Manages call document sessions under 'calls/{callId}', along with subcollections
 * 'calls/{callId}/callerCandidates' and 'calls/{callId}/receiverCandidates'.
 *
 * Implements real-time SDP Offer/Answer synchronization, ICE Candidate exchange,
 * and authoritative connectedAt/endedAt epoch timestamp tracking for call durations.
 */
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
    private val registeredListeners = mutableListOf<ListenerRegistration>()

    /**
     * Creates or initializes the call document in 'calls/{callId}' with full session metadata.
     * Uses SetOptions.merge() to ensure seamless updates.
     */
    suspend fun createCallSession(session: WebRtcCallSession) {
        try {
            val data = session.toMap().filterValues { it != null }
            firestore.collection(COLLECTION_CALLS)
                .document(session.callId)
                .set(data, SetOptions.merge())
                .await()
            Log.d(TAG, "Call session document created: ${session.callId}")
        } catch (e: Exception) {
            Log.e(TAG, "Error creating call session: ${session.callId}", e)
            throw e
        }
    }

    /**
     * Uploads the SDP Offer model to 'calls/{callId}' and updates callState to RINGING.
     */
    suspend fun sendOffer(callId: String, offer: SdpModel) {
        try {
            val data = hashMapOf<String, Any>(
                "offer" to offer.toMap(),
                "callState" to CallState.RINGING.name
            )
            firestore.collection(COLLECTION_CALLS)
                .document(callId)
                .set(data, SetOptions.merge())
                .await()
            Log.d(TAG, "SDP Offer uploaded for call: $callId")
        } catch (e: Exception) {
            Log.e(TAG, "Error uploading SDP Offer for call: $callId", e)
            throw e
        }
    }

    /**
     * Uploads the SDP Answer model to 'calls/{callId}' and updates callState to CONNECTING.
     */
    suspend fun sendAnswer(callId: String, answer: SdpModel) {
        try {
            val data = hashMapOf<String, Any>(
                "answer" to answer.toMap(),
                "callState" to CallState.CONNECTING.name
            )
            firestore.collection(COLLECTION_CALLS)
                .document(callId)
                .set(data, SetOptions.merge())
                .await()
            Log.d(TAG, "SDP Answer uploaded for call: $callId")
        } catch (e: Exception) {
            Log.e(TAG, "Error uploading SDP Answer for call: $callId", e)
            throw e
        }
    }

    /**
     * Updates call state in 'calls/{callId}'.
     * When state is CONNECTED, sets the authoritative connectedAt timestamp.
     * When state is ENDED, REJECTED, or FAILED, sets the endedAt timestamp.
     */
    suspend fun updateCallState(callId: String, state: CallState, connectedAt: Long? = null) {
        try {
            val data = mutableMapOf<String, Any>(
                "callState" to state.name
            )
            if (state == CallState.CONNECTED) {
                data["connectedAt"] = connectedAt ?: System.currentTimeMillis()
            } else if (state == CallState.ENDED || state == CallState.REJECTED || state == CallState.FAILED) {
                data["endedAt"] = System.currentTimeMillis()
            }

            firestore.collection(COLLECTION_CALLS)
                .document(callId)
                .set(data, SetOptions.merge())
                .await()
            Log.d(TAG, "Call state updated in Firestore: $callId -> $state")
        } catch (e: Exception) {
            Log.e(TAG, "Error updating call state for $callId to $state", e)
            throw e
        }
    }

    /**
     * Adds an ICE candidate model for caller in 'calls/{callId}/callerCandidates'.
     */
    suspend fun sendCallerCandidate(callId: String, candidate: IceCandidateModel) {
        try {
            firestore.collection(COLLECTION_CALLS)
                .document(callId)
                .collection(COLLECTION_CALLER_CANDIDATES)
                .add(candidate.toMap().filterValues { it != null })
                .await()
            Log.d(TAG, "Caller ICE candidate model saved to Firestore for call: $callId")
        } catch (e: Exception) {
            Log.e(TAG, "Error saving caller candidate for call: $callId", e)
            throw e
        }
    }

    /**
     * Overload: Adds an org.webrtc.IceCandidate for caller in 'calls/{callId}/callerCandidates'.
     */
    suspend fun sendCallerCandidate(callId: String, candidate: IceCandidate) {
        val model = IceCandidateModel(
            sdpMid = candidate.sdpMid,
            sdpMLineIndex = candidate.sdpMLineIndex,
            candidate = candidate.sdp,
            timestamp = System.currentTimeMillis()
        )
        sendCallerCandidate(callId, model)
    }

    /**
     * Adds an ICE candidate model for receiver in 'calls/{callId}/receiverCandidates'.
     */
    suspend fun sendReceiverCandidate(callId: String, candidate: IceCandidateModel) {
        try {
            firestore.collection(COLLECTION_CALLS)
                .document(callId)
                .collection(COLLECTION_RECEIVER_CANDIDATES)
                .add(candidate.toMap().filterValues { it != null })
                .await()
            Log.d(TAG, "Receiver ICE candidate model saved to Firestore for call: $callId")
        } catch (e: Exception) {
            Log.e(TAG, "Error saving receiver candidate for call: $callId", e)
            throw e
        }
    }

    /**
     * Overload: Adds an org.webrtc.IceCandidate for receiver in 'calls/{callId}/receiverCandidates'.
     */
    suspend fun sendReceiverCandidate(callId: String, candidate: IceCandidate) {
        val model = IceCandidateModel(
            sdpMid = candidate.sdpMid,
            sdpMLineIndex = candidate.sdpMLineIndex,
            candidate = candidate.sdp,
            timestamp = System.currentTimeMillis()
        )
        sendReceiverCandidate(callId, model)
    }

    /**
     * Subscribes to changes in 'calls/{callId}' document.
     * Invokes onSessionUpdated callback with raw Map data for backwards compatibility.
     */
    fun subscribeToCallSession(
        callId: String,
        onSessionUpdated: (Map<String, Any>) -> Unit
    ) {
        sessionListener?.remove()
        sessionListener = firestore.collection(COLLECTION_CALLS)
            .document(callId)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    Log.e(TAG, "Call session listener error for call: $callId", error)
                    return@addSnapshotListener
                }
                if (snapshot != null && snapshot.exists()) {
                    val data = snapshot.data ?: return@addSnapshotListener
                    onSessionUpdated(data)
                }
            }
        sessionListener?.let {
            synchronized(registeredListeners) { registeredListeners.add(it) }
        }
    }

    /**
     * Subscribes to changes in 'calls/{callId}' document and emits typed WebRtcCallSession model.
     */
    fun subscribeToCallSessionModel(
        callId: String,
        onSessionUpdated: (WebRtcCallSession) -> Unit
    ) {
        subscribeToCallSession(callId) { data ->
            val session = WebRtcCallSession.fromMap(data)
            onSessionUpdated(session)
        }
    }

    /**
     * Subscribes to remote ICE candidates from the peer.
     * If isCaller is true, listens to 'receiverCandidates'.
     * If isCaller is false, listens to 'callerCandidates'.
     */
    fun subscribeToRemoteCandidates(
        callId: String,
        isCaller: Boolean,
        onCandidateReceived: (IceCandidate) -> Unit
    ) {
        candidateListener?.remove()
        val subCollection = if (isCaller) COLLECTION_RECEIVER_CANDIDATES else COLLECTION_CALLER_CANDIDATES

        candidateListener = firestore.collection(COLLECTION_CALLS)
            .document(callId)
            .collection(subCollection)
            .addSnapshotListener { snapshots, error ->
                if (error != null) {
                    Log.e(TAG, "Remote candidates listener error for call: $callId", error)
                    return@addSnapshotListener
                }
                snapshots?.documentChanges?.forEach { change ->
                    if (change.type == DocumentChange.Type.ADDED) {
                        val data = change.document.data
                        val candidateModel = IceCandidateModel.fromMap(data)
                        if (candidateModel != null && candidateModel.candidate.isNotEmpty()) {
                            val candidate = IceCandidate(
                                candidateModel.sdpMid,
                                candidateModel.sdpMLineIndex,
                                candidateModel.candidate
                            )
                            onCandidateReceived(candidate)
                        }
                    }
                }
            }
        candidateListener?.let {
            synchronized(registeredListeners) { registeredListeners.add(it) }
        }
    }

    /**
     * Subscribes to remote ICE candidates and emits typed IceCandidateModel.
     */
    fun subscribeToRemoteCandidateModels(
        callId: String,
        isCaller: Boolean,
        onCandidateReceived: (IceCandidateModel) -> Unit
    ) {
        val subCollection = if (isCaller) COLLECTION_RECEIVER_CANDIDATES else COLLECTION_CALLER_CANDIDATES
        val listener = firestore.collection(COLLECTION_CALLS)
            .document(callId)
            .collection(subCollection)
            .addSnapshotListener { snapshots, error ->
                if (error != null) {
                    Log.e(TAG, "Remote candidate models listener error for call: $callId", error)
                    return@addSnapshotListener
                }
                snapshots?.documentChanges?.forEach { change ->
                    if (change.type == DocumentChange.Type.ADDED) {
                        val candidateModel = IceCandidateModel.fromMap(change.document.data)
                        if (candidateModel != null) {
                            onCandidateReceived(candidateModel)
                        }
                    }
                }
            }
        synchronized(registeredListeners) { registeredListeners.add(listener) }
    }

    /**
     * One-time fetch of a call session by callId.
     */
    suspend fun getCallSession(callId: String): WebRtcCallSession? {
        return try {
            val snapshot = firestore.collection(COLLECTION_CALLS)
                .document(callId)
                .get()
                .await()
            if (snapshot.exists() && snapshot.data != null) {
                WebRtcCallSession.fromMap(snapshot.data!!)
            } else {
                null
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to fetch call session: $callId", e)
            null
        }
    }

    /**
     * Subscribes to incoming calls where receiverId matches the current user and state is RINGING.
     */
    fun subscribeToIncomingCalls(
        receiverId: String,
        onIncomingCall: (WebRtcCallSession) -> Unit
    ): ListenerRegistration {
        val listener = firestore.collection(COLLECTION_CALLS)
            .whereEqualTo("receiverId", receiverId)
            .whereEqualTo("callState", CallState.RINGING.name)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    Log.e(TAG, "Incoming calls listener error", error)
                    return@addSnapshotListener
                }
                snapshot?.documentChanges?.forEach { change ->
                    if (change.type == DocumentChange.Type.ADDED) {
                        val data = change.document.data
                        val session = WebRtcCallSession.fromMap(data)
                        onIncomingCall(session)
                    }
                }
            }
        synchronized(registeredListeners) { registeredListeners.add(listener) }
        return listener
    }

    /**
     * Updates microphone mute status in Firestore for the given callId.
     */
    suspend fun updateAudioMuteStatus(callId: String, isMuted: Boolean) {
        try {
            firestore.collection(COLLECTION_CALLS)
                .document(callId)
                .set(mapOf("isMuted" to isMuted), SetOptions.merge())
                .await()
            Log.d(TAG, "Call $callId isMuted updated to $isMuted")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to update isMuted for call: $callId", e)
        }
    }

    /**
     * Updates video camera status in Firestore for the given callId.
     */
    suspend fun updateCameraStatus(callId: String, isCameraOff: Boolean) {
        try {
            firestore.collection(COLLECTION_CALLS)
                .document(callId)
                .set(mapOf("isCameraOff" to isCameraOff), SetOptions.merge())
                .await()
            Log.d(TAG, "Call $callId isCameraOff updated to $isCameraOff")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to update isCameraOff for call: $callId", e)
        }
    }

    /**
     * Updates front/back camera facing in Firestore for the given callId.
     */
    suspend fun updateCameraFacing(callId: String, isFrontCamera: Boolean) {
        try {
            firestore.collection(COLLECTION_CALLS)
                .document(callId)
                .set(mapOf("isFrontCamera" to isFrontCamera), SetOptions.merge())
                .await()
            Log.d(TAG, "Call $callId isFrontCamera updated to $isFrontCamera")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to update isFrontCamera for call: $callId", e)
        }
    }

    /**
     * Updates speakerphone status in Firestore for the given callId.
     */
    suspend fun updateSpeakerStatus(callId: String, isSpeakerOn: Boolean) {
        try {
            firestore.collection(COLLECTION_CALLS)
                .document(callId)
                .set(mapOf("isSpeakerOn" to isSpeakerOn), SetOptions.merge())
                .await()
            Log.d(TAG, "Call $callId isSpeakerOn updated to $isSpeakerOn")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to update isSpeakerOn for call: $callId", e)
        }
    }

    /**
     * Marks the call as ended or rejected and updates endedAt timestamp.
     */
    suspend fun endCall(callId: String, state: CallState = CallState.ENDED) {
        updateCallState(callId, state)
    }

    /**
     * Removes all real-time Firestore listeners and cleans up resources.
     */
    fun cleanup() {
        sessionListener?.remove()
        sessionListener = null
        candidateListener?.remove()
        candidateListener = null
        synchronized(registeredListeners) {
            registeredListeners.forEach { it.remove() }
            registeredListeners.clear()
        }
        Log.d(TAG, "FirestoreSignalingClient listeners cleaned up.")
    }
}
