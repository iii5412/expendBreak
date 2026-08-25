package com.iii5412.expendbreak.widget

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalSize
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.appwidget.provideContent
import androidx.glance.action.clickable
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.ContentScale
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import com.iii5412.expendbreak.MainActivity
import com.iii5412.expendbreak.R
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

/** Chips beyond this do not fit any widget size worth rendering. */
private const val MAX_QUICK_ENTRY_CHIPS = 4

/** 2x2 and smaller: only the headline figure fits. */
private val SMALL_WIDGET = DpSize(110.dp, 110.dp)
/** 4x2: the primary, intentionally designed widget size. */
private val MEDIUM_WIDGET = DpSize(250.dp, 110.dp)
/** 4x3 and larger: room for four quick entry chips. */
private val LARGE_WIDGET = DpSize(240.dp, 180.dp)

data class WidgetQuickEntry(
    val id: String,
    val label: String,
    /** null records nothing on its own; the app collects the amount first. */
    val amount: Long?,
)

data class WidgetViewData(
    val state: String,
    val dailySafeAllowance: Long = 0,
    val remainingAllowance: Long = 0,
    val daysRemaining: Int = 0,
    val alertLevel: String = "safe",
    val calculatedAt: String = "",
    val quickEntries: List<WidgetQuickEntry> = emptyList(),
)

class ExpendBreakWidget : GlanceAppWidget() {
    // Exact mode recomposes for every pixel size the launcher reports, which
    // made one fixed layout overflow the small sizes. Responsive lets each
    // bucket state its own type scale and padding instead of clipping.
    override val sizeMode = SizeMode.Responsive(
        setOf(SMALL_WIDGET, MEDIUM_WIDGET, LARGE_WIDGET),
    )

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
        quickEntries = parseQuickEntries(snapshot),
    )
}

/**
 * Reads the quick entry chips out of a snapshot.
 *
 * Older snapshots have no `quickEntries` key at all, and a widget that survives
 * an app downgrade still has to render, so anything unparseable is simply
 * dropped rather than failing the whole payload.
 */
private fun parseQuickEntries(snapshot: JSONObject): List<WidgetQuickEntry> {
    val array = snapshot.optJSONArray("quickEntries") ?: return emptyList()
    val entries = mutableListOf<WidgetQuickEntry>()
    for (index in 0 until minOf(array.length(), MAX_QUICK_ENTRY_CHIPS)) {
        val item = array.optJSONObject(index) ?: continue
        val id = item.optString("id")
        val label = item.optString("label")
        if (id.isBlank() || label.isBlank()) continue
        entries.add(
            WidgetQuickEntry(
                id = id,
                label = label,
                amount = if (item.isNull("amount")) null else item.optLong("amount"),
            ),
        )
    }
    return entries
}

private fun deepLinkIntent(context: Context, uri: String) = Intent(context, MainActivity::class.java).apply {
    setData(Uri.parse(uri))
    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
}

@Composable
private fun WidgetContent(context: Context, data: WidgetViewData) {
    val size = LocalSize.current
    val wide = size.width >= MEDIUM_WIDGET.width
    val tall = size.height >= LARGE_WIDGET.height
    val colors = GlanceTheme.colors

    val pad = if (wide) 12.dp else 10.dp
    val gap = if (tall) 7.dp else 6.dp

    Column(
        modifier = GlanceModifier
            .fillMaxSize()
            .background(ImageProvider(R.drawable.widget_background), ContentScale.FillBounds)
            .appWidgetBackground()
            .padding(pad)
            .clickable(actionStartActivity(deepLinkIntent(context, "expendbreak://home"))),
    ) {
        WidgetHeader(context, data, wide)
        Spacer(modifier = GlanceModifier.height(gap))

        when (data.state) {
            "no_data" -> EmptyState("앱을 열어 설정해 주세요")
            "locked" -> EmptyState("잠금 해제 후 확인")
            "hidden" -> EmptyState("금액 숨김 · 앱에서 확인")
            else -> {
                if (wide && !tall) {
                    MediumContent(context, data)
                } else {
                    BudgetSummary(data, wide)
                }

                if (tall && data.quickEntries.isNotEmpty()) {
                    Spacer(modifier = GlanceModifier.height(gap))
                    Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.Vertical.CenterVertically) {
                        Text(
                            "빠른 지출",
                            style = TextStyle(
                                color = colors.onSurfaceVariant,
                                fontWeight = FontWeight.Bold,
                                fontSize = 10.sp,
                            ),
                            maxLines = 1,
                        )
                        Spacer(modifier = GlanceModifier.defaultWeight())
                        Text(
                            "${data.quickEntries.size}개",
                            style = TextStyle(color = colors.onSurfaceVariant, fontSize = 9.sp),
                            maxLines = 1,
                        )
                    }
                    Spacer(modifier = GlanceModifier.height(4.dp))
                    QuickEntryChips(context, data.quickEntries)
                }
                if (tall && data.quickEntries.isEmpty()) {
                    Spacer(modifier = GlanceModifier.height(gap))
                    ActionRow(context)
                }
            }
        }
    }
}

@Composable
private fun WidgetHeader(context: Context, data: WidgetViewData, wide: Boolean) {
    val colors = GlanceTheme.colors
    Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.Vertical.CenterVertically) {
        Image(
            provider = ImageProvider(R.drawable.ic_widget_mark),
            contentDescription = null,
            modifier = GlanceModifier.size(20.dp),
        )
        Spacer(modifier = GlanceModifier.width(6.dp))
        Text(
            if (wide) "지출브레이크" else "생활비",
            style = TextStyle(color = colors.onSurface, fontWeight = FontWeight.Bold, fontSize = 12.sp),
            maxLines = 1,
        )
        Spacer(modifier = GlanceModifier.defaultWeight())
        Text(
            statusLabel(data),
            modifier = GlanceModifier
                .background(statusBackground(data), ContentScale.FillBounds)
                .padding(horizontal = 8.dp, vertical = 4.dp)
                .clickable(actionRunCallback<RefreshWidgetAction>()),
            style = TextStyle(color = statusColor(data), fontWeight = FontWeight.Bold, fontSize = 9.sp),
            maxLines = 1,
        )
        if (wide) {
            Spacer(modifier = GlanceModifier.width(5.dp))
            Text(
                "＋  기록",
                modifier = GlanceModifier
                    .background(ImageProvider(R.drawable.widget_accent_button), ContentScale.FillBounds)
                    .padding(horizontal = 9.dp, vertical = 4.dp)
                    .clickable(actionStartActivity(deepLinkIntent(context, "expendbreak://transaction/new"))),
                style = TextStyle(color = ColorProvider(android.graphics.Color.WHITE), fontWeight = FontWeight.Bold, fontSize = 9.sp),
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun BudgetSummary(data: WidgetViewData, wide: Boolean) {
    val colors = GlanceTheme.colors
    Text(
        "오늘 사용 가능",
        style = TextStyle(color = colors.onSurfaceVariant, fontWeight = FontWeight.Medium, fontSize = 10.sp),
        maxLines = 1,
    )
    Spacer(modifier = GlanceModifier.height(1.dp))
    Text(
        formatKrw(data.dailySafeAllowance),
        style = TextStyle(
            color = statusColor(data),
            fontWeight = FontWeight.Bold,
            fontSize = if (wide) 22.sp else 19.sp,
        ),
        maxLines = 1,
    )
    Spacer(modifier = GlanceModifier.height(1.dp))
    Text(
        "잔액 ${formatKrw(data.remainingAllowance)} · ${data.daysRemaining}일 남음",
        style = TextStyle(color = colors.onSurfaceVariant, fontSize = 9.sp),
        maxLines = 1,
    )
}

/** 4x2 has only one row of vertical space, so information and actions share it. */
@Composable
private fun MediumContent(context: Context, data: WidgetViewData) {
    val colors = GlanceTheme.colors
    Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.Vertical.CenterVertically) {
        Column(modifier = GlanceModifier.defaultWeight()) {
            BudgetSummary(data, true)
        }
        Spacer(modifier = GlanceModifier.width(8.dp))
        Column(
            modifier = GlanceModifier
                .width(104.dp)
                .background(ImageProvider(R.drawable.widget_panel), ContentScale.FillBounds)
                .padding(horizontal = 8.dp, vertical = 6.dp),
        ) {
            Text(
                "빠른 기록",
                style = TextStyle(color = colors.onSurfaceVariant, fontWeight = FontWeight.Medium, fontSize = 8.sp),
                maxLines = 1,
            )
            Spacer(modifier = GlanceModifier.height(3.dp))
            if (data.quickEntries.isEmpty()) {
                Text(
                    "＋  지출 추가",
                    modifier = GlanceModifier
                        .fillMaxWidth()
                        .background(ImageProvider(R.drawable.widget_accent_button), ContentScale.FillBounds)
                        .padding(horizontal = 8.dp, vertical = 6.dp)
                        .clickable(actionStartActivity(deepLinkIntent(context, "expendbreak://transaction/new"))),
                    style = TextStyle(color = ColorProvider(android.graphics.Color.WHITE), fontWeight = FontWeight.Bold, fontSize = 9.sp),
                    maxLines = 1,
                )
            } else {
                data.quickEntries.take(2).forEachIndexed { index, entry ->
                    if (index > 0) Spacer(modifier = GlanceModifier.height(4.dp))
                    QuickEntryChip(context, entry, compact = true, modifier = GlanceModifier.fillMaxWidth())
                }
            }
        }
    }
}

/**
 * Up to two chips per row. Glance has no wrapping layout, so the rows are built
 * explicitly rather than relying on a flow.
 */
@Composable
private fun QuickEntryChips(context: Context, entries: List<WidgetQuickEntry>) {
    entries.chunked(2).forEachIndexed { rowIndex, row ->
        if (rowIndex > 0) Spacer(modifier = GlanceModifier.height(6.dp))
        Row(modifier = GlanceModifier.fillMaxWidth()) {
            row.forEachIndexed { columnIndex, entry ->
                if (columnIndex > 0) Spacer(modifier = GlanceModifier.width(6.dp))
                QuickEntryChip(context, entry, compact = false, modifier = GlanceModifier.defaultWeight())
            }
            // A lone chip should not stretch across the whole widget.
            if (row.size == 1) {
                Spacer(modifier = GlanceModifier.width(6.dp))
                Spacer(modifier = GlanceModifier.defaultWeight())
            }
        }
    }
}

@Composable
private fun QuickEntryChip(
    context: Context,
    entry: WidgetQuickEntry,
    compact: Boolean,
    modifier: GlanceModifier = GlanceModifier,
) {
    val colors = GlanceTheme.colors
    Text(
        "${if (entry.amount == null) "₩" else "＋"} ${entry.label}",
        modifier = modifier
            .background(ImageProvider(R.drawable.widget_chip), ContentScale.FillBounds)
            .padding(horizontal = if (compact) 7.dp else 9.dp, vertical = if (compact) 4.dp else 6.dp)
            .clickable(
                actionStartActivity(
                    deepLinkIntent(context, "expendbreak://quick/${entry.id}"),
                ),
            ),
        style = TextStyle(
            color = colors.onSurface,
            fontWeight = FontWeight.Bold,
            fontSize = if (compact) 9.sp else 10.sp,
        ),
        maxLines = 1,
    )
}

@Composable
private fun ActionRow(context: Context) {
    val colors = GlanceTheme.colors
    Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.Vertical.CenterVertically) {
        Text(
            "＋ 지출",
            modifier = GlanceModifier
                .background(ImageProvider(R.drawable.widget_accent_button), ContentScale.FillBounds)
                .padding(horizontal = 12.dp, vertical = 8.dp)
                .clickable(actionStartActivity(deepLinkIntent(context, "expendbreak://transaction/new"))),
            style = TextStyle(color = ColorProvider(android.graphics.Color.WHITE), fontWeight = FontWeight.Bold, fontSize = 12.sp),
            maxLines = 1,
        )
        Spacer(modifier = GlanceModifier.width(8.dp))
        Text(
            "새로고침",
            modifier = GlanceModifier
                .background(ImageProvider(R.drawable.widget_chip), ContentScale.FillBounds)
                .padding(horizontal = 12.dp, vertical = 8.dp)
                .clickable(actionRunCallback<RefreshWidgetAction>()),
            style = TextStyle(color = colors.onSurfaceVariant, fontSize = 12.sp),
            maxLines = 1,
        )
    }
}

@Composable
private fun EmptyState(message: String) {
    Text(
        message,
        style = TextStyle(
            color = GlanceTheme.colors.onSurfaceVariant,
            fontWeight = FontWeight.Bold,
            fontSize = 13.sp,
        ),
        maxLines = 3,
    )
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

private fun statusBackground(data: WidgetViewData): ImageProvider = ImageProvider(
    when {
        data.state == "stale" || data.state == "locked" || data.state == "hidden" || data.state == "no_data" ->
            R.drawable.widget_status_neutral
        data.alertLevel == "danger" || data.alertLevel == "warning" -> R.drawable.widget_status_danger
        data.alertLevel == "caution" -> R.drawable.widget_status_caution
        else -> R.drawable.widget_status_safe
    },
)

private fun formatKrw(value: Long): String = "${NumberFormat.getNumberInstance(Locale.KOREA).format(value)}원"
