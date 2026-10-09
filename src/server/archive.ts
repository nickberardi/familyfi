import { gunzipSync, gzipSync } from "node:zlib";

/**
 * The `.tar.gz` a household export travels in: a handful of named regular files, written and read
 * here rather than through a tar library. The reader is deliberately narrow, because an uploaded
 * archive is untrusted: only the names the caller allows, no directories, links or paths, each file
 * and the whole archive capped (the gzip stream is capped as it inflates, so a small upload cannot
 * expand without limit), and a header whose checksum does not add up ends the read.
 */
const BLOCK = 512;

export class ArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveError";
  }
}

export type ArchiveFile = { name: string; data: Buffer };

function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, "0")}\0`;
}

function header(name: string, size: number, mtime: Date): Buffer {
  const block = Buffer.alloc(BLOCK);
  block.write(name, 0, 100, "utf8");
  block.write(octal(0o644, 8), 100, "ascii");
  block.write(octal(0, 8), 108, "ascii");
  block.write(octal(0, 8), 116, "ascii");
  block.write(octal(size, 12), 124, "ascii");
  block.write(octal(Math.floor(mtime.getTime() / 1000), 12), 136, "ascii");
  block.write("        ", 148, "ascii");
  block.write("0", 156, "ascii");
  block.write("ustar\0", 257, "ascii");
  block.write("00", 263, "ascii");
  block.write("familyfi", 265, "ascii");
  block.write("familyfi", 297, "ascii");
  block.write(octal(checksum(block), 7), 148, "ascii");
  block.write(" ", 155, "ascii");
  return block;
}

function checksum(block: Buffer): number {
  let sum = 0;
  for (let index = 0; index < BLOCK; index += 1) sum += index >= 148 && index < 156 ? 0x20 : block[index];
  return sum;
}

function padding(size: number): Buffer {
  return Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK);
}

export function writeArchive(files: ArchiveFile[], mtime = new Date()): Buffer {
  const parts: Buffer[] = [];
  for (const file of files) {
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(file.name)) throw new ArchiveError(`Cannot archive ${file.name}.`);
    parts.push(header(file.name, file.data.length, mtime), file.data, padding(file.data.length));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return gzipSync(Buffer.concat(parts));
}

function field(block: Buffer, start: number, length: number): string {
  const raw = block.subarray(start, start + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? length : end).toString("utf8");
}

function parseOctal(block: Buffer, start: number, length: number): number {
  const text = field(block, start, length).trim();
  if (!/^[0-7]+$/.test(text)) throw new ArchiveError("The archive is damaged.");
  return Number.parseInt(text, 8);
}

export function readArchive(
  gzipped: Buffer,
  options: { allowed: readonly string[]; maxFileBytes: number; maxTotalBytes: number },
): Map<string, Buffer> {
  let tar: Buffer;
  try {
    tar = gunzipSync(gzipped, { maxOutputLength: options.maxTotalBytes + BLOCK * 16 });
  } catch {
    throw new ArchiveError("This is not a FamilyFi export: it is not a .tar.gz file, or it is too large.");
  }
  const files = new Map<string, Buffer>();
  let offset = 0;
  while (offset + BLOCK <= tar.length) {
    const block = tar.subarray(offset, offset + BLOCK);
    if (block.every((byte) => byte === 0)) return files;
    if (parseOctal(block, 148, 8) !== checksum(block)) throw new ArchiveError("The archive is damaged.");
    const name = field(block, 0, 100);
    const prefix = field(block, 345, 155);
    const type = String.fromCharCode(block[156]);
    const size = parseOctal(block, 124, 12);
    if (prefix || (type !== "0" && type !== "\0")) throw new ArchiveError(`The archive holds ${prefix ? `${prefix}/` : ""}${name}, which is not a plain file.`);
    if (!options.allowed.includes(name)) throw new ArchiveError(`The archive holds ${name}, which a FamilyFi export never does.`);
    if (files.has(name)) throw new ArchiveError(`The archive holds ${name} twice.`);
    if (size > options.maxFileBytes) throw new ArchiveError(`${name} is too large.`);
    const start = offset + BLOCK;
    if (start + size > tar.length) throw new ArchiveError("The archive is cut short.");
    files.set(name, Buffer.from(tar.subarray(start, start + size)));
    offset = start + size + padding(size).length;
  }
  throw new ArchiveError("The archive is cut short.");
}
