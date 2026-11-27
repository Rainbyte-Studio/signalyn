import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { inspectArchive, loadPolicy, stageContext } from './release-context.mjs';

const policyName = 'Dockerfile.release.dockerignore';
const pinnedPaths = [policyName, 'Dockerfile.release', 'firebase-applet-config.json', 'src/main.ts', 'src/index.css'];
const firebaseFixture = {
  projectId: 'fixture-app',
  appId: '1:123456:web:abcdef',
  apiKey: 'AIza' + 'A'.repeat(35),
  authDomain: 'fixture-app.firebaseapp.com',
  firestoreDatabaseId: 'fixture-db',
  storageBucket: 'fixture-app.appspot.com',
  messagingSenderId: '123456',
  measurementId: '',
  oAuthClientId: '123456-fixture.apps.googleusercontent.com',
  recaptchaSiteKey: '',
};
const githubFixture = 'ghp_' + 'x'.repeat(36);
const fixturePem = ['-----BEGIN PRIVATE KEY-----', 'synthetic fixture', '-----END PRIVATE KEY-----'].join('\n');

function fixture(t) {
  const path = mkdtempSync(join(tmpdir(), 'signalyn-release-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: path, windowsHide: true });
  git('init', '-q');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'Release Fixture');
  git('config', 'core.autocrlf', 'false');
  mkdirSync(join(path, 'src', 'nested'), { recursive: true });
  const put = (name, contents) => writeFileSync(join(path, name), contents);
  put(policyName, '**\n' + pinnedPaths.map((name) => '!' + name).join('\n') + '\n');
  put('Dockerfile.release', 'FROM scratch\n');
  put('firebase-applet-config.json', JSON.stringify(firebaseFixture));
  put('src/main.ts', 'import "./index.css"; export const ready = true;\n');
  put('src/index.css', 'body { color: blue }\n');
  return {
    path, put, git,
    snapshot() {
      git('add', '--all');
      git('commit', '-qm', 'fixture snapshot');
      return git('rev-parse', 'HEAD').toString().trim();
    },
  };
}

test('stages and audits exact committed application modules and styles', (t) => {
  const repo = fixture(t);
  const source = repo.snapshot();
  repo.put('src/main.ts', 'working tree is different');
  repo.git('add', 'src/main.ts');
  const { archive, audit } = stageContext(source, repo.path);
  assert.deepEqual(audit.files, [...pinnedPaths].sort());
  assert.ok(archive.includes('export const ready'));
  assert.ok(!archive.includes('working tree is different'));
  assert.match(audit.archiveSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(stageContext(source, repo.path).archive, archive);
  assert.throws(() => inspectArchive(archive.subarray(0, 512), source, loadPolicy(repo.path)), /Truncated|trailer/);
  assert.throws(() => inspectArchive(archive, 'a'.repeat(40), loadPolicy(repo.path)), /commit record/);
});

for (const [name, contents] of [
  ['src/credentials.json', '{"private_key":"synthetic-fixture"}'],
  ['src/.npmrc', '//registry.example.invalid/:_authToken=synthetic-fixture'],
  ['src/nested/.env.production', 'API_KEY=synthetic-fixture'],
  ['src/nested/signing.pem', fixturePem],
  ['src/nested/service-account.json', '{"type":"service_account","private_key":"synthetic-fixture"}'],
  ['src/nested/harmless.txt', githubFixture],
  ['src/nested/new-module.ts', 'export const unexpected = true;'],
]) {
  test('rejects a tracked extra input ' + name + ' at both gates', (t) => {
    const repo = fixture(t);
    repo.put(name, contents);
    const source = repo.snapshot();
    assert.throws(() => stageContext(source, repo.path), /unexpected release source file/);
    const supplied = repo.git('archive', '--format=tar', source);
    assert.throws(() => inspectArchive(supplied, source, loadPolicy(repo.path)), /Unexpected/);
  });
}

for (const contents of [fixturePem, githubFixture, '{"type":"service_account","private_key":"synthetic-fixture"}',
  'const access_token = "synthetic-token-under-unexpected-name";']) {
  test('rejects credential content inside an approved source path without echoing content', (t) => {
    const repo = fixture(t);
    repo.put('src/main.ts', contents);
    const source = repo.snapshot();
    assert.throws(() => stageContext(source, repo.path), (error) => error.message === 'Potential privileged credential detected.');
    assert.throws(() => inspectArchive(repo.git('archive', '--format=tar', source), source, loadPolicy(repo.path)),
      (error) => error.message === 'Potential privileged credential detected.');
  });
}

test('rejects a tracked symlink at an otherwise-approved path before staging', (t) => {
  const repo = fixture(t);
  repo.snapshot();
  repo.put('outside-target', '../../not-in-the-context');
  const blob = repo.git('hash-object', '-w', 'outside-target').toString().trim();
  repo.git('update-index', '--cacheinfo', '120000,' + blob + ',src/main.ts');
  repo.git('commit', '-qm', 'link fixture');
  const source = repo.git('rev-parse', 'HEAD').toString().trim();
  assert.throws(() => stageContext(source, repo.path), /link or non-file/);
  const bytes = repo.git('archive', '--format=tar', source, '--', ...pinnedPaths);
  assert.throws(() => inspectArchive(bytes, source, loadPolicy(repo.path)), /link or unsupported/);
});


test('rejects an extra privileged Firebase field and duplicate API key properties', (t) => {
  const repo = fixture(t);
  repo.put('firebase-applet-config.json', JSON.stringify({ ...firebaseFixture, private_key: 'synthetic-fixture' }));
  assert.throws(() => stageContext(repo.snapshot(), repo.path), /Unexpected Firebase configuration/);
  const configuration = JSON.stringify(firebaseFixture);
  repo.put('firebase-applet-config.json', '{"apiKey":"' + githubFixture + '",' + configuration.slice(1));
  assert.throws(() => stageContext(repo.snapshot(), repo.path), /Unexpected Firebase configuration encoding/);
});
