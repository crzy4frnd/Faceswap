package com.facemorph.studio.engine

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import androidx.annotation.RequiresApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File
import kotlin.math.max
import kotlin.math.min

enum class ThermalPressureLevel {
    NORMAL,
    ELEVATED,
    THROTTLING
}

data class ThermalWarningState(
    val showPerformanceWarning: Boolean = false,
    val isSevereThrottling: Boolean = false,
    val message: String = ""
)

/**
 * Background thermal & frame-drop monitor for real-time AR face swapping.
 *
 * Polls CPU/GPU thermal zones, Android PowerManager thermal status/headroom (API 29+/30+),
 * and battery chassis temperature on a background I/O coroutine, then correlates sustained
 * thermal elevation with dropped or delayed frames in the live face-swap loop to surface
 * a clean 'Performance Warning' overlay only when thermals degrade frame delivery.
 */
class ThermalPerformanceMonitor(private val appContext: Context) {

    private data class ThermalZoneEntry(
        val tempFile: File,
        val isCpuOrSoc: Boolean,
        val isGpu: Boolean
    )

    private val _warningState = MutableStateFlow(ThermalWarningState())
    val warningState: StateFlow<ThermalWarningState> = _warningState.asStateFlow()

    private val lock = Any()
    private val monitorScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var pollingJob: Job? = null
    private var thermalZones: List<ThermalZoneEntry> = emptyList()
    private var zonesDiscovered = false

    @Volatile
    private var faceSwapActive = false
    private var currentThermalLevel = ThermalPressureLevel.NORMAL
    private var apiThermalStatus = 0
    private var apiThermalHeadroom = 0f
    private var peakCpuTempC = 0f
    private var peakGpuTempC = 0f
    private var batteryTempC = 0f

    // Frame-drop tracking during active face swapping
    private var emaDropPressure = 0f
    private var consecutiveDropEvents = 0
    private var lastOutputElapsedMs = 0L
    private var lastDropEventMs = 0L
    private var correlatedStartMs = 0L
    private var healthyRecoveryStartMs = 0L
    private var dismissedUntilMs = 0L
    private var dismissedSeverity = ThermalPressureLevel.NORMAL

    private var powerManagerListener: Any? = null

    fun startMonitoring() {
        synchronized(lock) {
            if (pollingJob?.isActive == true) return
            registerApiThermalListenerIfSupported()
            pollingJob = monitorScope.launch {
                if (!zonesDiscovered) {
                    thermalZones = discoverThermalZones()
                    zonesDiscovered = true
                }
                while (isActive) {
                    sampleThermalSensors()
                    evaluateWarningState()
                    delay(1800L)
                }
            }
        }
    }

    fun stopMonitoring() {
        synchronized(lock) {
            pollingJob?.cancel()
            pollingJob = null
            unregisterApiThermalListenerIfSupported()
        }
        monitorScope.cancel()
    }

    fun setFaceSwapActive(active: Boolean) {
        synchronized(lock) {
            if (faceSwapActive == active) return
            faceSwapActive = active
            if (!active) {
                emaDropPressure = 0f
                consecutiveDropEvents = 0
                lastOutputElapsedMs = 0L
                correlatedStartMs = 0L
                healthyRecoveryStartMs = 0L
                _warningState.value = ThermalWarningState()
            } else {
                lastOutputElapsedMs = SystemClock.elapsedRealtime()
            }
        }
    }

    fun dismissWarningTemporarily() {
        synchronized(lock) {
            val now = SystemClock.elapsedRealtime()
            dismissedUntilMs = now + 45_000L
            dismissedSeverity = currentThermalLevel
            _warningState.value = ThermalWarningState()
        }
    }

    fun recordFrameMetrics(
        isFaceSwapActive: Boolean,
        processingDurationMs: Long,
        droppedFromBridge: Int
    ) {
        val now = SystemClock.elapsedRealtime()
        synchronized(lock) {
            faceSwapActive = isFaceSwapActive
            if (!isFaceSwapActive) {
                if (_warningState.value.showPerformanceWarning) {
                    _warningState.value = ThermalWarningState()
                }
                return
            }

            val intervalMs = if (lastOutputElapsedMs > 0L) (now - lastOutputElapsedMs) else processingDurationMs
            lastOutputElapsedMs = now

            // Frame is considered dropped/stalled if CameraX skipped buffers in the mailbox or frame budget (~18fps) was exceeded
            val frameDroppedOrStalled = droppedFromBridge > 0 || processingDurationMs >= 58L || intervalMs >= 68L
            val instantPenalty = when {
                droppedFromBridge >= 2 || processingDurationMs >= 95L || intervalMs >= 105L -> 1.0f
                droppedFromBridge == 1 || processingDurationMs >= 64L || intervalMs >= 74L -> 0.72f
                frameDroppedOrStalled -> 0.45f
                else -> 0f
            }

            emaDropPressure = emaDropPressure * 0.84f + instantPenalty * 0.16f
            if (frameDroppedOrStalled) {
                consecutiveDropEvents = min(30, consecutiveDropEvents + 1 + min(3, droppedFromBridge))
                lastDropEventMs = now
            } else {
                consecutiveDropEvents = max(0, consecutiveDropEvents - 1)
            }

            evaluateWarningStateLocked(now)
        }
    }

    private fun sampleThermalSensors() {
        var maxCpu = 0f
        var maxGpu = 0f

        for (zone in thermalZones) {
            val tempC = readThermalZoneTempC(zone.tempFile) ?: continue
            if (zone.isGpu) {
                maxGpu = max(maxGpu, tempC)
            } else if (zone.isCpuOrSoc) {
                maxCpu = max(maxCpu, tempC)
            } else {
                // Skin/chassis zone acts as conservative SoC proxy if cpu/gpu sensors aren't separated
                maxCpu = max(maxCpu, tempC)
            }
        }

        val battTemp = readBatteryTempC()
        var status = 0
        var headroom = 0f
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val pm = appContext.getSystemService(Context.POWER_SERVICE) as? PowerManager
            if (pm != null) {
                status = Api29ThermalHelper.getCurrentThermalStatus(pm)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    headroom = Api30ThermalHelper.getThermalHeadroom(pm)
                }
            }
        }

        val computedLevel = classifyThermalPressure(
            cpuTempC = maxCpu,
            gpuTempC = maxGpu,
            batteryTempC = battTemp,
            apiStatus = status,
            headroom = headroom
        )

        synchronized(lock) {
            peakCpuTempC = maxCpu
            peakGpuTempC = maxGpu
            batteryTempC = battTemp
            apiThermalStatus = status
            apiThermalHeadroom = headroom
            currentThermalLevel = computedLevel
        }
    }

    private fun evaluateWarningState() {
        val now = SystemClock.elapsedRealtime()
        synchronized(lock) {
            evaluateWarningStateLocked(now)
        }
    }

    private fun evaluateWarningStateLocked(now: Long) {
        if (!faceSwapActive) {
            _warningState.value = ThermalWarningState()
            return
        }

        val isWarmOrThrottling = currentThermalLevel != ThermalPressureLevel.NORMAL
        val recentDropActive = (now - lastDropEventMs) <= 2500L &&
            (emaDropPressure >= 0.24f || consecutiveDropEvents >= 4)

        if (isWarmOrThrottling && recentDropActive) {
            healthyRecoveryStartMs = 0L
            if (correlatedStartMs == 0L) {
                correlatedStartMs = now
            }
            val sustainedMs = now - correlatedStartMs
            val snoozed = now < dismissedUntilMs &&
                !(currentThermalLevel == ThermalPressureLevel.THROTTLING && dismissedSeverity != ThermalPressureLevel.THROTTLING)

            if (sustainedMs >= 1300L && !snoozed) {
                val severe = currentThermalLevel == ThermalPressureLevel.THROTTLING || emaDropPressure >= 0.58f
                val msg = if (severe) {
                    "Device overheating is dropping live face-swap frames"
                } else {
                    "High CPU/GPU heat is slowing real-time face swap"
                }
                val current = _warningState.value
                if (!current.showPerformanceWarning || current.isSevereThrottling != severe || current.message != msg) {
                    _warningState.value = ThermalWarningState(
                        showPerformanceWarning = true,
                        isSevereThrottling = severe,
                        message = msg
                    )
                }
            }
        } else {
            correlatedStartMs = 0L
            if (_warningState.value.showPerformanceWarning) {
                if (healthyRecoveryStartMs == 0L) {
                    healthyRecoveryStartMs = now
                } else if (now - healthyRecoveryStartMs >= 3800L) {
                    _warningState.value = ThermalWarningState()
                    healthyRecoveryStartMs = 0L
                }
            }
        }
    }

    private fun classifyThermalPressure(
        cpuTempC: Float,
        gpuTempC: Float,
        batteryTempC: Float,
        apiStatus: Int,
        headroom: Float
    ): ThermalPressureLevel {
        // API 29+ PowerManager thermal status (3 = SEVERE, 4 = CRITICAL, 5 = EMERGENCY)
        if (apiStatus >= 3 || headroom >= 1.0f || cpuTempC >= 72f || gpuTempC >= 70f || batteryTempC >= 42.5f) {
            return ThermalPressureLevel.THROTTLING
        }
        // API 29+ status 2 = MODERATE (throttling imminent / light reduction active)
        if (apiStatus >= 2 || headroom >= 0.86f || cpuTempC >= 61f || gpuTempC >= 59f || batteryTempC >= 39.2f) {
            return ThermalPressureLevel.ELEVATED
        }
        return ThermalPressureLevel.NORMAL
    }

    private fun discoverThermalZones(): List<ThermalZoneEntry> {
        val result = ArrayList<ThermalZoneEntry>(12)
        val roots = listOf("/sys/class/thermal", "/sys/devices/virtual/thermal")
        for (rootPath in roots) {
            if (result.isNotEmpty()) break
            for (idx in 0..31) {
                try {
                    val zoneDir = File("$rootPath/thermal_zone$idx")
                    if (!zoneDir.exists()) continue
                    val typeFile = File(zoneDir, "type")
                    val tempFile = File(zoneDir, "temp")
                    if (!tempFile.canRead()) continue

                    val zoneType = if (typeFile.canRead()) {
                        typeFile.readText().trim().lowercase()
                    } else {
                        ""
                    }
                    val isGpu = zoneType.contains("gpu") || zoneType.contains("g3d") || zoneType.contains("kgsl")
                    val isCpu = zoneType.contains("cpu") || zoneType.contains("tsens") ||
                        zoneType.contains("soc") || zoneType.contains("ap") ||
                        zoneType.contains("big") || zoneType.contains("little") ||
                        zoneType.contains("prime") || zoneType.contains("mid")
                    val isUsefulProxy = zoneType.contains("skin") || zoneType.contains("xo_therm") || zoneType.contains("therm")

                    if ((isGpu || isCpu || isUsefulProxy) && readThermalZoneTempC(tempFile) != null) {
                        result.add(ThermalZoneEntry(tempFile = tempFile, isCpuOrSoc = isCpu, isGpu = isGpu))
                    }
                } catch (_: Throwable) {
                    // Ignore SELinux-restricted thermal nodes cleanly
                }
            }
        }
        return result
    }

    private fun readThermalZoneTempC(tempFile: File): Float? {
        return try {
            val rawStr = tempFile.readText().trim()
            val raw = rawStr.toFloatOrNull() ?: return null
            val celsius = when {
                raw > 1000f -> raw / 1000f
                raw > 180f -> raw / 10f
                else -> raw
            }
            if (celsius in 5f..125f) celsius else null
        } catch (_: Throwable) {
            null
        }
    }

    private fun readBatteryTempC(): Float {
        return try {
            val intent = appContext.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            val tenths = intent?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Int.MIN_VALUE) ?: Int.MIN_VALUE
            if (tenths != Int.MIN_VALUE && tenths in 0..1000) tenths / 10f else 0f
        } catch (_: Throwable) {
            0f
        }
    }

    private fun registerApiThermalListenerIfSupported() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && powerManagerListener == null) {
            try {
                val pm = appContext.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
                powerManagerListener = Api29ThermalHelper.addListener(pm) { status ->
                    synchronized(lock) {
                        apiThermalStatus = status
                        currentThermalLevel = classifyThermalPressure(
                            cpuTempC = peakCpuTempC,
                            gpuTempC = peakGpuTempC,
                            batteryTempC = batteryTempC,
                            apiStatus = apiThermalStatus,
                            headroom = apiThermalHeadroom
                        )
                        evaluateWarningStateLocked(SystemClock.elapsedRealtime())
                    }
                }
            } catch (_: Throwable) {
                powerManagerListener = null
            }
        }
    }

    private fun unregisterApiThermalListenerIfSupported() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && powerManagerListener != null) {
            try {
                val pm = appContext.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
                Api29ThermalHelper.removeListener(pm, powerManagerListener!!)
            } catch (_: Throwable) {
                // Safe cleanup
            } finally {
                powerManagerListener = null
            }
        }
    }

    @RequiresApi(Build.VERSION_CODES.Q)
    private object Api29ThermalHelper {
        fun getCurrentThermalStatus(pm: PowerManager): Int {
            return try {
                pm.currentThermalStatus
            } catch (_: Throwable) {
                0
            }
        }

        fun addListener(pm: PowerManager, onStatusChanged: (Int) -> Unit): PowerManager.OnThermalStatusChangedListener {
            val listener = PowerManager.OnThermalStatusChangedListener { status ->
                onStatusChanged(status)
            }
            pm.addThermalStatusListener(listener)
            return listener
        }

        fun removeListener(pm: PowerManager, listener: Any) {
            (listener as? PowerManager.OnThermalStatusChangedListener)?.let {
                pm.removeThermalStatusListener(it)
            }
        }
    }

    @RequiresApi(Build.VERSION_CODES.R)
    private object Api30ThermalHelper {
        fun getThermalHeadroom(pm: PowerManager): Float {
            return try {
                val h = pm.getThermalHeadroom(5)
                if (h.isNaN()) 0f else h
            } catch (_: Throwable) {
                0f
            }
        }
    }
}
