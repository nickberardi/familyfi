"use client";

import { Linking, Text, type StyleProp, type TextStyle } from "react-native";

/** A link that leaves FamilyFi: the phone hands it to the system, which opens the browser. */
export function ExternalLink({ href, children, style, testID }: { href: string; children: string; style?: StyleProp<TextStyle>; testID?: string }) {
  return (
    <Text role="link" onPress={() => void Linking.openURL(href)} style={style} testID={testID}>
      {children}
    </Text>
  );
}
