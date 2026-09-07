# Proguard rules for Kotha Android
-keep class org.webrtc.** { *; }
-dontwarn org.webrtc.**
-keep class io.getstream.** { *; }
-dontwarn io.getstream.**
-keepattributes *Annotation*
-keepclassmembers class * {
    @com.google.firebase.firestore.PropertyName <fields>;
    @com.google.firebase.firestore.PropertyName <methods>;
}
