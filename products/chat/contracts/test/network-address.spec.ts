import { describe, expect, it } from "vitest";

import {
  bareHost,
  ipv6Groups,
  isLoopbackHost,
  isPrivateAddress,
} from "../src/common/network-address.ts";

describe("bareHost", () => {
  it("strips brackets, a zone suffix and the root dot", () => {
    expect(bareHost("[fe80::1%25eth0]")).toBe("fe80::1");
    expect(bareHost("localhost.")).toBe("localhost");
    expect(bareHost("LOCALHOST")).toBe("localhost");
  });
});

describe("ipv6Groups", () => {
  it("expands an elided run to eight groups", () => {
    expect(ipv6Groups("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(ipv6Groups("fe80::1")).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
  });

  it("folds a trailing dotted address into two groups", () => {
    expect(ipv6Groups("::ffff:10.0.0.5")).toEqual([
      0, 0, 0, 0, 0, 0xffff, 0x0a00, 0x0005,
    ]);
  });

  it("reports nothing for text that is not IPv6", () => {
    expect(ipv6Groups("127.0.0.1")).toBeUndefined();
    expect(ipv6Groups("partner.example")).toBeUndefined();
    expect(ipv6Groups("::1::2")).toBeUndefined();
  });
});

describe("isLoopbackHost", () => {
  it("names every form of loopback", () => {
    for (const host of ["localhost", "localhost.", "127.0.0.1", "127.1.2.3", "::1", "[::1]"]) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
  });

  it("leaves other hosts alone", () => {
    for (const host of ["partner.example", "10.0.0.5", "fe80::1", "128.0.0.1"]) {
      expect(isLoopbackHost(host), host).toBe(false);
    }
  });
});

describe("isPrivateAddress", () => {
  it("names the addresses a public client could never reach", () => {
    for (const host of [
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.254",
      "192.168.1.1",
      "169.254.169.254",
      "127.0.0.1",
      "0.0.0.0",
      "100.64.0.1",
      "198.18.0.1",
      "224.0.0.1",
      "localhost",
      "::",
      "::1",
      "fd00::1",
      "fe80::1",
    ]) {
      expect(isPrivateAddress(host), host).toBe(true);
    }
  });

  /**
   * Guard: a url parser rewrites `::ffff:10.0.0.5` to `::ffff:a00:5`, so the
   * mapped form has to be parsed rather than matched against the dotted text.
   */
  it("sees through an IPv4 address mapped into IPv6, in either spelling", () => {
    expect(isPrivateAddress("::ffff:10.0.0.5")).toBe(true);
    expect(isPrivateAddress("[::ffff:a00:5]")).toBe(true);
    expect(isPrivateAddress("::ffff:169.254.169.254")).toBe(true);
    expect(isPrivateAddress("[::ffff:a9fe:a9fe]")).toBe(true);
  });

  it("sees through a NAT64 prefix", () => {
    expect(isPrivateAddress("64:ff9b::10.0.0.5")).toBe(true);
  });

  it("leaves public addresses and names alone", () => {
    for (const host of [
      "8.8.8.8",
      "172.32.0.1",
      "192.169.0.1",
      "partner.example",
      "2606:4700::1",
      "::ffff:8.8.8.8",
    ]) {
      expect(isPrivateAddress(host), host).toBe(false);
    }
  });
});
