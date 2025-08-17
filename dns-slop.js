// AI slop for DNSlink lookups based on https://github.com/PlutoLang/pluto-dns/blob/main/dns.pluto

function u8(arr, v) {
  arr.push(v & 0xff);
}
function u16be(arr, v) {
  arr.push((v >>> 8) & 0xff, v & 0xff);
}

function packDnsName(arr, name) {
  for (const label of name.split(".")) {
    if (label.length > 63) throw new Error("Label too long in DNS name");
    u8(arr, label.length);
    for (let i = 0; i < label.length; i++) {
      const code = label.charCodeAt(i);
      if (code > 0xff) throw new Error("Non-ASCII char in DNS name");
      u8(arr, code);
    }
  }
  u8(arr, 0x00);
}

async function queryDnslink(name) {
  const bytes = [];

  u16be(bytes, 0x0000);
  u8(bytes, 0x01);
  u8(bytes, 0x00);
  u16be(bytes, 0x0001);
  u16be(bytes, 0x0000);
  u16be(bytes, 0x0000);
  u16be(bytes, 0x0000);

  packDnsName(bytes, "_dnslink." + name);
  u16be(bytes, 16);
  u16be(bytes, 1);

  return await fetch(
    "https://1.1.1.1/dns-query?dns=" +
      new Uint8Array(bytes)
        .toBase64()
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, ""),
  );
}
