package com.facemorph.studio

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccessibilityNew
import androidx.compose.material.icons.filled.Checkroom
import androidx.compose.material.icons.filled.Face
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.facemorph.studio.model.StudioTab
import com.facemorph.studio.ui.BodyPhysicsScreen
import com.facemorph.studio.ui.CustomAssetDialog
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
                surface = Color(0xFF0F172A),
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
    val snackbarHostState = remember { SnackbarHostState() }

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
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFF0F172A))
                    .padding(horizontal = 14.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        Icons.Default.Face,
                        contentDescription = null,
                        tint = Color(0xFF818CF8),
                        modifier = Modifier.size(22.dp)
                    )
                    Spacer(Modifier.width(8.dp))
                    Column {
                        Text(
                            "FaceMorph Studio",
                            color = Color.White,
                            fontWeight = FontWeight.Bold,
                            fontSize = 15.sp
                        )
                        Text(
                            "Pure Native Kotlin • Android 7.0+",
                            color = Color(0xFF22D3EE),
                            fontSize = 10.sp
                        )
                    }
                }
                Text(
                    "NATIVE AR",
                    color = Color(0xFF34D399),
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier
                        .background(Color(0xFF064E3B), RoundedCornerShape(6.dp))
                        .padding(horizontal = 8.dp, vertical = 3.dp)
                )
            }
        },
        bottomBar = {
            NavigationBar(containerColor = Color(0xFF0F172A)) {
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
                        icon = { Icon(icon, contentDescription = tab.label) },
                        label = { Text(tab.label, fontSize = 10.sp) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = Color.White,
                            selectedTextColor = Color(0xFF818CF8),
                            indicatorColor = Color(0xFF312E81),
                            unselectedIconColor = Color(0xFF94A3B8),
                            unselectedTextColor = Color(0xFF94A3B8)
                        )
                    )
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
}
