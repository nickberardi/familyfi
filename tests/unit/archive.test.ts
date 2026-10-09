import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ArchiveError, readArchive, writeArchive } from "@/server/archive";

const LIMITS = { allowed: ["manifest.json", "config.json", "database.dump"], maxFileBytes: 4096, maxTotalBytes: 16_384 };

/** Rewrites the first header of an archive, then fixes its checksum, so a test can build what an attacker would. */
function tamper(archive: Buffer, edit: (header: Buffer) => void, fixChecksum = true): Buffer {
  const tar = Buffer.from(gunzipSync(archive));
  const header = tar.subarray(0, 512);
  edit(header);
  if (fixChecksum) {
    header.fill(0x20, 148, 156);
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
  }
  return gzipSync(tar);
}

const sample = () => writeArchive([{ name: "manifest.json", data: Buffer.from('{"format":"familyfi-export"}') }]);

describe("household export archives", () => {
  it("round-trips named files, including binary ones and sizes on a block boundary", () => {
    const files = [
      { name: "manifest.json", data: Buffer.from("{}") },
      { name: "config.json", data: Buffer.alloc(512, "a") },
      { name: "database.dump", data: Buffer.from([0, 1, 2, 255, 0]) },
    ];
    const read = readArchive(writeArchive(files), LIMITS);
    expect([...read.keys()]).toEqual(["manifest.json", "config.json", "database.dump"]);
    for (const file of files) expect(read.get(file.name)?.equals(file.data)).toBe(true);
  });

  it("refuses names it does not expect, paths, links and duplicates", () => {
    expect(() => readArchive(writeArchive([{ name: "other.json", data: Buffer.from("{}") }]), LIMITS)).toThrow(/never does/);
    const escaping = tamper(sample(), (header) => header.fill(0, 0, 100).write("../manifest.json", 0, "utf8"));
    expect(() => readArchive(escaping, LIMITS)).toThrow(ArchiveError);
    const prefixed = tamper(sample(), (header) => header.write("etc", 345, "utf8"));
    expect(() => readArchive(prefixed, LIMITS)).toThrow(/not a plain file/);
    const symlink = tamper(sample(), (header) => header.write("2", 156, "ascii"));
    expect(() => readArchive(symlink, LIMITS)).toThrow(/not a plain file/);
    const twice = writeArchive([
      { name: "manifest.json", data: Buffer.from("{}") },
      { name: "manifest.json", data: Buffer.from("{}") },
    ]);
    expect(() => readArchive(twice, LIMITS)).toThrow(/twice/);
    expect(() => writeArchive([{ name: "../escape", data: Buffer.alloc(0) }])).toThrow(ArchiveError);
  });

  it("refuses damage, truncation, oversize files and inflation past the cap", () => {
    expect(() => readArchive(Buffer.from("not gzip"), LIMITS)).toThrow(/not a .tar.gz/);
    const badSum = tamper(sample(), (header) => header.write("x", 0, "utf8"), false);
    expect(() => readArchive(badSum, LIMITS)).toThrow(/damaged/);
    const cut = gzipSync(gunzipSync(sample()).subarray(0, 600));
    expect(() => readArchive(cut, LIMITS)).toThrow(/cut short/);
    const large = writeArchive([{ name: "database.dump", data: Buffer.alloc(5000) }]);
    expect(() => readArchive(large, LIMITS)).toThrow(/too large/);
    const bomb = gzipSync(Buffer.alloc(1024 * 1024));
    expect(() => readArchive(bomb, LIMITS)).toThrow(/too large/);
  });
});
