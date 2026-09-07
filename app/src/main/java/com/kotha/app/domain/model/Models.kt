package com.kotha.app.domain.model

/**
 * Call type for real-time WebRTC communications.
 */
enum class CallType {
    AUDIO,
    VIDEO
}

/**
 * Lifecycle states of an end-to-end WebRTC call session.
 */
enum class CallState {
    IDLE,
    CALLING,
    RINGING,
    CONNECTING,
    CONNECTED,
    ENDED,
    REJECTED,
    FAILED
}

/**
 * Chat message types supported by Kotha.
 */
enum class MessageType {
    TEXT,
    VOICE,
    IMAGE
}

/**
 * Delivery status for chat messages.
 */
enum class MessageStatus {
    SENDING,
    SENT,
    DELIVERED,
    READ
}

/**
 * User profile model.
 */
data class User(
    val userId: String = "",
    val phoneNumber: String = "",
    val fullName: String = "",
    val profilePhotoUrl: String? = null,
    val about: String = "Available on Kotha",
    val isOnline: Boolean = false,
    val lastSeen: Long = System.currentTimeMillis(),
    val fcmToken: String? = null,
    val lowDataMode: Boolean = false,
    val preferredLanguage: String = "bn"
)

/**
 * Chat message model.
 */
data class Message(
    val messageId: String = "",
    val senderId: String = "",
    val receiverId: String = "",
    val text: String? = null,
    val type: MessageType = MessageType.TEXT,
    val mediaUrl: String? = null,
    val mediaDurationMs: Long? = null,
    val timestamp: Long = System.currentTimeMillis(),
    val status: MessageStatus = MessageStatus.SENT
)

/**
 * Chat conversation model.
 */
data class Chat(
    val chatId: String = "",
    val participantIds: List<String> = emptyList(),
    val lastMessage: Message? = null,
    val unreadCount: Int = 0,
    val updatedAt: Long = System.currentTimeMillis()
)

/**
 * WebRTC Session Description Protocol (SDP) Offer/Answer model.
 */
data class SdpModel(
    val type: String = "",
    val sdp: String = ""
) {
    fun toMap(): Map<String, Any> {
        return mapOf(
            "type" to type,
            "sdp" to sdp
        )
    }

    companion object {
        fun fromMap(map: Map<*, *>?): SdpModel? {
            if (map == null) return null
            val type = map["type"] as? String ?: return null
            val sdp = map["sdp"] as? String ?: return null
            return SdpModel(type = type, sdp = sdp)
        }
    }
}

/**
 * WebRTC Interactive Connectivity Establishment (ICE) candidate model.
 */
data class IceCandidateModel(
    val sdpMid: String? = null,
    val sdpMLineIndex: Int = 0,
    val candidate: String = "",
    val timestamp: Long = System.currentTimeMillis()
) {
    fun toMap(): Map<String, Any?> {
        return mapOf(
            "sdpMid" to sdpMid,
            "sdpMLineIndex" to sdpMLineIndex,
            "candidate" to candidate,
            "timestamp" to timestamp
        )
    }

    companion object {
        fun fromMap(map: Map<*, *>?): IceCandidateModel? {
            if (map == null) return null
            val candidate = map["candidate"] as? String ?: return null
            val sdpMid = map["sdpMid"] as? String
            val sdpMLineIndex = (map["sdpMLineIndex"] as? Number)?.toInt() ?: 0
            val timestamp = (map["timestamp"] as? Number)?.toLong() ?: System.currentTimeMillis()
            return IceCandidateModel(
                sdpMid = sdpMid,
                sdpMLineIndex = sdpMLineIndex,
                candidate = candidate,
                timestamp = timestamp
            )
        }
    }
}

/**
 * WebRTC Call Session model representing the Firestore document under 'calls/{callId}'.
 */
data class WebRtcCallSession(
    val callId: String = "",
    val callerId: String = "",
    val callerName: String = "",
    val callerPhoto: String? = null,
    val receiverId: String = "",
    val receiverName: String = "",
    val receiverPhoto: String? = null,
    val callType: CallType = CallType.AUDIO,
    val callState: CallState = CallState.RINGING,
    val startedAt: Long = System.currentTimeMillis(),
    val connectedAt: Long? = null,
    val endedAt: Long? = null,
    val offer: SdpModel? = null,
    val answer: SdpModel? = null,
    val isMuted: Boolean = false,
    val isCameraOff: Boolean = false,
    val isSpeakerOn: Boolean = false,
    val isFrontCamera: Boolean = true,
    val lowDataMode: Boolean = false
) {
    fun toMap(): Map<String, Any?> {
        val map = mutableMapOf<String, Any?>(
            "callId" to callId,
            "callerId" to callerId,
            "callerName" to callerName,
            "callerPhoto" to callerPhoto,
            "receiverId" to receiverId,
            "receiverName" to receiverName,
            "receiverPhoto" to receiverPhoto,
            "callType" to callType.name,
            "callState" to callState.name,
            "startedAt" to startedAt,
            "connectedAt" to connectedAt,
            "endedAt" to endedAt,
            "isMuted" to isMuted,
            "isCameraOff" to isCameraOff,
            "isSpeakerOn" to isSpeakerOn,
            "isFrontCamera" to isFrontCamera,
            "lowDataMode" to lowDataMode
        )
        offer?.let { map["offer"] = it.toMap() }
        answer?.let { map["answer"] = it.toMap() }
        return map
    }

    companion object {
        fun fromMap(data: Map<String, Any?>): WebRtcCallSession {
            val callTypeStr = data["callType"] as? String
            val callType = try {
                if (callTypeStr != null) CallType.valueOf(callTypeStr) else CallType.AUDIO
            } catch (e: Exception) {
                CallType.AUDIO
            }

            val callStateStr = data["callState"] as? String
            val callState = try {
                if (callStateStr != null) CallState.valueOf(callStateStr) else CallState.IDLE
            } catch (e: Exception) {
                CallState.IDLE
            }

            val offerMap = data["offer"] as? Map<*, *>
            val answerMap = data["answer"] as? Map<*, *>

            return WebRtcCallSession(
                callId = data["callId"] as? String ?: "",
                callerId = data["callerId"] as? String ?: "",
                callerName = data["callerName"] as? String ?: "",
                callerPhoto = data["callerPhoto"] as? String,
                receiverId = data["receiverId"] as? String ?: "",
                receiverName = data["receiverName"] as? String ?: "",
                receiverPhoto = data["receiverPhoto"] as? String,
                callType = callType,
                callState = callState,
                startedAt = (data["startedAt"] as? Number)?.toLong() ?: System.currentTimeMillis(),
                connectedAt = (data["connectedAt"] as? Number)?.toLong(),
                endedAt = (data["endedAt"] as? Number)?.toLong(),
                offer = SdpModel.fromMap(offerMap),
                answer = SdpModel.fromMap(answerMap),
                isMuted = data["isMuted"] as? Boolean ?: false,
                isCameraOff = data["isCameraOff"] as? Boolean ?: false,
                isSpeakerOn = data["isSpeakerOn"] as? Boolean ?: false,
                isFrontCamera = data["isFrontCamera"] as? Boolean ?: true,
                lowDataMode = data["lowDataMode"] as? Boolean ?: false
            )
        }
    }
}

/**
 * Historical record of a placed or received call.
 */
data class CallRecord(
    val callId: String = "",
    val peerId: String = "",
    val peerName: String = "",
    val peerPhotoUrl: String? = null,
    val callType: CallType = CallType.AUDIO,
    val isOutgoing: Boolean = true,
    val callState: CallState = CallState.ENDED,
    val durationSeconds: Long = 0L,
    val timestamp: Long = System.currentTimeMillis()
)
