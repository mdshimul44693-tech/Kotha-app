package com.kotha.app.data.contact

import android.content.Context
import android.util.Log
import com.google.firebase.firestore.FirebaseFirestore
import com.kotha.app.domain.model.User
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext

/**
 * Result of syncing contacts against Firestore registered users.
 */
data class ContactSyncResult(
    val kothaUsers: List<User>,
    val inviteContacts: List<PhoneContact>
)

/**
 * Repository responsible for synchronizing local phonebook contacts with Firestore registered users.
 */
class ContactRepository(
    private val context: Context,
    private val firestore: FirebaseFirestore = FirebaseFirestore.getInstance()
) {

    companion object {
        private const val TAG = "ContactRepository"
    }

    private val contactReader = PhoneContactReader(context)

    /**
     * Registers or updates the current user's profile in Firestore `/users/{uid}`.
     * Ensures other users can match and discover this user via their phone number.
     */
    suspend fun registerOrUpdateUserProfile(user: User) = withContext(Dispatchers.IO) {
        try {
            if (user.userId.isNotBlank()) {
                val data = hashMapOf(
                    "userId" to user.userId,
                    "phoneNumber" to user.phoneNumber,
                    "fullName" to user.fullName,
                    "profilePhotoUrl" to user.profilePhotoUrl,
                    "about" to user.about,
                    "isOnline" to true,
                    "lastSeen" to System.currentTimeMillis(),
                    "preferredLanguage" to user.preferredLanguage,
                    "lowDataMode" to user.lowDataMode
                )
                firestore.collection("users")
                    .document(user.userId)
                    .set(data)
                    .await()
                Log.d(TAG, "User profile synchronized in Firestore for ${user.userId}")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to register user profile in Firestore", e)
        }
    }

    /**
     * Reads phone contacts from ContactsContract, normalizes them, and queries Firestore `/users`
     * to separate them into registered Kotha users and unregistered contacts to invite.
     */
    suspend fun syncContacts(currentUserId: String): ContactSyncResult = withContext(Dispatchers.IO) {
        try {
            // 1. Read real phonebook contacts
            val localContacts = contactReader.readPhoneContacts()

            if (localContacts.isEmpty()) {
                Log.d(TAG, "No local contacts found or READ_CONTACTS permission not granted yet")
                // Return fallback empty result
                return@withContext ContactSyncResult(emptyList(), emptyList())
            }

            val phoneToContactMap = localContacts.associateBy { it.normalizedPhoneNumber }

            // 2. Fetch all registered users from Firestore
            val usersSnapshot = firestore.collection("users").get().await()
            val registeredUsers = mutableListOf<User>()
            val matchedPhoneNumbers = mutableSetOf<String>()

            for (doc in usersSnapshot.documents) {
                val registeredUserId = doc.getString("userId") ?: doc.id
                // Skip the current logged-in user
                if (registeredUserId == currentUserId) continue

                val phoneNumber = doc.getString("phoneNumber") ?: ""
                val fullName = doc.getString("fullName") ?: "Kotha User"
                val profilePhotoUrl = doc.getString("profilePhotoUrl")
                val about = doc.getString("about") ?: "Available on Kotha"
                val isOnline = doc.getBoolean("isOnline") ?: false
                val lastSeen = doc.getLong("lastSeen") ?: System.currentTimeMillis()

                // Check if this registered user exists in our local phone contacts
                val matchedContact = phoneToContactMap[phoneNumber]
                if (matchedContact != null) {
                    matchedPhoneNumbers.add(phoneNumber)
                    registeredUsers.add(
                        User(
                            userId = registeredUserId,
                            phoneNumber = phoneNumber,
                            fullName = matchedContact.displayName.ifBlank { fullName },
                            profilePhotoUrl = profilePhotoUrl ?: matchedContact.photoUri,
                            about = about,
                            isOnline = isOnline,
                            lastSeen = lastSeen
                        )
                    )
                }
            }

            // 3. Unmatched local contacts become invite candidates
            val inviteContacts = localContacts.filter { !matchedPhoneNumbers.contains(it.normalizedPhoneNumber) }

            Log.d(TAG, "Sync complete: found ${registeredUsers.size} Kotha users and ${inviteContacts.size} invite contacts")
            return@withContext ContactSyncResult(registeredUsers, inviteContacts)
        } catch (e: Exception) {
            Log.e(TAG, "Error syncing contacts with Firestore", e)
            return@withContext ContactSyncResult(emptyList(), emptyList())
        }
    }
}
