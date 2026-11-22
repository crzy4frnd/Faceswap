package com.facemorph.studio.engine

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.ImageFormat
import android.graphics.Matrix
import androidx.camera.core.ImageProxy
import kotlinx.coroutines.channels.Channel
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.IntBuffer
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.max

/**
 * Lock-Free Circular Native-Buffer Ring Bridge between CameraX JNI/ImageProxy Planes and the ML Loop.
 *
 * Eliminates blocking I/O, JNI array pinning stalls, and Compose/RenderThread visual tearing via:
 *  1) A 4-slot Circular Direct ByteBuffer Staging Ring with atomic per-slot state transitions
 *     (FREE -> WRITING -> READY -> READING) so CameraX's native ByteBuffer planes copy straight
 *     into off-heap direct buffers without heap allocations or blocking mutexes, closing
 *     ImageProxy in < 1ms.
 *  2) Wait-free circular overwrite of stale unread frames when ML falls behind, maintaining
 *     accurate drop counts for thermal/frame-rate monitoring.
 *  3) Single-pass fused YUV420 -> Rotated/Mirrored RGBA into a pooled Direct Little-Endian
 *     ByteBuffer -> Bitmap.copyPixelsFromBuffer(...) (zero setPixels IntArray JNI pinning) onto
 *     a 2-slot consumer input Bitmap ring.
 *  4) A 4-slot Fenced Circular Output Bitmap Ring tracked against both Main-committed and
 *     RenderThread-in-flight frames so AR writes never tear an active display buffer.
 */
class AsyncCameraFrameBridge {

    private companion object {
        const val INGRESS_RING_CAPACITY = 4
        const val INPUT_BITMAP_RING_CAPACITY = 2
        const val OUTPUT_RING_CAPACITY = 4

        const val STATE_FREE = 0
        const val STATE_WRITING = 1
        const val STATE_READY = 2
        const val STATE_READING = 3
    }

    private class YuvRingSlot(val index: Int) {
        val state = AtomicInteger(STATE_FREE)
        var sequenceId: Long = 0L
        var timestampNs: Long = 0L
        var width: Int = 0
        var height: Int = 0
        var rotationDegrees: Int = 0
        var mirrorHorizontal: Boolean = false
        var isFallbackBitmap: Boolean = false

        var yDirect: ByteBuffer? = null
        var uDirect: ByteBuffer? = null
        var vDirect: ByteBuffer? = null
        var yLen: Int = 0
        var uLen: Int = 0
        var vLen: Int = 0
        var yRowStride: Int = 0
        var uRowStride: Int = 0
        var vRowStride: Int = 0
        var yPixelStride: Int = 1
        var uPixelStride: Int = 1
        var vPixelStride: Int = 1

        var fallbackBitmap: Bitmap? = null
    }

    data class DecodedCameraFrame(
        val bitmap: Bitmap,
        val width: Int,
        val height: Int,
        val sequenceId: Long,
        val droppedSinceLast: Int = 0
    )

    private val ingressRing = Array(INGRESS_RING_CAPACITY) { YuvRingSlot(it) }
    private var producerCursor = 0
    private val frameSequence = AtomicLong(0L)
    private val minValidSequence = AtomicLong(0L)
    private var lastConsumedSeq: Long = 0L
    private val released = AtomicBoolean(false)

    // Coalescing async wakeup signal: never queues stale backlog or blocks producer
    val frameSignal = Channel<Unit>(Channel.CONFLATED)

    // Single-consumer reusable native transfer & decode buffers
    private var yWorkBytes: ByteArray = ByteArray(0)
    private var uWorkBytes: ByteArray = ByteArray(0)
    private var vWorkBytes: ByteArray = ByteArray(0)
    private var rgbaDirectBuffer: ByteBuffer? = null
    private var rgbaIntView: IntBuffer? = null

    // 2-slot consumer input Bitmap circular ring (protects async MLKit / previous frame inspection)
    private val consumerInputRing = arrayOfNulls<Bitmap>(INPUT_BITMAP_RING_CAPACITY)
    private var consumerInputIndex = 0

    // 4-slot fenced circular output ring (prevents RenderThread tearing on rapid AR commits)
    private val outputRing = arrayOfNulls<Bitmap>(OUTPUT_RING_CAPACITY)
    private var outputRingIndex = 0
    private val lastCommittedOutput = AtomicReference<Bitmap?>(null)
    private val activeUiOutput = AtomicReference<Bitmap?>(null)
    private val previousUiOutput = AtomicReference<Bitmap?>(null)

    /**
     * Called on the CameraX ImageAnalysis executor.
     * Claims a free (or oldest stale) circular ring slot wait-free, copies native ByteBuffer planes
     * directly off-heap, publishes READY atomically, and closes ImageProxy immediately.
     */
    fun submitImageProxy(imageProxy: ImageProxy, mirrorHorizontal: Boolean) {
        try {
            if (released.get()) return
            val slot = claimProducerSlot() ?: return

            slot.width = imageProxy.width
            slot.height = imageProxy.height
            slot.timestampNs = imageProxy.imageInfo.timestamp
            slot.rotationDegrees = ((imageProxy.imageInfo.rotationDegrees % 360) + 360) % 360
            slot.mirrorHorizontal = mirrorHorizontal

            val planes = imageProxy.planes
            if (imageProxy.format == ImageFormat.YUV_420_888 && planes.size >= 3) {
                slot.isFallbackBitmap = false

                val pY = planes[0]
                val pU = planes[1]
                val pV = planes[2]

                val bY = pY.buffer.duplicate().apply { rewind() }
                val bU = pU.buffer.duplicate().apply { rewind() }
                val bV = pV.buffer.duplicate().apply { rewind() }

                val yNeed = bY.remaining()
                val uNeed = bU.remaining()
                val vNeed = bV.remaining()

                val dstY = ensureDirectBuffer(slot.yDirect, yNeed).also { slot.yDirect = it }
                val dstU = ensureDirectBuffer(slot.uDirect, uNeed).also { slot.uDirect = it }
                val dstV = ensureDirectBuffer(slot.vDirect, vNeed).also { slot.vDirect = it }

                dstY.clear()
                dstY.put(bY)
                dstY.flip()

                dstU.clear()
                dstU.put(bU)
                dstU.flip()

                dstV.clear()
                dstV.put(bV)
                dstV.flip()

                slot.yLen = yNeed
                slot.uLen = uNeed
                slot.vLen = vNeed
                slot.yRowStride = pY.rowStride
                slot.uRowStride = pU.rowStride
                slot.vRowStride = pV.rowStride
                slot.yPixelStride = max(1, pY.pixelStride)
                slot.uPixelStride = max(1, pU.pixelStride)
                slot.vPixelStride = max(1, pV.pixelStride)
            } else {
                slot.isFallbackBitmap = true
                val rawBmp = imageProxy.toBitmap()
                val rotated = if (slot.rotationDegrees != 0 || mirrorHorizontal) {
                    val m = Matrix().apply {
                        if (slot.rotationDegrees != 0) postRotate(slot.rotationDegrees.toFloat())
                        if (mirrorHorizontal) postScale(-1f, 1f)
                    }
                    Bitmap.createBitmap(rawBmp, 0, 0, rawBmp.width, rawBmp.height, m, true).also {
                        if (it !== rawBmp) rawBmp.recycle()
                    }
                } else {
                    rawBmp
                }
                val prevFb = slot.fallbackBitmap
                if (prevFb != null && !prevFb.isRecycled) prevFb.recycle()
                slot.fallbackBitmap = rotated
            }

            slot.sequenceId = frameSequence.incrementAndGet()
            slot.state.set(STATE_READY)
            frameSignal.trySend(Unit)
        } finally {
            imageProxy.close()
        }
    }

    private fun claimProducerSlot(): YuvRingSlot? {
        // Pass 1: Claim the next FREE slot along the circular write cursor
        for (offset in 0 until INGRESS_RING_CAPACITY) {
            val idx = (producerCursor + offset) % INGRESS_RING_CAPACITY
            val candidate = ingressRing[idx]
            if (candidate.state.compareAndSet(STATE_FREE, STATE_WRITING)) {
                producerCursor = (idx + 1) % INGRESS_RING_CAPACITY
                return candidate
            }
        }

        // Pass 2: Ring full of unread READY frames -> overwrite oldest stale READY slot wait-free
        var oldestIdx = -1
        var oldestSeq = Long.MAX_VALUE
        for (idx in 0 until INGRESS_RING_CAPACITY) {
            val s = ingressRing[idx]
            if (s.state.get() == STATE_READY && s.sequenceId < oldestSeq) {
                oldestSeq = s.sequenceId
                oldestIdx = idx
            }
        }
        if (oldestIdx >= 0 && ingressRing[oldestIdx].state.compareAndSet(STATE_READY, STATE_WRITING)) {
            producerCursor = (oldestIdx + 1) % INGRESS_RING_CAPACITY
            return ingressRing[oldestIdx]
        }

        // Pass 3: Edge retry for a just-freed slot
        for (idx in 0 until INGRESS_RING_CAPACITY) {
            val candidate = ingressRing[idx]
            if (candidate.state.compareAndSet(STATE_FREE, STATE_WRITING)) {
                producerCursor = (idx + 1) % INGRESS_RING_CAPACITY
                return candidate
            }
        }
        return null
    }

    /**
     * Called exclusively by the asynchronous ML consumer coroutine.
     * Picks the newest READY circular ring slot, transitions it atomically to READING,
     * copies direct native buffers out and releases the ring slot back to FREE BEFORE decoding,
     * then converts YUV -> Rotated/Mirrored RGBA directly into native Bitmap backing memory.
     */
    fun acquireLatestDecodedFrame(): DecodedCameraFrame? {
        if (released.get()) return null

        val minSeq = max(lastConsumedSeq, minValidSequence.get())
        var chosenSlot: YuvRingSlot? = null
        var chosenSeq = minSeq

        // Try claiming newest READY slot (retry if producer steals an older one mid-scan)
        for (attempt in 0 until INGRESS_RING_CAPACITY) {
            var bestIdx = -1
            var bestSeq = minSeq
            for (idx in 0 until INGRESS_RING_CAPACITY) {
                val candidate = ingressRing[idx]
                if (candidate.state.get() == STATE_READY && candidate.sequenceId > bestSeq) {
                    bestSeq = candidate.sequenceId
                    bestIdx = idx
                }
            }
            if (bestIdx < 0) return null
            val candidate = ingressRing[bestIdx]
            if (candidate.state.compareAndSet(STATE_READY, STATE_READING)) {
                chosenSlot = candidate
                chosenSeq = candidate.sequenceId
                break
            }
        }
        val slot = chosenSlot ?: return null

        // Reclaim superseded older READY slots immediately into FREE pool
        for (idx in 0 until INGRESS_RING_CAPACITY) {
            val other = ingressRing[idx]
            if (other !== slot && other.state.get() == STATE_READY && other.sequenceId < chosenSeq) {
                other.state.compareAndSet(STATE_READY, STATE_FREE)
            }
        }

        val prevSeq = lastConsumedSeq
        lastConsumedSeq = chosenSeq
        val droppedCount = if (prevSeq > 0L) (chosenSeq - prevSeq - 1L).coerceIn(0L, 60L).toInt() else 0

        if (slot.isFallbackBitmap) {
            val fb = slot.fallbackBitmap
            if (fb == null || fb.isRecycled) {
                slot.state.set(STATE_FREE)
                return null
            }
            val w = fb.width
            val h = fb.height
            val outBmp = acquireConsumerInputBitmap(w, h)
            val c = Canvas(outBmp)
            c.drawBitmap(fb, 0f, 0f, null)
            slot.state.set(STATE_FREE)
            return DecodedCameraFrame(outBmp, w, h, chosenSeq, droppedCount)
        }

        val srcW = slot.width
        val srcH = slot.height
        val rot = slot.rotationDegrees
        val mirror = slot.mirrorHorizontal
        val yLen = slot.yLen
        val uLen = slot.uLen
        val vLen = slot.vLen
        val yRowStride = slot.yRowStride
        val uRowStride = slot.uRowStride
        val vRowStride = slot.vRowStride
        val yPixStride = slot.yPixelStride
        val uPixStride = slot.uPixelStride
        val vPixStride = slot.vPixelStride

        if (srcW <= 1 || srcH <= 1 || yLen <= 0) {
            slot.state.set(STATE_FREE)
            return null
        }

        if (yWorkBytes.size < yLen) yWorkBytes = ByteArray(yLen)
        if (uWorkBytes.size < uLen) uWorkBytes = ByteArray(uLen)
        if (vWorkBytes.size < vLen) vWorkBytes = ByteArray(vLen)

        slot.yDirect?.let { buf ->
            buf.rewind()
            buf.get(yWorkBytes, 0, yLen)
        }
        slot.uDirect?.let { buf ->
            buf.rewind()
            buf.get(uWorkBytes, 0, uLen)
        }
        slot.vDirect?.let { buf ->
            buf.rewind()
            buf.get(vWorkBytes, 0, vLen)
        }

        // Release ingress circular ring slot back to producer BEFORE YUV decode & ML inference!
        slot.state.set(STATE_FREE)

        val swapDims = (rot == 90 || rot == 270)
        val dstW = if (swapDims) srcH else srcW
        val dstH = if (swapDims) srcW else srcH
        val totalPixels = dstW * dstH
        val directRgba = ensureRgbaDirectBuffer(totalPixels)
        directRgba.clear()
        val intView = rgbaIntView ?: directRgba.asIntBuffer().also { rgbaIntView = it }

        decodeYuv420ToDirectRgba(
            yBytes = yWorkBytes,
            uBytes = uWorkBytes,
            vBytes = vWorkBytes,
            yLen = yLen,
            uLen = uLen,
            vLen = vLen,
            yRowStride = yRowStride,
            uRowStride = uRowStride,
            vRowStride = vRowStride,
            yPixStride = yPixStride,
            uPixStride = uPixStride,
            vPixStride = vPixStride,
            srcW = srcW,
            srcH = srcH,
            dstW = dstW,
            dstH = dstH,
            rotDeg = rot,
            mirrorH = mirror,
            outRgbaInts = intView
        )

        directRgba.position(0)
        directRgba.limit(totalPixels * 4)
        val outBmp = acquireConsumerInputBitmap(dstW, dstH)
        outBmp.copyPixelsFromBuffer(directRgba)
        return DecodedCameraFrame(outBmp, dstW, dstH, chosenSeq, droppedCount)
    }

    /**
     * Marks an AR output Bitmap as committed from the ML loop before scheduling Main display update.
     */
    fun markOutputCommitted(bitmap: Bitmap) {
        lastCommittedOutput.set(bitmap)
    }

    /**
     * Marks the Bitmap now bound into Compose state on Main so the prior display frame remains
     * write-fenced until the next frame swap completes (prevents GPU/RenderThread tearing).
     */
    fun markOutputPresented(bitmap: Bitmap) {
        val prev = activeUiOutput.getAndSet(bitmap)
        if (prev != null && prev !== bitmap) {
            previousUiOutput.set(prev)
        }
    }

    /**
     * Acquires a pooled mutable ARGB_8888 Bitmap from the 4-slot output circular ring that is
     * guaranteed not to alias any committed, active, or RenderThread-trailing frame.
     */
    fun acquireReusableOutputBitmap(w: Int, h: Int, currentlyDisplayed: Bitmap?): Bitmap {
        val committed = lastCommittedOutput.get()
        val uiActive = activeUiOutput.get()
        val uiPrev = previousUiOutput.get()

        fun isProtected(bmp: Bitmap): Boolean {
            return bmp === currentlyDisplayed || bmp === committed || bmp === uiActive || bmp === uiPrev
        }

        for (attempt in 0 until OUTPUT_RING_CAPACITY) {
            val idx = (outputRingIndex + attempt) % OUTPUT_RING_CAPACITY
            val candidate = outputRing[idx]
            if (candidate != null && !candidate.isRecycled &&
                candidate.isMutable &&
                candidate.width == w && candidate.height == h &&
                !isProtected(candidate)
            ) {
                outputRingIndex = (idx + 1) % OUTPUT_RING_CAPACITY
                return candidate
            }
        }

        val fresh = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        var storeIdx = outputRingIndex
        for (offset in 0 until OUTPUT_RING_CAPACITY) {
            val probeIdx = (outputRingIndex + offset) % OUTPUT_RING_CAPACITY
            val existing = outputRing[probeIdx]
            if (existing == null || !isProtected(existing)) {
                storeIdx = probeIdx
                break
            }
        }
        outputRing[storeIdx] = fresh
        outputRingIndex = (storeIdx + 1) % OUTPUT_RING_CAPACITY
        return fresh
    }

    fun resetSequenceForCameraSwitch() {
        val cur = frameSequence.get()
        minValidSequence.set(cur)
        lastConsumedSeq = cur
        for (slot in ingressRing) {
            if (slot.state.get() == STATE_READY) {
                slot.state.compareAndSet(STATE_READY, STATE_FREE)
            }
        }
    }

    fun release() {
        if (!released.compareAndSet(false, true)) return
        frameSignal.close()
        for (slot in ingressRing) {
            slot.state.set(STATE_FREE)
            slot.yDirect = null
            slot.uDirect = null
            slot.vDirect = null
            slot.fallbackBitmap?.let { if (!it.isRecycled) it.recycle() }
            slot.fallbackBitmap = null
        }
        for (i in consumerInputRing.indices) {
            consumerInputRing[i] = null
        }
        lastCommittedOutput.set(null)
        activeUiOutput.set(null)
        previousUiOutput.set(null)
        rgbaDirectBuffer = null
        rgbaIntView = null
    }

    private fun acquireConsumerInputBitmap(w: Int, h: Int): Bitmap {
        val idx = consumerInputIndex
        consumerInputIndex = (consumerInputIndex + 1) % INPUT_BITMAP_RING_CAPACITY
        val existing = consumerInputRing[idx]
        if (existing != null && !existing.isRecycled && existing.width == w && existing.height == h) {
            return existing
        }
        val fresh = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        consumerInputRing[idx] = fresh
        return fresh
    }

    private fun ensureDirectBuffer(existing: ByteBuffer?, neededBytes: Int): ByteBuffer {
        if (existing != null && existing.capacity() >= neededBytes) {
            return existing
        }
        val cap = max(neededBytes, 1024)
        return ByteBuffer.allocateDirect(cap).order(ByteOrder.nativeOrder())
    }

    private fun ensureRgbaDirectBuffer(totalPixels: Int): ByteBuffer {
        val neededBytes = totalPixels * 4
        val existing = rgbaDirectBuffer
        if (existing != null && existing.capacity() >= neededBytes) {
            return existing
        }
        val fresh = ByteBuffer.allocateDirect(neededBytes).order(ByteOrder.LITTLE_ENDIAN)
        rgbaDirectBuffer = fresh
        rgbaIntView = fresh.asIntBuffer()
        return fresh
    }

    /**
     * Single-pass cache-friendly BT.601 integer YUV_420_888 -> Rotated & Mirrored RGBA_8888
     * straight into a little-endian Direct Native IntBuffer (no Skia R/B swizzle on upload).
     */
    private fun decodeYuv420ToDirectRgba(
        yBytes: ByteArray,
        uBytes: ByteArray,
        vBytes: ByteArray,
        yLen: Int,
        uLen: Int,
        vLen: Int,
        yRowStride: Int,
        uRowStride: Int,
        vRowStride: Int,
        yPixStride: Int,
        uPixStride: Int,
        vPixStride: Int,
        srcW: Int,
        srcH: Int,
        dstW: Int,
        dstH: Int,
        rotDeg: Int,
        mirrorH: Boolean,
        outRgbaInts: IntBuffer
    ) {
        val mode = ((rotDeg / 90) and 3) * 2 + (if (mirrorH) 1 else 0)
        val srcWMinus1 = srcW - 1
        val srcHMinus1 = srcH - 1
        outRgbaInts.clear()

        var dstRowOffset = 0
        for (dy in 0 until dstH) {
            for (dx in 0 until dstW) {
                val sx: Int
                val sy: Int
                when (mode) {
                    0 -> { sx = dx; sy = dy }
                    1 -> { sx = srcWMinus1 - dx; sy = dy }
                    2 -> { sx = dy; sy = srcHMinus1 - dx }
                    3 -> { sx = dy; sy = dx }
                    4 -> { sx = srcWMinus1 - dx; sy = srcHMinus1 - dy }
                    5 -> { sx = dx; sy = srcHMinus1 - dy }
                    6 -> { sx = srcWMinus1 - dy; sy = dx }
                    else -> { sx = srcWMinus1 - dy; sy = srcHMinus1 - dx }
                }

                val yIdx = sy * yRowStride + sx * yPixStride
                val yVal = if (yIdx in 0 until yLen) (yBytes[yIdx].toInt() and 0xFF) else 0

                val uvX = sx ushr 1
                val uvY = sy ushr 1
                val uIdx = uvY * uRowStride + uvX * uPixStride
                val vIdx = uvY * vRowStride + uvX * vPixStride

                val u = if (uIdx in 0 until uLen) (uBytes[uIdx].toInt() and 0xFF) - 128 else 0
                val v = if (vIdx in 0 until vLen) (vBytes[vIdx].toInt() and 0xFF) - 128 else 0

                var r = yVal + ((1436 * v) shr 10)
                var g = yVal - ((352 * u + 731 * v) shr 10)
                var b = yVal + ((1815 * u) shr 10)

                if (r < 0) r = 0 else if (r > 255) r = 255
                if (g < 0) g = 0 else if (g > 255) g = 255
                if (b < 0) b = 0 else if (b > 255) b = 255

                // Little-endian RGBA memory layout [R, G, B, A] expected by Bitmap.copyPixelsFromBuffer
                outRgbaInts.put(dstRowOffset + dx, (0xFF shl 24) or (b shl 16) or (g shl 8) or r)
            }
            dstRowOffset += dstW
        }
    }
}
