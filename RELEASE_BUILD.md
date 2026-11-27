# Signalyn production release build

This recipe is for the Cloud Run web service. The existing migration Dockerfile
and Cloud Build file package a different entrypoint and remain independent.
Approval to review this recipe does not trigger a build, publish, or deployment.

- Select the exact approved GitHub main commit after the workspace, startup
  safety, and recipe changes land. Export its tracked files from a clean
  checkout or Git archive. Set the build arguments SOURCE_SHA and
  SOURCE_COMMIT_TIMESTAMP from that commit. Use Linux amd64 and the pinned
  Node.js image in Dockerfile.release. The release uses package-lock.json and
  the npm bundled with the pinned base.
- The frontend stage produces dist/index.html, static assets, and the release
  manifest. The server runs the selected TypeScript source with the locked tsx
  dependency. The Cloud Run container port must be 8080. There is no alternate
  server entrypoint. Before publishing, smoke-test the final runtime image on an
  isolated network with mocked or emulator dependencies.
- The build context excludes .env files, historical runtime data, and AI Studio
  attachments. The tracked Firebase web configuration is public browser
  configuration. Verify that its API identifier is restricted to the expected
  Firebase uses and that no privileged credential appears in the archive,
  image layers, or output. Supply Gemini and other privileged credentials only
  at runtime. Legacy admin operations requiring .data inputs need explicitly
  staged inputs before use.
- Use a release-only Artifact Registry repository or namespace in us-west1.
  Publish under an immutable commit/release tag and record the resolved digest.
  Use the approved builder's artifact publishing integration for provenance.
  Record source SHA, base digest, lockfile hash, builder details, runtime
  command and image digest. Preserve all serving and rollback digests through
  the approved retention window. Test cleanup rules in dry-run mode first.
- Deploy only by digest with zero traffic initially. Retain the previous
  revision, its image and runtime secret-version references. After separately
  approved health, authentication, and acceptance checks, move traffic in
  controlled increments. Roll back by explicitly routing all traffic to the
  previous known-good revision and validating the published URL and logs.
  Roll back any approved data changes independently.

Pinned inputs and recorded provenance make builds traceable and repeatable.
Byte-for-byte reproducibility requires two independent builds with matching
image digests and has not been established.
