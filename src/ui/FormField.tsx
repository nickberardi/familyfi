"use client";

import type { ReactNode } from "react";
import { View } from "react-native";

import { FieldLabel } from "./FieldLabel";

/** A form's control with its label above it. */
export function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </View>
  );
}
