package com.iii5412.expendbreak.widget

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.LocalSize
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.provideContent
import androidx.glance.action.clickable
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import com.iii5412.expendbreak.MainActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.text.NumberFormat
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import java.util.Locale

data class WidgetViewData(
    val state: String,
    val dailySafeAllowance: Long = 0,
    val remainingAllowance: Long = 0,
    val daysRemaining: Int = 0,
    val alertLevel: String = "safe",
    val calculatedAt: String = "",
)

class ExpendBreakWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val data = deriveWidgetViewData(WidgetStore.read(context))
        provideContent { WidgetContent(context, data) }
    }
}

class ExpendBreakWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = ExpendBreakWidget()
}

class RefreshWidgetAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: androidx.glance.action.ActionParameters) {
        ExpendBreakWidget().update(context, glanceId)
    }
}

object WidgetUpdater {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun updateAll(context: Context) {
        val appContext = context.applicationContext
        scope.launch {
            val manager = GlanceAppWidgetManager(appContext)
            manager.getGlanceIds(ExpendBreakWidget::class.java).forEach { id ->
                ExpendBreakWidget().update(appContext, id)
            }
        }
    }
}

fun deriveWidgetViewData(payload: StoredWidgetPayload?, now: Instant = Instant.now()): WidgetViewData {
    if (payload == null) return WidgetViewData("no_data")
    val snapshot = payload.snapshot
    val privacy = snapshot.optString("privacyMode", "unlock_required")
    if (privacy == "amounts_hidden") return WidgetViewData("hidden")

    val visibleUntil = snapshot.optString("visibleUntil").takeIf { it.isNotBlank() && it != "null" }
    val expired = visibleUntil?.let { runCatching { now.isAfter(Instant.parse(it)) }.getOrDefault(true) } ?: false
    if (privacy != "always_show" && (payload.locked || expired)) return WidgetViewData("locked")

    val calculatedAt = snapshot.optString("calculatedAt")
    val stale = runCatching { Duration.between(Instant.parse(calculatedAt), now).toHours() >= 24 }.getOrDefault(true)
    val endDate = runCatching { LocalDate.parse(snapshot.getString("periodEndDate")) }.getOrNull()
        ?: return WidgetViewData("no_data")
    val today = now.atZone(ZoneId.systemDefault()).toLocalDate()
    val daysRemaining = maxOf(1, ChronoUnit.DAYS.between(today, endDate).toInt() + 1)
    val remaining = snapshot.optLong("remainingAllowance")
    val daily = maxOf(0, remaining / daysRemaining)

    return WidgetViewData(
        state = if (stale) "stale" else "ready",
        dailySafeAllowance = daily,
        remainingAllowance = remaining,
        daysRemaining = daysRemaining,
        alertLevel = snapshot.optString("alertLevel", "safe"),
        calculatedAt = calculatedAt,
    )
}

@Composable
private fun WidgetContent(context: Context, data: WidgetViewData) {
    val wide = LocalSize.current.width >= 240.dp
    val colors = GlanceTheme.colors
    val homeIntent = Intent(context, MainActivity::class.java).apply {
        setData(Uri.parse("expendbreak://home"))
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val addIntent = Intent(context, MainActivity::class.java).apply {
        setData(Uri.parse("expendbreak://transaction/new"))
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }

    Column(
        modifier = GlanceModifier.fillMaxSize().background(colors.widgetBackground).padding(14.dp).clickable(actionStartActivity(homeIntent)),
    ) {
        Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.Vertical.CenterVertically) {
            Text("지출브레이크", style = TextStyle(color = colors.onSurface, fontWeight = FontWeight.Bold, fontSize = 13.sp))
            Spacer(modifier = GlanceModifier.width(8.dp))
            Text(statusLabel(data), style = TextStyle(color = statusColor(data), fontSize = 11.sp))
        }
        Spacer(modifier = GlanceModifier.height(10.dp))

        when (data.state) {
            "no_data" -> EmptyState("앱을 열어 설정해 주세요")
            "locked" -> EmptyState("잠금 해제 후 확인")
            "hidden" -> EmptyState("금액 숨김 · 앱에서 확인")
            else -> {
                Text("오늘 안전", style = TextStyle(color = colors.onSurfaceVariant, fontSize = 12.sp))
                Text(formatKrw(data.dailySafeAllowance), style = TextStyle(color = statusColor(data), fontWeight = FontWeight.Bold, fontSize = if (wide) 28.sp else 23.sp))
                Spacer(modifier = GlanceModifier.height(4.dp))
                Text("남은 ${formatKrw(data.remainingAllowance)} · ${data.daysRemaining}일", style = TextStyle(color = colors.onSurfaceVariant, fontSize = 11.sp), maxLines = 1)
                if (wide) {
                    Spacer(modifier = GlanceModifier.height(10.dp))
                    Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.Vertical.CenterVertically) {
                        Text(
                            "＋ 지출",
                            modifier = GlanceModifier.background(colors.surfaceVariant).padding(horizontal = 12.dp, vertical = 8.dp).clickable(actionStartActivity(addIntent)),
                            style = TextStyle(color = colors.onSurface, fontWeight = FontWeight.Bold, fontSize = 12.sp),
                        )
                        Spacer(modifier = GlanceModifier.width(8.dp))
                        Text(
                            "새로고침",
                            modifier = GlanceModifier.background(colors.surfaceVariant).padding(horizontal = 12.dp, vertical = 8.dp).clickable(actionRunCallback<RefreshWidgetAction>()),
                            style = TextStyle(color = colors.onSurfaceVariant, fontSize = 12.sp),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun EmptyState(message: String) {
    Spacer(modifier = GlanceModifier.height(12.dp))
    Text(message, style = TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontWeight = FontWeight.Bold, fontSize = 14.sp), maxLines = 2)
    Spacer(modifier = GlanceModifier.height(12.dp))
}

private fun statusLabel(data: WidgetViewData): String = when (data.state) {
    "stale" -> "갱신 필요"
    "locked" -> "잠김"
    "hidden" -> "비공개"
    "no_data" -> "설정 필요"
    else -> when (data.alertLevel) {
        "danger" -> "위험"
        "warning" -> "경고"
        "caution" -> "주의"
        else -> "안전"
    }
}

@Composable
private fun statusColor(data: WidgetViewData): ColorProvider = when {
    data.state == "stale" -> GlanceTheme.colors.secondary
    data.alertLevel == "danger" || data.alertLevel == "warning" -> GlanceTheme.colors.error
    data.alertLevel == "caution" -> GlanceTheme.colors.secondary
    else -> GlanceTheme.colors.primary
}

private fun formatKrw(value: Long): String = "${NumberFormat.getNumberInstance(Locale.KOREA).format(value)}원"
