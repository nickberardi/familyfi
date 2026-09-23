"use client";

import { useMemo } from "react";
import { encode } from "uqr";

/**
 * A QR code drawn from its module matrix, so its colours come from tokens rather than
 * the library's literals. Error correction M leaves room for a glare spot on a screen;
 * the border is the four-module quiet zone the spec asks for.
 */
export function QrCode({ value, size = 280, label }: { value: string; size?: number; label: string }) {
  const { data, size: modules } = useMemo(() => encode(value, { ecc: "M", border: 4 }), [value]);
  const path = useMemo(() => {
    const parts: string[] = [];
    data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) parts.push(`M${x} ${y}h1v1h-1z`);
      }),
    );
    return parts.join("");
  }, [data]);

  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${modules} ${modules}`}
      shapeRendering="crispEdges"
      className="block"
    >
      <rect width={modules} height={modules} fill="var(--ff-qr-ground)" />
      <path d={path} fill="var(--ff-qr-ink)" />
    </svg>
  );
}
