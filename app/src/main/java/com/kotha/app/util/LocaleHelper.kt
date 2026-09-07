package com.kotha.app.util

import android.content.Context
import android.content.SharedPreferences
import android.content.res.Configuration
import android.os.Build
import android.os.LocaleList
import java.util.Locale

/**
 * Utility for persisting and applying dynamic application language (English and Bengali)
 * across Activities, Fragments, and Jetpack Compose.
 */
object LocaleHelper {
    private const val PREFS_NAME = "kotha_locale_prefs"
    private const val KEY_LANGUAGE = "selected_language"
    const val LANGUAGE_BENGALI = "bn"
    const val LANGUAGE_ENGLISH = "en"

    fun getPersistedLanguage(context: Context): String {
        val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_LANGUAGE, LANGUAGE_BENGALI) ?: LANGUAGE_BENGALI
    }

    fun persistLanguage(context: Context, language: String) {
        val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_LANGUAGE, language).apply()
    }

    fun applyLocale(context: Context, language: String = getPersistedLanguage(context)): Context {
        persistLanguage(context, language)
        val locale = Locale(language)
        Locale.setDefault(locale)

        val config = Configuration(context.resources.configuration)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            config.setLocales(LocaleList(locale))
        } else {
            @Suppress("DEPRECATION")
            config.locale = locale
        }
        return context.createConfigurationContext(config)
    }
}
