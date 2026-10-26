# Security Policy

Clew is a self-hosted application that stores source files, field metadata and
lineage history. Security reports are welcome and are handled privately until a
fix is available.

## Supported versions

| Version | Supported |
| --- | --- |
| `main` branch | Yes |
| `0.1.x` | Yes |
| Older tags | No |

The project is pre-1.0 and moves quickly; fixes land on `main` and are not
backported to older tags unless the issue is critical.

## Reporting a vulnerability

**Do not open a public issue, pull request or discussion for a security bug.**

Use GitHub's private reporting flow:

<https://github.com/Mylifeforrent/clew/security/advisories/new>

Please include:

- the affected endpoint, module or file, and the version or commit;
- reproduction steps or a proof of concept;
- the impact you believe it has;
- any suggested fix, if you have one.

Never include real `.env` values, production data, customer data or personal
data in a report. Use synthetic examples.

You will get an acknowledgement and a triage decision. There is no paid bounty
and no formal SLA; this is a small project, and reports are handled on a best
-effort basis.

## In scope

- Authentication and authorization bypasses (JWT handling, role checks,
  viewer/editor/admin boundaries).
- Access to another user's or another workspace's data (IDOR).
- Path traversal, arbitrary file read or write through the source-file download
  and upload endpoints.
- SQL injection and unsafe handling of imported CSV, XLSX or JSON manifests.
- Locator verification bypasses that let a stale or forged locator point at the
  wrong cells.
- Secrets leaking into logs, API responses or the repository.
- AI tool misuse that results in a write. The copilot is read-only by design and
  suggestions require explicit human confirmation; a prompt-injection path that
  mutates data is a vulnerability, an odd but harmless model answer is not.

## Out of scope

- Deployments that keep the example credentials (`admin` / `admin123`) or a
  default `SECRET_KEY` from `.env.example`.
- Missing hardening that is the operator's responsibility (TLS termination,
  network isolation, backups, reverse-proxy configuration).
- Denial of service through intentionally huge uploads on an unprotected
  instance.
- Issues that require an already-compromised host or database.
- Vulnerabilities in third-party dependencies that have no exploitable path in
  Clew; report those upstream as well.

## Handling

Reports are triaged privately, a fix is prepared on a private branch when
needed, and the advisory is published with credit unless you ask to stay
anonymous. Please give the project reasonable time to ship a fix before
disclosing publicly.
