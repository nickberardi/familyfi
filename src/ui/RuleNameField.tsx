"use client";

import type { ReactNode } from "react";
import { View } from "react-native";

import { FieldLabel } from "./FieldLabel";

/** The rule's name field with its label above it. */
export function RuleNameField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </View>
  );
}
