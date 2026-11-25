package com.facemorph.studio

import android.Manifest
import android.app.Activity
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccessibilityNew
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Checkroom
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCut
import androidx.compose.material.icons.filled.Face
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
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
import com.facemorph.studio.ui.AndroidMaterialColorScheme
import com.facemorph.studio.ui.BodyPhysicsScreen
import com.facemorph.studio.ui.CustomAssetDialog
import com.facemorph.studio.ui.FaceProfileManagerDialog
import com.facemorph.studio.ui.FaceStudioScreen
import com.facemorph.studio.ui.LiveCameraScreen
import com.facemorph.studio.ui.StudioColors
import com.facemorph.studio.ui.WardrobeVaultScreen
import com.facemorph.studio.viewmodel.StudioViewModel

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT)
        )

        setContent {
            MaterialTheme(colorScheme = AndroidMaterialColorScheme) {
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
        if (studioViewModel.isFullScreenEditor) {
            studioViewModel.isFullScreenEditor = false
        } else {
            showExitConfirmDialog = true
        }
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

    // Automatically exit full-screen editor when switching to Library/Wardrobe tab
    LaunchedEffect(studioViewModel.activeTab) {
        if (studioViewModel.activeTab == StudioTab.VAULT) {
            studioViewModel.isFullScreenEditor = false
        }
    }

    val showLibraryTopBar = studioViewModel.activeTab == StudioTab.VAULT
    val showBottomNavBar = !studioViewModel.isFullScreenEditor

    Scaffold(
        containerColor = StudioColors.Background,
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            AnimatedVisibility(
                visible = showLibraryTopBar,
                enter = fadeIn() + expandVertically(),
                exit = fadeOut() + shrinkVertically()
            ) {
                Surface(
                    color = StudioColors.SurfaceContainerLow,
                    tonalElevation = 2.dp
                ) {
                    Column(modifier = Modifier.statusBarsPadding()) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(58.dp)
                                .padding(horizontal = 16.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Box(
                                    modifier = Modifier
                                        .size(34.dp)
                                        .clip(RoundedCornerShape(10.dp))
                                        .background(StudioColors.PrimaryContainer),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Icon(
                                        Icons.Default.Face,
                                        contentDescription = null,
                                        tint = StudioColors.OnPrimaryContainer,
                                        modifier = Modifier.size(20.dp)
                                    )
                                }
                                Spacer(Modifier.width(10.dp))
                                Column {
                                    Text(
                                        "FaceMorph",
                                        color = StudioColors.TextPrimary,
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 16.sp
                                    )
                                    Text(
                                        "Profiles & Wardrobe Library",
                                        color = StudioColors.TextSecondary,
                                        fontSize = 11.sp
                                    )
                                }
                            }

                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                FilledTonalButton(
                                    onClick = { studioViewModel.showFaceProfileManager = true },
                                    shape = RoundedCornerShape(14.dp),
                                    colors = ButtonDefaults.filledTonalButtonColors(
                                        containerColor = StudioColors.PrimaryContainer,
                                        contentColor = StudioColors.OnPrimaryContainer
                                    ),
                                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 0.dp),
                                    modifier = Modifier.height(40.dp)
                                ) {
                                    Icon(Icons.Default.Face, contentDescription = null, modifier = Modifier.size(16.dp))
                                    Spacer(Modifier.width(6.dp))
                                    Text("Profiles (${studioViewModel.faceProfiles.size})", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                                }

                                FilledTonalButton(
                                    onClick = { studioViewModel.showCustomAssetDialog = true },
                                    shape = RoundedCornerShape(14.dp),
                                    colors = ButtonDefaults.filledTonalButtonColors(
                                        containerColor = StudioColors.SurfaceContainerHigh,
                                        contentColor = StudioColors.TextPrimary
                                    ),
                                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 0.dp),
                                    modifier = Modifier.height(40.dp)
                                ) {
                                    Icon(Icons.Default.ContentCut, contentDescription = null, tint = StudioColors.Warning, modifier = Modifier.size(16.dp))
                                    Spacer(Modifier.width(6.dp))
                                    Text("Cutout", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                                }
                            }
                        }
                        HorizontalDivider(color = StudioColors.OutlineVariant.copy(alpha = 0.45f), thickness = 1.dp)
                    }
                }
            }
        },
        bottomBar = {
            AnimatedVisibility(
                visible = showBottomNavBar,
                enter = fadeIn() + expandVertically(),
                exit = fadeOut() + shrinkVertically()
            ) {
                Surface(
                    color = StudioColors.SurfaceContainerLow,
                    tonalElevation = 4.dp
                ) {
                    Column(modifier = Modifier.navigationBarsPadding()) {
                        HorizontalDivider(color = StudioColors.OutlineVariant.copy(alpha = 0.35f), thickness = 1.dp)
                        NavigationBar(
                            containerColor = StudioColors.SurfaceContainerLow,
                            tonalElevation = 0.dp,
                            modifier = Modifier.height(68.dp)
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
                                    icon = { Icon(icon, contentDescription = tab.label, modifier = Modifier.size(22.dp)) },
                                    label = { Text(tab.label, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, maxLines = 1) },
                                    colors = NavigationBarItemDefaults.colors(
                                        selectedIconColor = StudioColors.OnPrimaryContainer,
                                        selectedTextColor = StudioColors.Primary,
                                        indicatorColor = StudioColors.PrimaryContainer,
                                        unselectedIconColor = StudioColors.TextMuted,
                                        unselectedTextColor = StudioColors.TextMuted
                                    )
                                )
                            }
                        }
                    }
                }
            }
        }
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(
                    top = if (showLibraryTopBar) innerPadding.calculateTopPadding() else 0.dp,
                    bottom = if (showBottomNavBar) innerPadding.calculateBottomPadding() else 0.dp
                )
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
                shape = RoundedCornerShape(24.dp),
                color = StudioColors.SurfaceContainer,
                tonalElevation = 8.dp
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(22.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(14.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(52.dp)
                            .clip(CircleShape)
                            .background(StudioColors.PrimaryContainer),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            Icons.Default.Face,
                            contentDescription = null,
                            tint = StudioColors.OnPrimaryContainer,
                            modifier = Modifier.size(26.dp)
                        )
                    }
                    Text(
                        "Exit FaceMorph?",
                        color = StudioColors.TextPrimary,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        "Any unsaved canvas edits will be lost. Your saved face profiles stay safely stored.",
                        color = StudioColors.TextSecondary,
                        fontSize = 13.sp,
                        textAlign = TextAlign.Center
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        OutlinedButton(
                            onClick = { showExitConfirmDialog = false },
                            shape = RoundedCornerShape(14.dp),
                            modifier = Modifier.weight(1f).height(46.dp),
                            contentPadding = PaddingValues(horizontal = 12.dp)
                        ) {
                            Icon(
                                Icons.Default.Close,
                                contentDescription = "Stay",
                                tint = StudioColors.TextSecondary,
                                modifier = Modifier.size(18.dp)
                            )
                            Spacer(Modifier.width(6.dp))
                            Text("Stay", color = StudioColors.TextPrimary, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                        }
                        Button(
                            onClick = {
                                showExitConfirmDialog = false
                                (context as? Activity)?.finish()
                            },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = StudioColors.TertiaryContainer,
                                contentColor = StudioColors.OnTertiaryContainer
                            ),
                            shape = RoundedCornerShape(14.dp),
                            modifier = Modifier.weight(1f).height(46.dp),
                            contentPadding = PaddingValues(horizontal = 12.dp)
                        ) {
                            Icon(
                                Icons.Default.Check,
                                contentDescription = "Exit",
                                modifier = Modifier.size(18.dp)
                            )
                            Spacer(Modifier.width(6.dp))
                            Text("Exit", fontSize = 13.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }
    }
}
