package com.facemorph.studio

import android.Manifest
import android.app.Activity
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccessibilityNew
import androidx.compose.material.icons.filled.AddAPhoto
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Checkroom
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Face
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.viewmodel.compose.viewModel
import com.facemorph.studio.model.StudioTab
import com.facemorph.studio.ui.BodyPhysicsScreen
import com.facemorph.studio.ui.CustomAssetDialog
import com.facemorph.studio.ui.FaceProfileManagerDialog
import com.facemorph.studio.ui.FaceStudioScreen
import com.facemorph.studio.ui.LiveCameraScreen
import com.facemorph.studio.ui.WardrobeVaultScreen
import com.facemorph.studio.viewmodel.StudioViewModel

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setContent {
            val palette = darkColorScheme(
                primary = Color(0xFF6366F1),
                secondary = Color(0xFF22D3EE),
                background = Color(0xFF020617),
                surface = Color(0xFF0B1120),
                onPrimary = Color.White,
                onBackground = Color.White,
                onSurface = Color.White
            )
            MaterialTheme(colorScheme = palette) {
                FaceMorphNativeApp()
            }
        }
    }
}

@Composable
fun FaceMorphNativeApp(studioViewModel: StudioViewModel = viewModel()) {
    val context = LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }
    var showExitConfirmDialog by remember { mutableStateOf(false) }

    BackHandler(
        enabled = !studioViewModel.showFaceProfileManager &&
            !studioViewModel.showCustomAssetDialog &&
            !showExitConfirmDialog
    ) {
        showExitConfirmDialog = true
    }

    val startupPermissions = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { }

    LaunchedEffect(Unit) {
        val perms = mutableListOf(
            Manifest.permission.CAMERA,
            Manifest.permission.RECORD_AUDIO
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            perms += Manifest.permission.READ_MEDIA_IMAGES
        } else {
            perms += Manifest.permission.READ_EXTERNAL_STORAGE
            if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P) {
                perms += Manifest.permission.WRITE_EXTERNAL_STORAGE
            }
        }
        startupPermissions.launch(perms.toTypedArray())
    }

    LaunchedEffect(studioViewModel.toastMessage) {
        val msg = studioViewModel.toastMessage
        if (!msg.isNullOrBlank()) {
            snackbarHostState.showSnackbar(msg)
            studioViewModel.toastMessage = null
        }
    }

    Scaffold(
        containerColor = Color(0xFF020617),
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            Column {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(44.dp)
                        .background(Color(0xFF0A0F1E))
                        .padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(26.dp)
                                .clip(RoundedCornerShape(7.dp))
                                .background(Color(0xFF4F46E5)),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(Icons.Default.Face, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
                        }
                        Spacer(Modifier.width(8.dp))
                        Text(
                            "FaceMorph",
                            color = Color.White,
                            fontWeight = FontWeight.Bold,
                            fontSize = 15.sp
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(
                            studioViewModel.activeTab.label,
                            color = Color(0xFF818CF8),
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Medium
                        )
                    }

                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .background(Color(0xFF1E1B4B))
                                .border(1.dp, Color(0xFF6366F1), RoundedCornerShape(8.dp))
                                .clickable { studioViewModel.showFaceProfileManager = true }
                                .padding(horizontal = 9.dp, vertical = 5.dp)
                        ) {
                            Icon(Icons.Default.Face, contentDescription = null, tint = Color(0xFFA5B4FC), modifier = Modifier.size(14.dp))
                            Spacer(Modifier.width(4.dp))
                            Text(
                                "Profiles (${studioViewModel.faceProfiles.size})",
                                color = Color.White,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                        }

                        if (studioViewModel.activeTab != StudioTab.FACE_STUDIO) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(Color(0xFF111827))
                                    .border(1.dp, Color(0xFF334155), RoundedCornerShape(8.dp))
                                    .clickable { studioViewModel.showCustomAssetDialog = true }
                                    .padding(horizontal = 10.dp, vertical = 5.dp)
                            ) {
                                Icon(Icons.Default.AddAPhoto, contentDescription = null, tint = Color(0xFFFBBF24), modifier = Modifier.size(14.dp))
                                Spacer(Modifier.width(5.dp))
                                Text("Scan Item", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                            }
                        }
                    }
                }
                HorizontalDivider(color = Color(0xFF1E293B), thickness = 1.dp)
            }
        },
        bottomBar = {
            Column {
                HorizontalDivider(color = Color(0xFF1E293B), thickness = 1.dp)
                NavigationBar(
                    containerColor = Color(0xFF0A0F1E),
                    modifier = Modifier.height(58.dp)
                ) {
                    StudioTab.entries.forEach { tab ->
                        val icon = when (tab) {
                            StudioTab.FACE_STUDIO -> Icons.Default.Face
                            StudioTab.BODY_PHYSICS -> Icons.Default.AccessibilityNew
                            StudioTab.LIVE_CAMERA -> Icons.Default.Videocam
                            StudioTab.VAULT -> Icons.Default.Checkroom
                        }
                        NavigationBarItem(
                            selected = studioViewModel.activeTab == tab,
                            onClick = { studioViewModel.activeTab = tab },
                            icon = { Icon(icon, contentDescription = tab.label, modifier = Modifier.size(19.dp)) },
                            label = { Text(tab.label, fontSize = 10.sp, fontWeight = FontWeight.Medium, maxLines = 1) },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = Color.White,
                                selectedTextColor = Color(0xFF818CF8),
                                indicatorColor = Color(0xFF312E81),
                                unselectedIconColor = Color(0xFF64748B),
                                unselectedTextColor = Color(0xFF64748B)
                            )
                        )
                    }
                }
            }
        }
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
        ) {
            when (studioViewModel.activeTab) {
                StudioTab.FACE_STUDIO -> FaceStudioScreen(studioViewModel)
                StudioTab.BODY_PHYSICS -> BodyPhysicsScreen(studioViewModel)
                StudioTab.LIVE_CAMERA -> LiveCameraScreen(studioViewModel)
                StudioTab.VAULT -> WardrobeVaultScreen(studioViewModel)
            }
        }
    }

    if (studioViewModel.showCustomAssetDialog) {
        CustomAssetDialog(
            viewModel = studioViewModel,
            onDismiss = { studioViewModel.showCustomAssetDialog = false }
        )
    }

    if (studioViewModel.showFaceProfileManager) {
        FaceProfileManagerDialog(
            viewModel = studioViewModel,
            onDismiss = { studioViewModel.showFaceProfileManager = false }
        )
    }

    if (showExitConfirmDialog) {
        Dialog(onDismissRequest = { showExitConfirmDialog = false }) {
            Surface(
                shape = RoundedCornerShape(18.dp),
                color = Color(0xFF0A1020),
                border = BorderStroke(1.dp, Color(0xFF334155))
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(18.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(46.dp)
                            .clip(CircleShape)
                            .background(Color(0xFF312E81)),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            Icons.Default.Face,
                            contentDescription = null,
                            tint = Color(0xFFA5B4FC),
                            modifier = Modifier.size(24.dp)
                        )
                    }
                    Text(
                        "Exit FaceMorph?",
                        color = Color.White,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        "Do you want to close the app? Any unsaved canvas edits will be lost.",
                        color = Color(0xFF94A3B8),
                        fontSize = 12.sp,
                        textAlign = TextAlign.Center
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        OutlinedButton(
                            onClick = { showExitConfirmDialog = false },
                            shape = RoundedCornerShape(10.dp),
                            border = BorderStroke(1.dp, Color(0xFF475569)),
                            modifier = Modifier.weight(1f).height(42.dp),
                            contentPadding = PaddingValues(horizontal = 12.dp)
                        ) {
                            Icon(
                                Icons.Default.Close,
                                contentDescription = "No",
                                tint = Color(0xFFF87171),
                                modifier = Modifier.size(18.dp)
                            )
                            Spacer(Modifier.width(6.dp))
                            Text("No", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                        }
                        Button(
                            onClick = {
                                showExitConfirmDialog = false
                                (context as? Activity)?.finish()
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF059669)),
                            shape = RoundedCornerShape(10.dp),
                            modifier = Modifier.weight(1f).height(42.dp),
                            contentPadding = PaddingValues(horizontal = 12.dp)
                        ) {
                            Icon(
                                Icons.Default.Check,
                                contentDescription = "Yes",
                                tint = Color.White,
                                modifier = Modifier.size(18.dp)
                            )
                            Spacer(Modifier.width(6.dp))
                            Text("Yes", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }
    }
}
