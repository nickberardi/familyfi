"use client";

import { useServerInsertedHTML } from "next/navigation";
import { useRef, type ReactNode } from "react";
import { StyleSheet } from "react-native";

/**
 * Shared components (`src/ui`) render through react-native-web, which writes their styles to a
 * stylesheet at runtime. This puts that stylesheet in the server-rendered HTML too, so a page
 * arrives styled rather than flashing unstyled until hydration. A streamed page flushes more than
 * once: only the first stylesheet carries react-native-web's id (the one it adopts on hydration),
 * and a later flush writes the sheet again only when shared components added rules to it.
 */
export function ReactNativeWebStyles({ children }: { children: ReactNode }) {
  const sent = useRef<string | null>(null);
  useServerInsertedHTML(() => {
    const sheet = (StyleSheet as unknown as { getSheet: () => { id: string; textContent: string } }).getSheet();
    if (sheet.textContent === sent.current) return null;
    const first = sent.current === null;
    sent.current = sheet.textContent;
    return <style id={first ? sheet.id : undefined} dangerouslySetInnerHTML={{ __html: sheet.textContent }} />;
  });
  return children;
}
