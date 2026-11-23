import type { Certificate } from "@shared/api/panel-events";

export interface CertificateDomainOccurrence {
  domain: string;
  offset: number;
  length: number;
}

export interface CertificateMatch {
  domain: string;
  certificate: Certificate;
}

/** Normalize DNS names without network requests or interpreting a path as a host. */
export function canonicalCertificateDomain(value: string): string | null {
  const input = value.trim().replace(/\.$/, "").toLowerCase();
  const wildcard = input.startsWith("*.");
  const hostname = wildcard ? input.slice(2) : input;
  if (!hostname || /[\s/:?#@*\\]/.test(hostname)) return null;
  try {
    const canonical = new URL(`https://${hostname}`).hostname;
    const labels = canonical.split(".");
    if (
      labels.length < 2 ||
      canonical.length > 253 ||
      /^\d+$/.test(labels.at(-1)!)
    )
      return null;
    if (
      labels.some((label) => !/^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/.test(label))
    )
      return null;
    return wildcard ? `*.${canonical}` : canonical;
  } catch {
    return null;
  }
}

/** A certificate wildcard covers one label, never the apex or a deeper subtree. */
export function certificateDomainMatches(
  registeredDomain: string,
  candidate: string,
): boolean {
  const registered = canonicalCertificateDomain(registeredDomain);
  const domain = canonicalCertificateDomain(candidate);
  if (!registered || !domain) return false;
  if (registered === domain) return true;
  if (!registered.startsWith("*.") || domain.startsWith("*.")) return false;
  const suffix = registered.slice(1);
  if (!domain.endsWith(suffix)) return false;
  const label = domain.slice(0, -suffix.length);
  return label.length > 0 && !label.includes(".");
}

/** Find domains in SNI lists, host:port values and certificate file paths. */
export function certificateDomainOccurrences(
  value: string,
): CertificateDomainOccurrence[] {
  const pattern =
    /(?:\*\.)?[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?(?:\.[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?)+\.?/gu;
  const occurrences: CertificateDomainOccurrence[] = [];
  for (const match of value.matchAll(pattern)) {
    const offset = match.index!;
    // Do not turn a fragment of an invalid host into another registered domain.
    if (
      /[\p{L}\p{N}_.*-]/u.test(value[offset - 1] || "") ||
      /[\p{L}\p{N}_.*-]/u.test(value[offset + match[0].length] || "")
    )
      continue;
    const domain = canonicalCertificateDomain(match[0]);
    if (domain) occurrences.push({ domain, offset, length: match[0].length });
  }
  return occurrences;
}

export function matchingCertificates(
  domain: string,
  certificates: readonly Certificate[],
  profileNodeUuids: readonly string[],
): Certificate[] {
  const nodes = new Set(profileNodeUuids);
  return certificates
    .filter((certificate) => {
      if (!Number.isFinite(Date.parse(certificate.expiresAt))) return false;
      if (
        nodes.size &&
        certificate.nodeUuids.length &&
        !certificate.nodeUuids.some((uuid) => nodes.has(uuid))
      )
        return false;
      return certificate.domains.some((registered) =>
        certificateDomainMatches(registered, domain),
      );
    })
    .sort(
      (a, b) =>
        Date.parse(a.expiresAt) - Date.parse(b.expiresAt) ||
        a.name.localeCompare(b.name),
    );
}

export function certificateMatchesInValue(
  value: string,
  certificates: readonly Certificate[],
  profileNodeUuids: readonly string[],
): CertificateMatch[] {
  const domains = new Set(
    certificateDomainOccurrences(value).map((item) => item.domain),
  );
  return Array.from(domains).flatMap((domain) =>
    matchingCertificates(domain, certificates, profileNodeUuids).map(
      (certificate) => ({ domain, certificate }),
    ),
  );
}

const domainFields = new Set([
  "serverName",
  "serverNames",
  "target",
  "dest",
  "certificateFile",
  "keyFile",
  "address",
  "host",
  "Host",
]);
type JsonScope = {
  kind: "object" | "array";
  property: string | null;
  phase: "key" | "colon" | "value" | "after";
};

/** Inspect only domain-bearing JSON values. Credentials and property names have no hover. */
export function jsonCertificateDomainAtOffset(
  source: string,
  offset: number,
): CertificateDomainOccurrence | null {
  const tokens = /"(?:\\.|[^"\\])*"|[{}\[\]:,]/g;
  const scopes: JsonScope[] = [];
  for (const match of source.matchAll(tokens)) {
    if (match.index! > offset) return null;
    const token = match[0];
    const scope = scopes.at(-1);
    if (token === "{" || token === "[") {
      const property = scope?.property ?? null;
      if (scope?.kind === "object") scope.phase = "after";
      scopes.push({
        kind: token === "{" ? "object" : "array",
        property: token === "[" ? property : null,
        phase: token === "{" ? "key" : "value",
      });
    } else if (token === "}" || token === "]") {
      scopes.pop();
    } else if (token === ":") {
      if (scope?.kind === "object" && scope.phase === "colon")
        scope.phase = "value";
    } else if (token === ",") {
      if (scope?.kind === "object") {
        scope.phase = "key";
        scope.property = null;
      }
    } else if (scope?.kind === "object" && scope.phase === "key") {
      try {
        scope.property = JSON.parse(token) as string;
      } catch {
        return null;
      }
      scope.phase = "colon";
    } else if (scope && (scope.kind === "array" || scope.phase === "value")) {
      if (
        offset > match.index! &&
        offset < match.index! + token.length - 1 &&
        domainFields.has(scope.property ?? "")
      ) {
        const start = match.index! + 1;
        const occurrence = certificateDomainOccurrences(
          token.slice(1, -1),
        ).find(
          (domain) =>
            offset >= start + domain.offset &&
            offset < start + domain.offset + domain.length,
        );
        return occurrence
          ? { ...occurrence, offset: start + occurrence.offset }
          : null;
      }
      if (scope.kind === "object") scope.phase = "after";
    }
  }
  return null;
}

export function certificateExpiryText(
  matches: readonly CertificateMatch[],
  locale: string,
): string {
  const date = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return [
    "Срок SSL из календаря",
    ...matches.map(({ domain, certificate }) =>
      [
        `${domain} · ${certificate.name}`,
        `Истекает: ${date.format(new Date(certificate.expiresAt))}`,
        certificate.nodes.length
          ? `Ноды: ${certificate.nodes.map((node) => node.name).join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  ].join("\n\n");
}
