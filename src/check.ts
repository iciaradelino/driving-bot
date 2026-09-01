/**
 * one-shot poll: login → fetch → filter → diff → notify → save state
 */
import { fetchSlots, login } from "./autius.js";
import { assertDiscordWebhookUrl, notifyFailure, notifyNewSlots } from "./discord.js";
import { filterSlots } from "./filters.js";
import {
  diffNewSlots,
  loadState,
  markFailure,
  markFailureAlertSent,
  markSeen,
  prunePastSlots,
  saveState,
  shouldAlertFailure,
} from "./state.js";
import { loadConfig, loadEnvFile, requireEnv, sleep } from "./utils.js";

async function main(): Promise<void> {
  loadEnvFile();
  const config = loadConfig();

  const email = requireEnv("AUTIUS_EMAIL");
  const password = requireEnv("AUTIUS_PASSWORD");
  const seedOnly = process.env.SEED_ONLY === "1" || process.env.SEED_ONLY === "true";
  const webhookUrl = seedOnly
    ? (process.env.DISCORD_WEBHOOK_URL?.trim() ?? "")
    : requireEnv("DISCORD_WEBHOOK_URL");
  if (!seedOnly) assertDiscordWebhookUrl(webhookUrl);

  const jitterMax = Math.max(0, config.jitterSecondsMax | 0);
  if (jitterMax > 0 && !seedOnly) {
    const ms = Math.floor(Math.random() * (jitterMax + 1) * 1000);
    console.log(`jitter sleep ${Math.round(ms / 1000)}s`);
    await sleep(ms);
  }

  let state = loadState();

  try {
    console.log("logging in…");
    const session = await login({
      email,
      password,
      userAgent: config.userAgent,
    });

    console.log("fetching calendar…");
    const all = await fetchSlots({
      session,
      lookaheadDays: config.lookaheadDays,
    });
    console.log(`fetched ${all.length} available slot(s) before filters`);

    const filtered = filterSlots(all, config);
    console.log(`${filtered.length} slot(s) after filters`);

    state = prunePastSlots(state, filtered);
    const fresh = diffNewSlots(state, filtered);
    console.log(`${fresh.length} new slot(s)`);

    if (seedOnly) {
      state = markSeen(state, filtered);
      saveState(state);
      console.log("SEED_ONLY: marked current slots as seen, skipped discord");
      return;
    }

    if (fresh.length > 0) {
      await notifyNewSlots({
        webhookUrl,
        slots: fresh,
        calendarUrl: config.calendarUrl,
      });
      console.log("discord notified");
    } else {
      console.log("no new slots — skipping discord");
    }

    // remember the full filtered set so we don't re-alert; also track disappearances by prune
    state = markSeen(state, filtered);
    saveState(state);
    console.log("state saved");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("check failed:", message);

    state = markFailure(state);
    if (shouldAlertFailure(state)) {
      try {
        await notifyFailure({
          webhookUrl,
          message,
          consecutiveFailures: state.consecutiveFailures,
        });
        state = markFailureAlertSent(state);
        console.log("failure alert sent to discord");
      } catch (notifyErr) {
        console.error("could not send failure alert:", notifyErr);
      }
    } else {
      console.log("failure alert suppressed (already sent within 24h)");
    }
    saveState(state);
    process.exitCode = 1;
  }
}

main();
