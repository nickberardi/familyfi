"use client";

import { useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View, type TextInputInstance } from "react-native";

import { SIGN_IN_NOTE } from "@/lib/sign-in";

import { Button } from "./Button";
import { useUI } from "./UIContext";

/**
 * The sign-in form every client shows: username, password, the outcome, and the note on resets.
 * The caller signs in (`onSubmit` resolves to an error to show, or null) and moves on afterwards,
 * because the web and a paired phone reach `/api/v1/auth/login` differently.
 */
export function SignInForm({
  onSubmit,
  initialUsername = "",
  surface = "card",
}: {
  onSubmit: (username: string, password: string) => Promise<string | null>;
  initialUsername?: string;
  /** `card` on a page (the web); `plain` sits the fields straight on a ground, filled with `field` (a phone's setup). */
  surface?: "card" | "plain";
}) {
  const ui = useUI();
  const [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [focused, setFocused] = useState<"username" | "password" | null>(null);
  const passwordField = useRef<TextInputInstance>(null);

  async function submit() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      setError((await onSubmit(username, password)) ?? "");
    } finally {
      setPending(false);
    }
  }

  const label = { fontFamily: ui.font, fontSize: 14, lineHeight: 21, fontWeight: "600" as const, color: ui.color("muted") };
  const input = (field: "username" | "password") => [
    styles.input,
    { fontFamily: ui.font, color: ui.color("ink"), borderColor: ui.color(focused === field ? "accent" : "line") },
    surface === "plain" && { backgroundColor: ui.color("field") },
    focused === field && { boxShadow: `0 0 0 3px ${ui.color("focus-ring")}` },
  ];

  return (
    <View style={surface === "card" ? [styles.card, { backgroundColor: ui.color("card"), borderColor: ui.color("line") }] : styles.plain}>
      <View style={styles.field}>
        <Text style={label}>Username</Text>
        <TextInput
          aria-label="Username"
          testID="sign-in-username"
          style={input("username")}
          value={username}
          onChangeText={setUsername}
          onFocus={() => setFocused("username")}
          onBlur={() => setFocused(null)}
          placeholder="admin"
          placeholderTextColor={ui.color("muted")}
          autoComplete="username"
          textContentType="username"
          autoCapitalize="none"
          autoCorrect={false}
          enterKeyHint="next"
          // Return submits once a password is filled in (as the web's form always did), else moves to it.
          onSubmitEditing={() => (password ? void submit() : passwordField.current?.focus())}
          // Keeps focus in the field when Return submits (react-native-web reads only blurOnSubmit).
          blurOnSubmit={false}
        />
      </View>
      <View style={styles.field}>
        <Text style={label}>Password</Text>
        <TextInput
          ref={passwordField}
          aria-label="Password"
          testID="sign-in-password"
          style={input("password")}
          value={password}
          onChangeText={setPassword}
          onFocus={() => setFocused("password")}
          onBlur={() => setFocused(null)}
          placeholder="Your password"
          placeholderTextColor={ui.color("muted")}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
          enterKeyHint="go"
          // Return keeps the field focused, so a wrong password can be retyped straight away. (react-native-web
          // reads only blurOnSubmit; React Native reads it as submitBehavior "submit".)
          blurOnSubmit={false}
          onSubmitEditing={() => void submit()}
        />
      </View>
      {error ? (
        <Text role="alert" testID="sign-in-error" style={[styles.error, { fontFamily: ui.font, backgroundColor: ui.color("danger-fill"), color: ui.color("danger") }]}>
          {error}
        </Text>
      ) : null}
      <Button label={pending ? "Signing in…" : "Sign in"} disabled={pending} onPress={() => void submit()} testID="sign-in-submit" />
      <Text style={{ fontFamily: ui.font, fontSize: 14, lineHeight: 20, color: ui.color("muted") }}>{SIGN_IN_NOTE}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 14, borderWidth: 1, borderRadius: 14, padding: 20 },
  plain: { gap: 14 },
  field: { gap: 6 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, lineHeight: 24, outlineWidth: 0 },
  error: { borderRadius: 9, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, lineHeight: 20, overflow: "hidden" },
});
