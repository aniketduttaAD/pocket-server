async function dnsQuery(hostname, type) {
  const url = `https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=${type}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.Answer || [];
}

async function verifyCname(hostname, expectedTarget) {
  const target = expectedTarget.replace(/\.$/, '').toLowerCase();

  try {
    const cnameAnswers = await dnsQuery(hostname, 'CNAME');
    const cnames = cnameAnswers
      .filter((a) => a.type === 5)
      .map((a) => a.data.replace(/\.$/, '').toLowerCase());

    if (cnames.some((c) => c === target || c.endsWith('.cfargotunnel.com'))) {
      return { ok: true, status: 'active', cnames, expected: target, method: 'cname' };
    }

    // Cloudflare proxied hostnames often expose A records instead of public CNAME
    const aAnswers = await dnsQuery(hostname, 'A');
    const aRecords = aAnswers.filter((a) => a.type === 1).map((a) => a.data);
    if (aRecords.length > 0) {
      return {
        ok: true,
        status: 'active',
        cnames,
        aRecords,
        expected: target,
        method: 'proxied-a',
      };
    }

    return { ok: true, status: 'pending', cnames, expected: target };
  } catch (err) {
    return { ok: false, status: 'error', error: err.message };
  }
}

module.exports = { verifyCname };
