package com.kotha.app.data.contact

import android.content.Context
import android.database.Cursor
import android.provider.ContactsContract
import android.util.Log
import com.google.i18n.phonenumbers.PhoneNumberUtil
import com.google.i18n.phonenumbers.Phonenumber
import java.util.Locale

/**
 * Model representing a contact imported from the device phonebook.
 */
data class PhoneContact(
    val contactId: String,
    val displayName: String,
    val normalizedPhoneNumber: String,
    val rawPhoneNumber: String,
    val photoUri: String? = null
)

/**
 * Utility responsible for querying Android ContactsContract and safely normalizing phone numbers
 * using libphonenumber into E.164 format.
 */
class PhoneContactReader(private val context: Context) {

    companion object {
        private const val TAG = "PhoneContactReader"
    }

    private val phoneUtil = PhoneNumberUtil.getInstance()

    /**
     * Reads all contacts with phone numbers from the device's ContactsContract provider.
     * Deduplicates multiple occurrences and normalizes phone numbers.
     */
    fun readPhoneContacts(defaultCountryIso: String = "BD"): List<PhoneContact> {
        val contactsList = mutableListOf<PhoneContact>()
        val seenNumbers = mutableSetOf<String>()

        val projection = arrayOf(
            ContactsContract.CommonDataKinds.Phone.CONTACT_ID,
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER,
            ContactsContract.CommonDataKinds.Phone.PHOTO_URI
        )

        val sortOrder = "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} ASC"

        try {
            val cursor: Cursor? = context.contentResolver.query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                projection,
                null,
                null,
                sortOrder
            )

            cursor?.use { c ->
                val idIndex = c.getColumnIndex(ContactsContract.CommonDataKinds.Phone.CONTACT_ID)
                val nameIndex = c.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME)
                val numberIndex = c.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)
                val photoIndex = c.getColumnIndex(ContactsContract.CommonDataKinds.Phone.PHOTO_URI)

                while (c.moveToNext()) {
                    val contactId = if (idIndex != -1) c.getString(idIndex) ?: "" else ""
                    val displayName = if (nameIndex != -1) c.getString(nameIndex) ?: "" else ""
                    val rawNumber = if (numberIndex != -1) c.getString(numberIndex) ?: "" else ""
                    val photoUri = if (photoIndex != -1) c.getString(photoIndex) else null

                    if (rawNumber.isNotBlank() && displayName.isNotBlank()) {
                        val normalized = normalizePhoneNumber(rawNumber, defaultCountryIso)
                        if (normalized != null && !seenNumbers.contains(normalized)) {
                            seenNumbers.add(normalized)
                            contactsList.add(
                                PhoneContact(
                                    contactId = contactId,
                                    displayName = displayName.trim(),
                                    normalizedPhoneNumber = normalized,
                                    rawPhoneNumber = rawNumber.trim(),
                                    photoUri = photoUri
                                )
                            )
                        }
                    }
                }
            }
        } catch (e: SecurityException) {
            Log.e(TAG, "Missing READ_CONTACTS permission", e)
        } catch (e: Exception) {
            Log.e(TAG, "Failed reading contacts from ContactsContract", e)
        }

        Log.d(TAG, "Successfully read ${contactsList.size} unique normalized contacts")
        return contactsList
    }

    /**
     * Normalizes any input phone number (local, national, or international) into strict E.164.
     * Handles Bangladesh local prefixes (e.g. 017..., 018...) as well as international formats (+880...).
     */
    fun normalizePhoneNumber(phoneNumber: String, defaultCountryIso: String = "BD"): String? {
        val trimmed = phoneNumber.trim()
        if (trimmed.isBlank()) return null

        return try {
            val countryCode = defaultCountryIso.uppercase(Locale.ROOT)
            val parsedNumber: Phonenumber.PhoneNumber = phoneUtil.parse(trimmed, countryCode)
            if (phoneUtil.isValidNumber(parsedNumber)) {
                phoneUtil.format(parsedNumber, PhoneNumberUtil.PhoneNumberFormat.E164)
            } else {
                // Fallback: if libphonenumber strict check fails but digits are valid
                val digitsOnly = trimmed.replace("[^0-9+]".toRegex(), "")
                if (digitsOnly.startsWith("+")) {
                    digitsOnly
                } else if (digitsOnly.startsWith("0") && digitsOnly.length == 11 && countryCode == "BD") {
                    "+880${digitsOnly.substring(1)}"
                } else {
                    "+${digitsOnly}"
                }
            }
        } catch (e: Exception) {
            // Simple regex fallback
            val digitsOnly = trimmed.replace("[^0-9+]".toRegex(), "")
            if (digitsOnly.startsWith("+")) {
                digitsOnly
            } else if (digitsOnly.startsWith("0") && digitsOnly.length == 11) {
                "+880${digitsOnly.substring(1)}"
            } else null
        }
    }
}
