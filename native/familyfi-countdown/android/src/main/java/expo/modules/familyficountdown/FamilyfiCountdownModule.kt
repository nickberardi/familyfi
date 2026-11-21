package expo.modules.familyficountdown

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/**
 * The countdown (`Countdown`) for JavaScript. An app may also post it from its own native code, as
 * FamilyFi Me does from an alarm: its module depends on this one's Gradle project.
 */
class FamilyfiCountdownModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext)

  override fun definition() = ModuleDefinition {
    Name("FamilyfiCountdown")

    Function("enabled") { Countdown.enabled(context) }

    Function("running") { Countdown.running(context) }

    AsyncFunction("show") { spec: CountdownRecord ->
      Countdown.post(
        context,
        Countdown.Spec(spec.tag, spec.title, spec.text, spec.until.toLong(), spec.url, spec.actions.map { Countdown.Action(it.label, it.url) }),
        spec.channelName,
        spec.channelDescription,
      )
    }

    AsyncFunction("end") { tag: String -> Countdown.cancel(context, tag) }
  }

  class ActionRecord : Record {
    @Field val label: String = ""
    @Field val url: String = ""
  }

  class CountdownRecord : Record {
    @Field val tag: String = ""
    @Field val title: String = ""
    @Field val text: String = ""
    @Field val until: Double = 0.0
    @Field val url: String? = null
    @Field val actions: List<ActionRecord> = emptyList()
    @Field val channelName: String = ""
    @Field val channelDescription: String = ""
  }
}
