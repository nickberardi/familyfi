"use client";

import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { SETTINGS_COPY as COPY, loginFormState } from "@/lib/settings-copy";

import { useUI } from "./UIContext";

type Field = "username" | "password" | "confirm";

/**
 * A new login's username and its password twice, with what the form thinks of them. The sheet or
 * dialog around it supplies the title and the buttons, and reads `loginFormState` to enable them.
 */
export function NewLoginFields({
  username,
  password,
  confirm,
  onChange,
}: {
  username: string;
  password: string;
  confirm: string;
  onChange: (field: Field, value: string) => void;
}) {
  const ui = useUI();
  const [focused, setFocused] = useState<Field | null>(null);
  const state = loginFormState(username, password, confirm);
  const label = { fontFamily: ui.font, fontSize: 14, lineHeight: 21, fontWeight: "600" as const, color: ui.color("muted") };
  const field = (name: Field, title: string, extra: Partial<React.ComponentProps<typeof TextInput>>) => (
    <View style={styles.field}>
      <Text style={label}>{title}</Text>
      <TextInput
        aria-label={title}
        testID={`new-login-${name}`}
        value={name === "username" ? username : name === "password" ? password : confirm}
        onChangeText={(value) => onChange(name, value)}
        onFocus={() => setFocused(name)}
        onBlur={() => setFocused(null)}
        placeholderTextColor={ui.color("muted")}
        autoCapitalize="none"
        autoCorrect={false}
        style={[
          styles.input,
          { fontFamily: ui.font, color: ui.color("ink"), borderColor: ui.color(focused === name ? "accent" : "line") },
          focused === name && { boxShadow: `0 0 0 3px ${ui.color("focus-ring")}` },
        ]}
        {...extra}
      />
    </View>
  );
  return (
    <View style={styles.stack}>
      {field("username", COPY.username, { autoComplete: "off" })}
      {field("password", COPY.password, { secureTextEntry: true, placeholder: COPY.passwordPlaceholder, autoComplete: "new-password", textContentType: "newPassword" })}
      {field("confirm", COPY.confirmPassword, { secureTextEntry: true, placeholder: COPY.confirmPlaceholder, autoComplete: "new-password", textContentType: "newPassword" })}
      <Text style={{ fontFamily: ui.font, fontSize: 14, lineHeight: 21, color: ui.color(state.passwordsOk ? "on" : "muted") }} testID="new-login-hint">
        {state.hint}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  field: { gap: 4 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, lineHeight: 24, outlineWidth: 0 },
});
