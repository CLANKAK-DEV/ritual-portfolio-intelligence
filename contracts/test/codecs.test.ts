import { describe, expect, it } from "vitest";
import {
  decodeAbiParameters,
  encodeAbiParameters,
  parseAbiParameters,
} from "viem";

const executor = "0x1234567890abcdef1234567890abcdef12345678" as const;

describe("Ritual ABI codecs", () => {
  it("round-trips the canonical 13-field HTTP request", () => {
    const types = parseAbiParameters(
      "address, bytes[], uint256, bytes[], bytes, string, uint8, string[], string[], bytes, uint256, uint8, bool",
    );
    const encoded = encodeAbiParameters(types, [
      executor,
      [],
      300n,
      [],
      "0x",
      "https://portfolio.example/api?address=0xabc",
      1,
      ["Accept"],
      ["application/json"],
      "0x",
      0n,
      0,
      false,
    ]);
    const decoded = decodeAbiParameters(types, encoded);
    expect(decoded[0].toLowerCase()).toBe(executor.toLowerCase());
    expect(decoded[2]).toBe(300n);
    expect(decoded[5]).toContain("address=0xabc");
    expect(decoded[6]).toBe(1);
    expect(decoded).toHaveLength(13);
  });

  it("unwraps a settled HTTP SPC response", () => {
    const response = encodeAbiParameters(
      parseAbiParameters("uint16, string[], string[], bytes, string"),
      [200, ["content-type"], ["application/json"], "0x7b226f6b223a747275657d", ""],
    );
    const envelope = encodeAbiParameters(parseAbiParameters("bytes, bytes"), ["0x1234", response]);
    const [, actual] = decodeAbiParameters(parseAbiParameters("bytes, bytes"), envelope);
    const [status, , , body, error] = decodeAbiParameters(
      parseAbiParameters("uint16, string[], string[], bytes, string"),
      actual,
    );
    expect(status).toBe(200);
    expect(new TextDecoder().decode(Buffer.from(body.slice(2), "hex"))).toBe('{"ok":true}');
    expect(error).toBe("");
  });
});
