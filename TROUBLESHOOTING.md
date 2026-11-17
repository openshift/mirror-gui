# Troubleshooting

## Server logs

View container logs to diagnose issues:

```bash
./mirror-gui.sh --logs    # pre-built image
./local-build.sh --logs   # local build
```

Use `mirror-gui.sh` when running a pre-built image from the registry; use `local-build.sh` when building from source locally. Both scripts accept the same `--logs`, `--status`, `--stop`, and `--restart` flags.

The server logs all incoming HTTP requests with timestamps and writes oc-mirror operation output to individual log files under the data directory.

## Container startup issues

If the container fails to start, check that the required port is available:

```bash
# Check if port 3000 is in use
ss -tlnp | grep 3000
```

Both scripts automatically select the next available port if `3000` is occupied. Look for the `Web UI:` line in the script output.

If the container starts but the UI is unreachable, verify the container is running:

```bash
./mirror-gui.sh --status    # pre-built image
./local-build.sh --status   # local build
```

## Build fails with "Invalid GPG signature" on RHEL

On RHEL hosts that enforce container image signatures, `./local-build.sh --build` can stop at a catalog stage with:

```text
Error: creating build container: unable to copy from source docker://registry.redhat.io/redhat/certified-operator-index:v4.16:
... Source image rejected: Invalid GPG signature: gpgme.Signature{... Fingerprint:"1AC4971355A34A82", ...}
```

The Dockerfile pulls the certified and community operator catalogs as build stages. Red Hat signs those images with its ISV container signing key (`/etc/pki/rpm-gpg/ISV-Container-signing-key`), but RHEL's default `/etc/containers/policy.json` only trusts the Red Hat release and beta keys for `registry.redhat.io`. This is not specific to FIPS mode.

Keep signature verification on and trust the ISV key for those two repositories only. For rootless Podman, a user-level policy overrides the system one without changing it.

Before you start:

- Install `jq` (`sudo dnf install -y jq`).
- Confirm the key file exists: `test -f /etc/pki/rpm-gpg/ISV-Container-signing-key && echo present`. If it is missing, download the ISV container signing key from the Red Hat product signing keys page (https://access.redhat.com/security/team/key) and save it at that path.
- If you already have `~/.config/containers/policy.json`, the commands below back it up and add the two entries to it, so your existing rules are kept.

```bash
mkdir -p ~/.config/containers
policy=~/.config/containers/policy.json
src=/etc/containers/policy.json
if [ -f "$policy" ]; then
  cp -p "$policy" "$policy.bak"    # keep your existing user policy
  src="$policy"
fi
jq '.transports.docker += {
  "registry.redhat.io/redhat/certified-operator-index": [{"type":"signedBy","keyType":"GPGKeys","keyPaths":["/etc/pki/rpm-gpg/RPM-GPG-KEY-redhat-release","/etc/pki/rpm-gpg/ISV-Container-signing-key"]}],
  "registry.redhat.io/redhat/community-operator-index": [{"type":"signedBy","keyType":"GPGKeys","keyPaths":["/etc/pki/rpm-gpg/RPM-GPG-KEY-redhat-release","/etc/pki/rpm-gpg/ISV-Container-signing-key"]}]
}' "$src" > "$policy.new" && mv -f "$policy.new" "$policy"
```

The policy is written to a temporary file first and only moved into place if `jq` succeeds; an empty or invalid user policy would break every rootless pull.

Check that both catalogs now pull with verification enforced, then rerun the build:

```bash
podman pull registry.redhat.io/redhat/certified-operator-index:v4.16
podman pull registry.redhat.io/redhat/community-operator-index:v4.16
./local-build.sh --build
```

For rootful builds, make the same change in `/etc/containers/policy.json`. Do not switch the policy to `insecureAcceptAnything`.

## Pull secret issues

Mirror-GUI requires a valid pull secret to authenticate with container registries. If the dashboard shows "No pull secret detected":

1. Upload a pull secret via **Settings > Pull Secret** in the UI
2. Or place it at `pull-secret/pull-secret.json` before building the container

The pull secret must be valid JSON in the standard Docker/Podman auth format with an `auths` key.

To verify registry authentication, use the **Settings > Registry** tab — it shows auto-detected registries from your pull secret and can test authentication against each one.

## Catalog data issues

Mirror-GUI bundles pre-fetched operator catalog metadata at build time. If operators or channels appear missing or outdated:

1. Use **Settings > Sync Catalogs** to fetch the latest catalog metadata from registry.redhat.io
2. This requires a valid pull secret with access to `registry.redhat.io`
3. The sync processes three catalog types (Red Hat, Certified, Community) across OCP 4.16–4.22

If the sync fails, check that your pull secret has valid credentials for `registry.redhat.io`. See the sync logs in the Settings tab for specific errors.

To reset to built-in catalog data, use the "Clear Synced Data" option in the Sync Catalogs tab.

## Mirror operation failures

When a mirror operation fails:

1. Check the operation logs — click on the failed operation in **Mirror Operations** or **History** to view logs
2. Common issues:
   - **Authentication failures**: Verify pull secret credentials for the source registries
   - **Disk space**: Check available disk space in the mirror destination and cache directories
   - **Invalid configuration**: Verify the ImageSetConfiguration YAML is valid — the config builder validates structure on save
   - **Network issues**: Ensure the container can reach the source registries

## GPG signature errors

**Invalid GPG signature for operator index images** — This is a known issue with some Red Hat operator index images. See [Red Hat KB article](https://access.redhat.com/solutions/6542281) for resolution.

## Cache issues

The oc-mirror cache can grow large over time. To clean it up:

1. Use **Settings > Cache** to view cache size and clean up
2. Or restart the container — the cache is ephemeral unless a persistent volume is mounted via `CACHE_DIR`

## Development issues

### Tests failing locally

```bash
# Ensure dependencies are installed
npm ci

# Run tests with verbose output
npm test -- --reporter=verbose

# Run a specific test file
npx vitest run tests/unit/utils.test.ts
```

### E2E tests failing

E2E tests require Playwright browsers to be installed:

```bash
npx playwright install chromium
npm run test:e2e
```

### Port conflicts in development

The development server runs on port 3001 by default. If this conflicts:

```bash
PORT=3002 npm run dev
```
