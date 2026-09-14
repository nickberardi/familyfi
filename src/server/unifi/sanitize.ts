const MAC = /\b[0-9a-f]{2}(?::[0-9a-f]{2}){5}\b/gi;
const IPV4 = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b/g;

function replaceMacs(text: string): string {
  let n = 1;
  return text.replace(MAC, () => {
    const suffix = n.toString(16).padStart(2, "0");
    n += 1;
    return `02:00:00:00:00:${suffix}`;
  });
}

function replaceIpv4(text: string): string {
  let n = 1;
  return text.replace(IPV4, () => {
    const octet = n;
    n += 1;
    return `192.0.2.${octet}`;
  });
}

function replaceIpv6(text: string): string {
  return text.replace(/\b[0-9a-f:]+:+[0-9a-f:]+\b/gi, (match) => {
    if (/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(match)) return match;
    if (!match.includes("::") && match.split(":").length !== 8) return match;
    return "2001:db8::1";
  });
}

export function sanitizeUnifiText(text: string): string {
  return replaceIpv6(replaceIpv4(replaceMacs(text)));
}

export function sanitizeUnifiValue(value: unknown, nameKeys = new Set(["name", "description"])): unknown {
  if (typeof value === "string") return sanitizeUnifiText(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeUnifiValue(item, nameKeys));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (nameKeys.has(key) && typeof nested === "string") {
        out[key] = nested.startsWith("FamilyFi ") || nested.startsWith("fam-") ? nested : "redacted";
        continue;
      }
      out[key] = sanitizeUnifiValue(nested, nameKeys);
    }
    return out;
  }
  return value;
}
