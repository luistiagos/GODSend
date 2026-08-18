package com.godsend.app.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import com.godsend.app.MainActivity
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import kotlin.concurrent.thread

class GodsendBackendService : Service() {

    private var wakeLock: PowerManager.WakeLock? = null
    private var backendProcess: Process? = null

    companion object {
        const val CHANNEL_ID = "GODsendBackendChannel"
        const val NOTIFICATION_ID = 1001
        const val TAG = "GodsendBackendService"

        fun startService(context: Context) {
            val intent = Intent(context, GodsendBackendService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stopService(context: Context) {
            val intent = Intent(context, GodsendBackendService::class.java)
            context.stopService(intent)
        }
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        acquireWakeLock()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = buildNotification("Serviço GODsend-360 Backend em execução")
        startForeground(NOTIFICATION_ID, notification)

        startGoBackend()

        return START_STICKY
    }

    private fun startGoBackend() {
        thread(start = true, name = "GoBackendRunner") {
            try {
                val dataDir = File(filesDir, "godsend")
                if (!dataDir.exists()) dataDir.mkdirs()

                val nativeBinary = File(applicationInfo.nativeLibraryDir, "libgodsend.so")
                val binaryFile = if (nativeBinary.exists()) {
                    Log.i(TAG, "Usando binário nativo extraído em: ${nativeBinary.absolutePath}")
                    nativeBinary
                } else {
                    val fallback = File(codeCacheDir, "godsend-backend")
                    if (!fallback.exists()) copyAssetBinary(fallback)
                    fallback.setExecutable(true, false)
                    try { Runtime.getRuntime().exec("chmod 755 ${fallback.absolutePath}").waitFor() } catch (_: Exception) {}
                    fallback
                }

                val pb = ProcessBuilder(binaryFile.absolutePath)
                val env = pb.environment()
                env["GODSEND_HOME"] = dataDir.absolutePath
                env["GODSEND_PORT"] = "8080"
                env["GODSEND_TRANSFER"] = File(getExternalFilesDir(null), "Transfer").absolutePath

                pb.directory(dataDir)
                pb.redirectErrorStream(true)

                Log.i(TAG, "Iniciando backend Go em: ${binaryFile.absolutePath}")
                backendProcess = pb.start()

                // Ler saída do processo para os logs do Android (Logcat)
                val reader = backendProcess?.inputStream?.bufferedReader()
                reader?.forEachLine { line ->
                    Log.d("GoBackend", line)
                }

                val exitCode = backendProcess?.waitFor()
                Log.w(TAG, "Backend Go finalizado com código: $exitCode")

            } catch (e: Exception) {
                Log.e(TAG, "Erro ao executar backend Go", e)
            }
        }
    }

    private fun copyAssetBinary(targetFile: File) {
        val abi = Build.SUPPORTED_ABIS.firstOrNull() ?: "arm64-v8a"
        val assetName = if (abi.contains("x86_64")) "godsend-android-amd64" else "godsend-android-arm64"

        try {
            assets.open(assetName).use { input ->
                FileOutputStream(targetFile).use { output ->
                    input.copyTo(output)
                }
            }
            Log.i(TAG, "Copiado binário do Go ($assetName) para ${targetFile.absolutePath}")
        } catch (e: Exception) {
            Log.w(TAG, "Binário $assetName não encontrado nos assets. Tentando cópia genérica.")
        }
    }

    private fun acquireWakeLock() {
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "GODsend360::BackendServiceWakeLock"
        ).apply {
            acquire(24 * 60 * 60 * 1000L) // Timeout máximo de 24 horas
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "GODsend-360 Backend",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Mantém o servidor GODsend-360 ativo em segundo plano"
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(contentText: String): Notification {
        val notificationIntent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, notificationIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("GODsend-360 Ativo")
            .setContentText(contentText)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
    }

    override fun onDestroy() {
        super.onDestroy()
        backendProcess?.destroy()
        if (wakeLock?.isHeld == true) {
            wakeLock?.release()
        }
        Log.i(TAG, "GodsendBackendService finalizado")
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
