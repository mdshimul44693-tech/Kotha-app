package com.kotha.app

import android.content.Context
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.DocumentChange
import com.google.firebase.firestore.FirebaseFirestore
import com.kotha.app.data.repository.FirestoreSignalingClient
import com.kotha.app.domain.model.CallState
import com.kotha.app.domain.model.CallType
import com.kotha.app.domain.model.User
import com.kotha.app.domain.model.WebRtcCallSession
import com.kotha.app.ui.call.VideoCallScreen
import com.kotha.app.ui.call.VoiceCallScreen
import com.kotha.app.ui.chat.ChatScreen
import com.kotha.app.ui.main.MainScreen
import com.kotha.app.util.LocaleHelper
import kotlinx.coroutines.launch
import org.webrtc.EglBase

/**
 * Main Activity for Kotha Android.
 * Manages Firebase Authentication state, real-time Firestore incoming call detection,
 * session negotiation via FirestoreSignalingClient, and switches between MainScreen,
 * ChatScreen, VoiceCallScreen, and VideoCallScreen.
 */
class MainActivity : ComponentActivity() {

    companion object {
        private const val TAG = "KothaMainActivity"
    }

    private val eglBase: EglBase by lazy { EglBase.create() }
    private val signalingClient by lazy { FirestoreSignalingClient() }

    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(LocaleHelper.applyLocale(newBase))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Ensure Firebase Authentication has an active session
        val auth = FirebaseAuth.getInstance()
        if (auth.currentUser == null) {
            auth.signInAnonymously()
                .addOnSuccessListener { result ->
                    Log.d(TAG, "Firebase Auth anonymous sign-in success: ${result.user?.uid}")
                }
                .addOnFailureListener { e ->
                    Log.e(TAG, "Firebase Auth sign-in failed", e)
                }
        }

        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    val coroutineScope = rememberCoroutineScope()

                    var currentUser by remember { mutableStateOf(auth.currentUser) }
                    var activeCallSession by remember { mutableStateOf<WebRtcCallSession?>(null) }
                    var activeChatUser by remember { mutableStateOf<User?>(null) }
                    var isCaller by remember { mutableStateOf(true) }

                    // Observe Firebase Auth state
                    DisposableEffect(auth) {
                        val authListener = FirebaseAuth.AuthStateListener { fbAuth ->
                            currentUser = fbAuth.currentUser
                        }
                        auth.addAuthStateListener(authListener)
                        onDispose {
                            auth.removeAuthStateListener(authListener)
                        }
                    }

                    // Authoritative Firebase UID and name
                    val currentUserId = currentUser?.uid ?: auth.currentUser?.uid ?: ""
                    val currentUserName = currentUser?.displayName?.takeIf { it.isNotBlank() }
                        ?: currentUser?.phoneNumber?.takeIf { it.isNotBlank() }
                        ?: if (currentUserId.isNotBlank()) "User ${currentUserId.take(5)}" else "You"

                    val currentUserModel = remember(currentUserId, currentUserName) {
                        User(
                            userId = currentUserId,
                            phoneNumber = currentUser?.phoneNumber ?: "",
                            fullName = currentUserName,
                            isOnline = true
                        )
                    }

                    // Real-time Incoming Call Listener for receiver devices
                    DisposableEffect(currentUserId, activeCallSession) {
                        if (currentUserId.isBlank() || activeCallSession != null) {
                            return@DisposableEffect onDispose {}
                        }

                        Log.d(TAG, "Registering incoming call listener for receiverId: $currentUserId")

                        // 1. Primary listener: calls directed to current user's actual UID
                        val primaryListener = signalingClient.subscribeToIncomingCalls(currentUserId) { session ->
                            Log.d(TAG, "Incoming call received for actual UID: ${session.callId} (${session.callType})")
                            if (activeCallSession == null && session.callState == CallState.RINGING) {
                                isCaller = false
                                activeCallSession = session
                            }
                        }

                        // 2. Secondary listener: for demo / sample contact testing between two devices
                        val sampleContactIds = listOf("user_b", "user_c", "user_d")
                        val secondaryListener = FirebaseFirestore.getInstance()
                            .collection("calls")
                            .whereEqualTo("callState", CallState.RINGING.name)
                            .addSnapshotListener { snapshot, error ->
                                if (error != null) {
                                    Log.e(TAG, "Secondary incoming call listener error", error)
                                    return@addSnapshotListener
                                }
                                snapshot?.documentChanges?.forEach { change ->
                                    if (change.type == DocumentChange.Type.ADDED || change.type == DocumentChange.Type.MODIFIED) {
                                        val data = change.document.data
                                        val session = WebRtcCallSession.fromMap(data)
                                        val isTargetedToSample = session.receiverId in sampleContactIds
                                        val isNotOwnCall = session.callerId != currentUserId
                                        val isRecent = (System.currentTimeMillis() - session.startedAt) < 60_000

                                        if (activeCallSession == null && isNotOwnCall && isTargetedToSample && isRecent) {
                                            Log.d(TAG, "Incoming demo call detected for sample contact: ${session.callId}")
                                            isCaller = false
                                            activeCallSession = session
                                        }
                                    }
                                }
                            }

                        onDispose {
                            Log.d(TAG, "Cleaning up incoming call listeners")
                            primaryListener.remove()
                            secondaryListener.remove()
                        }
                    }

                    // Navigation routing based on active session / chat state
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
                                session = session,
                                isCaller = isCaller,
                                eglBaseContext = eglBase.eglBaseContext,
                                onCallEnded = {
                                    activeCallSession = null
                                }
                            )
                        }
                    } else if (activeChatUser != null) {
                        ChatScreen(
                            currentUserId = currentUserId,
                            targetUser = activeChatUser!!,
                            onBack = { activeChatUser = null },
                            onStartCall = { targetUser, callType ->
                                val effectiveCallerId = currentUserId.ifBlank { "user_${System.currentTimeMillis()}" }
                                val effectiveCallerName = currentUserName
                                val callId = "call_${System.currentTimeMillis()}_${effectiveCallerId.take(6)}"

                                val newSession = WebRtcCallSession(
                                    callId = callId,
                                    callerId = effectiveCallerId,
                                    callerName = effectiveCallerName,
                                    receiverId = targetUser.userId,
                                    receiverName = targetUser.fullName,
                                    callType = callType,
                                    callState = CallState.CALLING,
                                    startedAt = System.currentTimeMillis()
                                )

                                coroutineScope.launch {
                                    try {
                                        signalingClient.createCallSession(newSession)
                                    } catch (e: Exception) {
                                        Log.e(TAG, "Error creating call session in Firestore", e)
                                    }
                                }

                                isCaller = true
                                activeCallSession = newSession
                            }
                        )
                    } else {
                        // Main App UI / Contact List & Settings
                        MainScreen(
                            currentUser = currentUserModel,
                            onStartCall = { targetUser, callType ->
                                val effectiveCallerId = currentUserId.ifBlank { "user_${System.currentTimeMillis()}" }
                                val effectiveCallerName = currentUserName
                                val callId = "call_${System.currentTimeMillis()}_${effectiveCallerId.take(6)}"

                                val newSession = WebRtcCallSession(
                                    callId = callId,
                                    callerId = effectiveCallerId,
                                    callerName = effectiveCallerName,
                                    receiverId = targetUser.userId,
                                    receiverName = targetUser.fullName,
                                    callType = callType,
                                    callState = CallState.CALLING,
                                    startedAt = System.currentTimeMillis()
                                )

                                coroutineScope.launch {
                                    try {
                                        Log.d(TAG, "Creating outgoing call session in Firestore: $callId")
                                        signalingClient.createCallSession(newSession)
                                    } catch (e: Exception) {
                                        Log.e(TAG, "Error creating call session in Firestore", e)
                                    }
                                }

                                isCaller = true
                                activeCallSession = newSession
                            },
                            onOpenChat = { targetUser ->
                                activeChatUser = targetUser
                            },
                            onLanguageChanged = { _ ->
                                recreate()
                            }
                        )
                    }
                }
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        signalingClient.cleanup()
        eglBase.release()
    }
}
