/**
 * The countdown both apps show outside the app, drawn the same way in each: a group's or a block's
 * name, its line in familyfi's words, a timer the system keeps running, the pause mark in the block
 * colour, and the card's buttons.
 *
 * Android: an ongoing notification promoted to a Live Update on Android 16 and later
 * (`android/…/Countdown.kt`), which an app's own native code posts too (FamilyFi Me's alarms).
 * iPhone: the Live Activity's views (`apple/CountdownViews.swift`), which each app's widget
 * extension links; the activity itself is each app's, as its attributes are.
 */
import { requireOptionalNativeModule } from "expo";

export type CountdownAction = { label: string; url: string };

export type CountdownSpec = {
  /** Which countdown this is; showing the same tag again updates it in place. */
  tag: string;
  title: string;
  text: string;
  /** The end, in milliseconds since the epoch. */
  until: number;
  /** The app link a tap opens. */
  url: string | null;
  actions: CountdownAction[];
  /** What the system's notification settings call the channel. */
  channelName: string;
  channelDescription: string;
};

type NativeCountdown = {
  enabled(): boolean;
  /** The tags with a countdown showing. */
  running(): string[];
  show(spec: CountdownSpec): Promise<void>;
  end(tag: string): Promise<void>;
};

/** Android only; null on Apple devices and in a build without the module. */
export const countdown = requireOptionalNativeModule<NativeCountdown>("FamilyfiCountdown");
