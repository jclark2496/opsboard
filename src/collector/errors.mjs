export function category(error) {
  const text = String(error?.message || error || "");
  if (/abort|timed out|timeout/i.test(text)) return "timeout";
  if (/ENOTFOUND|getaddrinfo|dns/i.test(text)) return "DNS";
  if (/CERT|TLS|certificate/i.test(text)) return "TLS";
  if (/\b401\b/.test(text)) return "401";
  if (/\b404\b/.test(text)) return "404";
  return "unreachable";
}

export function sshCategory(stderr) {
  const text = String(stderr || "");
  if (/timed out|timeout/i.test(text)) return "SSH timed out";
  if (/permission denied|authentication/i.test(text)) return "SSH authentication failed";
  if (/host key|identification/i.test(text)) return "Host key verification failed";
  if (/could not resolve|name or service not known/i.test(text)) return "DNS failed";
  return "SSH connection failed";
}
