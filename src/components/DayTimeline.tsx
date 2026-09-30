/**
 * Today on a 24-hour bar. The web renders the shared component (`src/ui/DayTimeline.tsx`) through
 * react-native-web, as the native app renders it natively; its logic is `src/lib/day-timeline.ts`.
 */
export { DayTimeline } from "@/ui/DayTimeline";
export { bandTimes, type TimelineBand } from "@/lib/day-timeline";
