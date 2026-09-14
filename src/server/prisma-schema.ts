export function modelFieldsFromPrismaSchema(schema: string, model: string): string[] {
  const match = new RegExp(`model\\s+${model}\\s*\\{([^}]*)\\}`).exec(schema);
  if (!match?.[1]) return [];
  const fields: string[] = [];
  for (const line of match[1].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@")) continue;
    const name = trimmed.split(/\s+/)[0];
    if (name) fields.push(name);
  }
  return fields;
}

export function missingClientFields(
  schemaFields: string[],
  clientFields: Iterable<string>,
): string[] {
  const known = new Set(clientFields);
  return schemaFields.filter((field) => !known.has(field));
}
