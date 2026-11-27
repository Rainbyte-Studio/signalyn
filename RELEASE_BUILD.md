# Signalyn production release build

This recipe is for the Cloud Run web service. The existing migration Dockerfile
and Cloud Build file package a different entrypoint and remain independent.
Approval to review this recipe does not trigger a build, publish, or deployment.

- Select the exact approved GitHub main commit after the workspace, startup
  safety, and recipe changes land. Use Linux amd64 and the pinned Node.js
  image in Dockerfile.release. The release uses package-lock.json and the npm
  bundled with the pinned base.
- The pre-build gate is required. From a trusted checkout of the reviewed
  release tooling, run the following before any builder receives the archive.
  Use the full commit SHA and a new output path outside the repository.

  ```sh
  node scripts/release-context.mjs stage "$SOURCE_SHA" /secure/staging/context.tar
  node scripts/release-context.mjs verify "$SOURCE_SHA" /secure/staging/context.tar
  ```

  Save the sanitized JSON audit, including the SHA-256 and enumerated files.
  Stop on any failure. In the approved build job, use these same verified tar
  bytes as the sole input context (Docker context stdin), select
  `-f Dockerfile.release`, and pass the audit's `source` and
  `sourceCommitTimestamp` as `SOURCE_SHA` and `SOURCE_COMMIT_TIMESTAMP`.
  Keep the archive private and unchanged between verification and submission.
  Direct working-directory builds are outside this release workflow.
- The Git tree and tar entries are independently checked against exact paths.
  For a newly required source file, review and add its exact path to
  Dockerfile.release.dockerignore along with its importing code. Never
  substitute a source-directory wildcard. Run the gate tests with
  `node --test scripts/release-context.test.mjs`.

- The frontend stage produces dist/index.html, static assets, and the release
  manifest. The server runs the selected TypeScript source with the locked tsx
  dependency. The Cloud Run container port must be 8080. There is no alternate
  server entrypoint. Before publishing, smoke-test the final runtime image on an
  isolated network with mocked or emulator dependencies.
- The build context excludes .env files, historical runtime data, and AI Studio
  attachments. The tracked Firebase web configuration is public browser
  configuration. The gate checks the configuration fields and their formats. Independently verify that its API identifier is restricted to the expected
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
