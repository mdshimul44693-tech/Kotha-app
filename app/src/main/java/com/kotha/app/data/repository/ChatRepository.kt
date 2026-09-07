package com.kotha.app.data.repository

import android.net.Uri
import android.util.Log
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.Query
import com.google.firebase.storage.FirebaseStorage
import com.kotha.app.domain.model.Message
import com.kotha.app.domain.model.MessageStatus
import com.kotha.app.domain.model.MessageType
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Repository for real-time Firestore chat messaging and Firebase Storage voice audio upload.
 */
class ChatRepository(
    private val firestore: FirebaseFirestore = FirebaseFirestore.getInstance(),
    private val storage: FirebaseStorage = FirebaseStorage.getInstance()
) {

    companion object {
        private const val TAG = "ChatRepository"

        /**
         * Generates a deterministic, symmetric chat ID between two users.
         */
        fun getDeterministicChatId(userA: String, userB: String): String {
            return if (userA <= userB) "chat_${userA}_${userB}" else "chat_${userB}_${userA}"
        }
    }

    /**
     * Uploads a recorded voice message file to Firebase Storage under `voice_messages/{chatId}/`.
     * Returns the public or signed download URL for audio streaming.
     */
    suspend fun uploadVoiceMessage(chatId: String, audioFile: File): Result<String> = withContext(Dispatchers.IO) {
        try {
            val fileName = "voice_${System.currentTimeMillis()}_${audioFile.name}"
            val storageRef = storage.reference.child("voice_messages/$chatId/$fileName")
            val fileUri = Uri.fromFile(audioFile)

            Log.d(TAG, "Uploading voice file (${audioFile.length()} bytes) to Firebase Storage: ${storageRef.path}")
            val uploadTask = storageRef.putFile(fileUri).await()
            val downloadUrl = uploadTask.storage.downloadUrl.await().toString()

            Log.d(TAG, "Voice file uploaded successfully. Download URL: $downloadUrl")
            Result.success(downloadUrl)
        } catch (e: Exception) {
            Log.e(TAG, "Firebase Storage upload failed", e)
            Result.failure(e)
        }
    }

    /**
     * Dispatches a message to Firestore and updates the parent conversation document.
     */
    suspend fun sendMessage(chatId: String, message: Message) = withContext(Dispatchers.IO) {
        try {
            val messageRef = firestore.collection("chats")
                .document(chatId)
                .collection("messages")
                .document(message.messageId)

            val messageMap = hashMapOf(
                "messageId" to message.messageId,
                "senderId" to message.senderId,
                "receiverId" to message.receiverId,
                "text" to message.text,
                "type" to message.type.name,
                "mediaUrl" to message.mediaUrl,
                "mediaDurationMs" to message.mediaDurationMs,
                "timestamp" to message.timestamp,
                "status" to message.status.name
            )

            // Save message
            messageRef.set(messageMap).await()

            // Update parent chat metadata
            val chatDocRef = firestore.collection("chats").document(chatId)
            chatDocRef.set(
                mapOf(
                    "chatId" to chatId,
                    "participantIds" to listOf(message.senderId, message.receiverId),
                    "lastMessage" to messageMap,
                    "updatedAt" to message.timestamp
                ),
                com.google.firebase.firestore.SetOptions.merge()
            ).await()

            Log.d(TAG, "Message ${message.messageId} sent successfully to chat $chatId")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to send message to Firestore", e)
            throw e
        }
    }

    /**
     * Subscribes to real-time incoming and outgoing messages within a chat room.
     */
    fun subscribeToMessages(
        chatId: String,
        onMessagesChanged: (List<Message>) -> Unit
    ): ListenerRegistration {
        return firestore.collection("chats")
            .document(chatId)
            .collection("messages")
            .orderBy("timestamp", Query.Direction.ASCENDING)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    Log.e(TAG, "Messages snapshot listener error for $chatId", error)
                    return@addSnapshotListener
                }

                if (snapshot != null) {
                    val messages = snapshot.documents.mapNotNull { doc ->
                        try {
                            val id = doc.getString("messageId") ?: doc.id
                            val senderId = doc.getString("senderId") ?: ""
                            val receiverId = doc.getString("receiverId") ?: ""
                            val text = doc.getString("text")
                            val typeStr = doc.getString("type") ?: MessageType.TEXT.name
                            val type = try { MessageType.valueOf(typeStr) } catch (e: Exception) { MessageType.TEXT }
                            val mediaUrl = doc.getString("mediaUrl")
                            val mediaDurationMs = doc.getLong("mediaDurationMs")
                            val timestamp = doc.getLong("timestamp") ?: System.currentTimeMillis()
                            val statusStr = doc.getString("status") ?: MessageStatus.SENT.name
                            val status = try { MessageStatus.valueOf(statusStr) } catch (e: Exception) { MessageStatus.SENT }

                            Message(
                                messageId = id,
                                senderId = senderId,
                                receiverId = receiverId,
                                text = text,
                                type = type,
                                mediaUrl = mediaUrl,
                                mediaDurationMs = mediaDurationMs,
                                timestamp = timestamp,
                                status = status
                            )
                        } catch (e: Exception) {
                            Log.e(TAG, "Error deserializing message document: ${doc.id}", e)
                            null
                        }
                    }
                    onMessagesChanged(messages)
                }
            }
    }
}
