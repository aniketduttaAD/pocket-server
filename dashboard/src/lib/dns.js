async function verifyCname(hostname, expectedTarget) {
  const url = `https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=CNAME`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const answers = data.Answer || [];
    const cnames = answers
      .filter((a) => a.type === 5)
      .map((a) => a.data.replace(/\.$/, '').toLowerCase());

    const target = expectedTarget.replace(/\.$/, '').toLowerCase();
    const found = cnames.some((c) => c === target || c.includes('cfargotunnel.com'));

    return {
      ok: true,
      status: found ? 'active' : 'pending',
      cnames,
      expected: target,
    };
  } catch (err) {
    return { ok: false, status: 'error', error: err.message };
  }
}

module.exports = { verifyCname };
