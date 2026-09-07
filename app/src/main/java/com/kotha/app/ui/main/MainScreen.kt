package com.kotha.app.ui.main

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.kotha.app.R
import com.kotha.app.data.contact.ContactRepository
import com.kotha.app.data.contact.PhoneContact
import com.kotha.app.domain.model.CallType
import com.kotha.app.domain.model.User
import com.kotha.app.util.LocaleHelper
import kotlinx.coroutines.launch

enum class MainTab {
    CHATS,
    CONTACTS,
    SETTINGS
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen(
    currentUser: User,
    onStartCall: (User, CallType) -> Unit,
    onOpenChat: (User) -> Unit,
    onLanguageChanged: (String) -> Unit
) {
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()
    val contactRepo = remember { ContactRepository(context) }

    var selectedTab by remember { mutableStateOf(MainTab.CONTACTS) }
    var searchQuery by remember { mutableStateOf("") }
    var isSyncing by remember { mutableStateOf(false) }

    var kothaUsers by remember { mutableStateOf<List<User>>(emptyList()) }
    var inviteContacts by remember { mutableStateOf<List<PhoneContact>>(emptyList()) }

    var hasContactsPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED
        )
    }

    val requestContactsPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        hasContactsPermission = isGranted
        if (isGranted) {
            coroutineScope.launch {
                isSyncing = true
                contactRepo.registerOrUpdateUserProfile(currentUser)
                val result = contactRepo.syncContacts(currentUser.userId)
                kothaUsers = result.kothaUsers
                inviteContacts = result.inviteContacts
                isSyncing = false
            }
        } else {
            Toast.makeText(context, context.getString(R.string.contacts_permission_required), Toast.LENGTH_LONG).show()
        }
    }

    // Initial contacts synchronization on launch if permission granted
    LaunchedEffect(hasContactsPermission, currentUser.userId) {
        if (hasContactsPermission && currentUser.userId.isNotBlank()) {
            isSyncing = true
            contactRepo.registerOrUpdateUserProfile(currentUser)
            val result = contactRepo.syncContacts(currentUser.userId)
            kothaUsers = result.kothaUsers
            inviteContacts = result.inviteContacts
            isSyncing = false
        }
    }

    // Filter contacts based on search query
    val filteredKothaUsers = remember(kothaUsers, searchQuery) {
        if (searchQuery.isBlank()) kothaUsers
        else kothaUsers.filter {
            it.fullName.contains(searchQuery, ignoreCase = true) ||
            it.phoneNumber.contains(searchQuery)
        }
    }

    val filteredInviteContacts = remember(inviteContacts, searchQuery) {
        if (searchQuery.isBlank()) inviteContacts
        else inviteContacts.filter {
            it.displayName.contains(searchQuery, ignoreCase = true) ||
            it.rawPhoneNumber.contains(searchQuery) ||
            it.normalizedPhoneNumber.contains(searchQuery)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = stringResource(R.string.app_name),
                            color = Color.White,
                            fontWeight = FontWeight.Bold,
                            fontSize = 20.sp
                        )
                        if (isSyncing) {
                            Spacer(modifier = Modifier.width(12.dp))
                            CircularProgressIndicator(
                                modifier = Modifier.size(16.dp),
                                strokeWidth = 2.dp,
                                color = Color(0xFF38BDF8)
                            )
                        }
                    }
                },
                actions = {
                    if (selectedTab == MainTab.CONTACTS) {
                        IconButton(onClick = {
                            if (hasContactsPermission) {
                                coroutineScope.launch {
                                    isSyncing = true
                                    contactRepo.registerOrUpdateUserProfile(currentUser)
                                    val result = contactRepo.syncContacts(currentUser.userId)
                                    kothaUsers = result.kothaUsers
                                    inviteContacts = result.inviteContacts
                                    isSyncing = false
                                    Toast.makeText(context, "Contacts updated", Toast.LENGTH_SHORT).show()
                                }
                            } else {
                                requestContactsPermissionLauncher.launch(Manifest.permission.READ_CONTACTS)
                            }
                        }) {
                            Icon(
                                Icons.Default.Refresh,
                                contentDescription = stringResource(R.string.sync_contacts),
                                tint = Color(0xFF38BDF8)
                            )
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Color(0xFF0F172A))
            )
        },
        bottomBar = {
            NavigationBar(
                containerColor = Color(0xFF0F172A),
                contentColor = Color.White
            ) {
                NavigationBarItem(
                    selected = selectedTab == MainTab.CONTACTS,
                    onClick = { selectedTab = MainTab.CONTACTS },
                    icon = { Icon(Icons.Default.Contacts, contentDescription = stringResource(R.string.contacts)) },
                    label = { Text(stringResource(R.string.contacts)) },
                    colors = NavigationBarItemDefaults.colors(
                        selectedIconColor = Color(0xFF38BDF8),
                        selectedTextColor = Color(0xFF38BDF8),
                        unselectedIconColor = Color(0xFF94A3B8),
                        unselectedTextColor = Color(0xFF94A3B8),
                        indicatorColor = Color(0xFF1E293B)
                    )
                )
                NavigationBarItem(
                    selected = selectedTab == MainTab.CHATS,
                    onClick = { selectedTab = MainTab.CHATS },
                    icon = { Icon(Icons.Default.Chat, contentDescription = stringResource(R.string.chats)) },
                    label = { Text(stringResource(R.string.chats)) },
                    colors = NavigationBarItemDefaults.colors(
                        selectedIconColor = Color(0xFF38BDF8),
                        selectedTextColor = Color(0xFF38BDF8),
                        unselectedIconColor = Color(0xFF94A3B8),
                        unselectedTextColor = Color(0xFF94A3B8),
                        indicatorColor = Color(0xFF1E293B)
                    )
                )
                NavigationBarItem(
                    selected = selectedTab == MainTab.SETTINGS,
                    onClick = { selectedTab = MainTab.SETTINGS },
                    icon = { Icon(Icons.Default.Settings, contentDescription = stringResource(R.string.settings)) },
                    label = { Text(stringResource(R.string.settings)) },
                    colors = NavigationBarItemDefaults.colors(
                        selectedIconColor = Color(0xFF38BDF8),
                        selectedTextColor = Color(0xFF38BDF8),
                        unselectedIconColor = Color(0xFF94A3B8),
                        unselectedTextColor = Color(0xFF94A3B8),
                        indicatorColor = Color(0xFF1E293B)
                    )
                )
            }
        },
        containerColor = Color(0xFF0F172A)
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            when (selectedTab) {
                MainTab.CONTACTS, MainTab.CHATS -> {
                    Column(modifier = Modifier.fillMaxSize()) {
                        // Search bar
                        Surface(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 16.dp, vertical = 8.dp),
                            color = Color(0xFF1E293B),
                            shape = RoundedCornerShape(12.dp)
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp)
                            ) {
                                Icon(Icons.Default.Search, contentDescription = null, tint = Color(0xFF94A3B8))
                                Spacer(modifier = Modifier.width(8.dp))
                                TextField(
                                    value = searchQuery,
                                    onValueChange = { searchQuery = it },
                                    placeholder = {
                                        Text(
                                            text = stringResource(R.string.search_contacts),
                                            color = Color(0xFF64748B),
                                            fontSize = 14.sp
                                        )
                                    },
                                    colors = TextFieldDefaults.colors(
                                        focusedContainerColor = Color.Transparent,
                                        unfocusedContainerColor = Color.Transparent,
                                        focusedTextColor = Color.White,
                                        unfocusedTextColor = Color.White,
                                        focusedIndicatorColor = Color.Transparent,
                                        unfocusedIndicatorColor = Color.Transparent
                                    ),
                                    singleLine = true,
                                    modifier = Modifier.fillMaxWidth()
                                )
                            }
                        }

                        // Permission Required Banner
                        if (!hasContactsPermission) {
                            Surface(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 16.dp, vertical = 8.dp),
                                color = Color(0xFF1E293B),
                                shape = RoundedCornerShape(12.dp)
                            ) {
                                Column(modifier = Modifier.padding(16.dp)) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Icon(Icons.Default.Contacts, contentDescription = null, tint = Color(0xFF38BDF8))
                                        Spacer(modifier = Modifier.width(8.dp))
                                        Text(
                                            text = stringResource(R.string.sync_contacts),
                                            color = Color.White,
                                            fontWeight = FontWeight.Bold,
                                            fontSize = 15.sp
                                        )
                                    }
                                    Spacer(modifier = Modifier.height(6.dp))
                                    Text(
                                        text = stringResource(R.string.contacts_permission_required),
                                        color = Color(0xFF94A3B8),
                                        fontSize = 13.sp
                                    )
                                    Spacer(modifier = Modifier.height(12.dp))
                                    Button(
                                        onClick = { requestContactsPermissionLauncher.launch(Manifest.permission.READ_CONTACTS) },
                                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF38BDF8)),
                                        shape = RoundedCornerShape(8.dp)
                                    ) {
                                        Text(text = stringResource(R.string.grant_permission), color = Color.Black, fontWeight = FontWeight.Bold)
                                    }
                                }
                            }
                        }

                        // Contacts List
                        LazyColumn(modifier = Modifier.fillMaxSize()) {
                            // Section: Kotha Users (Registered Friends)
                            if (filteredKothaUsers.isNotEmpty()) {
                                item {
                                    Text(
                                        text = "${stringResource(R.string.kotha_users)} (${filteredKothaUsers.size})",
                                        color = Color(0xFF38BDF8),
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.Bold,
                                        modifier = Modifier.padding(start = 16.dp, top = 12.dp, bottom = 4.dp)
                                    )
                                }

                                items(filteredKothaUsers, key = { it.userId }) { user ->
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .clickable { onOpenChat(user) }
                                            .padding(horizontal = 16.dp, vertical = 10.dp),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Box(
                                            modifier = Modifier
                                                .size(46.dp)
                                                .clip(CircleShape)
                                                .background(Color(0xFF1E3A8A)),
                                            contentAlignment = Alignment.Center
                                        ) {
                                            Icon(Icons.Default.Person, contentDescription = null, tint = Color(0xFF93C5FD))
                                        }
                                        Spacer(modifier = Modifier.width(14.dp))
                                        Column(modifier = Modifier.weight(1f)) {
                                            Text(user.fullName, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                                            Text(user.phoneNumber, color = Color(0xFF64748B), fontSize = 12.sp)
                                        }
                                        // Chat Button
                                        IconButton(onClick = { onOpenChat(user) }) {
                                            Icon(Icons.Default.Chat, contentDescription = stringResource(R.string.chats), tint = Color(0xFFA855F7))
                                        }
                                        // Voice Call Button
                                        IconButton(onClick = { onStartCall(user, CallType.AUDIO) }) {
                                            Icon(Icons.Default.Call, contentDescription = stringResource(R.string.audio_call), tint = Color(0xFF38BDF8))
                                        }
                                        // Video Call Button
                                        IconButton(onClick = { onStartCall(user, CallType.VIDEO) }) {
                                            Icon(Icons.Default.Videocam, contentDescription = stringResource(R.string.video_call), tint = Color(0xFF22C55E))
                                        }
                                    }
                                    Divider(color = Color(0xFF1E293B), thickness = 0.5.dp)
                                }
                            }

                            // Section: Other Phone Contacts (Invite)
                            if (hasContactsPermission && filteredInviteContacts.isNotEmpty()) {
                                item {
                                    Text(
                                        text = "${stringResource(R.string.other_contacts)} (${filteredInviteContacts.size})",
                                        color = Color(0xFF94A3B8),
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.Bold,
                                        modifier = Modifier.padding(start = 16.dp, top = 16.dp, bottom = 4.dp)
                                    )
                                }

                                items(filteredInviteContacts, key = { it.contactId + it.normalizedPhoneNumber }) { contact ->
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .padding(horizontal = 16.dp, vertical = 10.dp),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Box(
                                            modifier = Modifier
                                                .size(42.dp)
                                                .clip(CircleShape)
                                                .background(Color(0xFF334155)),
                                            contentAlignment = Alignment.Center
                                        ) {
                                            Icon(Icons.Default.PersonOutline, contentDescription = null, tint = Color(0xFF94A3B8))
                                        }
                                        Spacer(modifier = Modifier.width(14.dp))
                                        Column(modifier = Modifier.weight(1f)) {
                                            Text(contact.displayName, color = Color(0xFFE2E8F0), fontSize = 14.sp)
                                            Text(contact.rawPhoneNumber, color = Color(0xFF64748B), fontSize = 12.sp)
                                        }
                                        // Invite Button via SMS
                                        OutlinedButton(
                                            onClick = {
                                                val smsIntent = Intent(Intent.ACTION_VIEW).apply {
                                                    data = Uri.parse("sms:${contact.rawPhoneNumber}")
                                                    putExtra("sms_body", "Join me on Kotha for crystal clear voice and video calls! https://kotha.app")
                                                }
                                                try {
                                                    context.startActivity(smsIntent)
                                                } catch (e: Exception) {
                                                    Toast.makeText(context, "Could not open SMS app", Toast.LENGTH_SHORT).show()
                                                }
                                            },
                                            shape = RoundedCornerShape(16.dp),
                                            colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFF38BDF8)),
                                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp)
                                        ) {
                                            Text(stringResource(R.string.invite), fontSize = 12.sp)
                                        }
                                    }
                                    Divider(color = Color(0xFF1E293B), thickness = 0.5.dp)
                                }
                            }

                            if (filteredKothaUsers.isEmpty() && filteredInviteContacts.isEmpty()) {
                                item {
                                    Box(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .padding(32.dp),
                                        contentAlignment = Alignment.Center
                                    ) {
                                        Text(
                                            text = if (isSyncing) stringResource(R.string.syncing_contacts) else stringResource(R.string.no_contacts_found),
                                            color = Color(0xFF64748B),
                                            fontSize = 14.sp
                                        )
                                    }
                                }
                            }
                        }
                    }
                }

                MainTab.SETTINGS -> {
                    // Settings & Language Selection
                    val currentLang = remember { LocaleHelper.getPersistedLanguage(context) }
                    var selectedLang by remember { mutableStateOf(currentLang) }

                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(16.dp)
                    ) {
                        // User Profile Card
                        Surface(
                            modifier = Modifier.fillMaxWidth(),
                            color = Color(0xFF1E293B),
                            shape = RoundedCornerShape(16.dp)
                        ) {
                            Row(
                                modifier = Modifier.padding(16.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Box(
                                    modifier = Modifier
                                        .size(54.dp)
                                        .clip(CircleShape)
                                        .background(Color(0xFF38BDF8)),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Icon(Icons.Default.Person, contentDescription = null, tint = Color.Black, modifier = Modifier.size(32.dp))
                                }
                                Spacer(modifier = Modifier.width(16.dp))
                                Column {
                                    Text(currentUser.fullName, color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                                    Text(currentUser.phoneNumber.ifBlank { "Kotha ID: ${currentUser.userId.take(8)}" }, color = Color(0xFF94A3B8), fontSize = 13.sp)
                                    Spacer(modifier = Modifier.height(4.dp))
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Box(modifier = Modifier.size(8.dp).clip(CircleShape).background(Color(0xFF22C55E)))
                                        Spacer(modifier = Modifier.width(6.dp))
                                        Text(stringResource(R.string.online), color = Color(0xFF22C55E), fontSize = 12.sp)
                                    }
                                }
                            }
                        }

                        Spacer(modifier = Modifier.height(24.dp))

                        // Language Selector Section
                        Text(
                            text = stringResource(R.string.language),
                            color = Color(0xFF38BDF8),
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(bottom = 8.dp)
                        )

                        Surface(
                            modifier = Modifier.fillMaxWidth(),
                            color = Color(0xFF1E293B),
                            shape = RoundedCornerShape(16.dp)
                        ) {
                            Column {
                                // Bengali
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clickable {
                                            selectedLang = LocaleHelper.LANGUAGE_BENGALI
                                            LocaleHelper.persistLanguage(context, LocaleHelper.LANGUAGE_BENGALI)
                                            onLanguageChanged(LocaleHelper.LANGUAGE_BENGALI)
                                        }
                                        .padding(16.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(
                                        text = stringResource(R.string.bengali),
                                        color = Color.White,
                                        fontSize = 15.sp,
                                        modifier = Modifier.weight(1f)
                                    )
                                    if (selectedLang == LocaleHelper.LANGUAGE_BENGALI) {
                                        Icon(Icons.Default.Check, contentDescription = null, tint = Color(0xFF38BDF8))
                                    }
                                }

                                Divider(color = Color(0xFF334155), thickness = 0.5.dp)

                                // English
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clickable {
                                            selectedLang = LocaleHelper.LANGUAGE_ENGLISH
                                            LocaleHelper.persistLanguage(context, LocaleHelper.LANGUAGE_ENGLISH)
                                            onLanguageChanged(LocaleHelper.LANGUAGE_ENGLISH)
                                        }
                                        .padding(16.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(
                                        text = stringResource(R.string.english),
                                        color = Color.White,
                                        fontSize = 15.sp,
                                        modifier = Modifier.weight(1f)
                                    )
                                    if (selectedLang == LocaleHelper.LANGUAGE_ENGLISH) {
                                        Icon(Icons.Default.Check, contentDescription = null, tint = Color(0xFF38BDF8))
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
