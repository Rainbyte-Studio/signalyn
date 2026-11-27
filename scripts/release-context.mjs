import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const policyName = 'Dockerfile.release.dockerignore';
const shaPattern = /^[0-9a-f]{40}$/;
const limit = 16 * 1024 * 1024;
const utf8 = new TextDecoder('utf-8', { fatal: true });
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

class RejectedContext extends Error {}

function requireCondition(condition, reason) {
  if (!condition) throw new RejectedContext(reason);
}

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, maxBuffer: limit, windowsHide: true });
  requireCondition(result.status === 0 && result.stdout, 'Git inspection failed.');
  return result.stdout;
}

export function loadPolicy(cwd = root) {
  const text = utf8.decode(readFileSync(resolve(cwd, policyName))).replace(/\r\n/g, '\n');
  const lines = text.trimEnd().split('\n');
  requireCondition(lines.shift() === '**', 'Invalid release allowlist.');
  const paths = lines.map((line) => {
    requireCondition(/^![A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(line), 'Allowlist must contain exact paths.');
    const path = line.slice(1);
    requireCondition(!path.split('/').some((part) => part === '.' || part === '..'), 'Unsafe allowlist path.');
    requireCondition(!/(^|\/)(?:\.env(?:\.|$)|\.npmrc(?:\.|$))/i.test(path), 'Forbidden configuration path.');
    return path;
  });
  requireCondition(paths.includes(policyName) && new Set(paths).size === paths.length, 'Invalid release allowlist.');
  return { paths, text };
}

const credentials = [
  /-----BEGIN [A-Z0-9 ]*(?:PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----/i,
  /\b(?:AIza[\w-]{35}|ya29\.[\w-]{15,}|GOCSPX-[\w-]{15,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[\w]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16}|xox[baprs]-[\w-]{10,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,})\b/,
  /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{12,}\b/,
  /["'](?:type|credential_source)["']\s*:\s*["'](?:service_account|external_account|authorized_user)["']/i,
  /(?:^|[\s"'.,{])(?:[\w-]*[_-])?(?:private[_-]?key|client[_-]?secret|refresh[_-]?token|access[_-]?token|api[_-]?key|auth[_-]?token|password|_authToken|_auth)["']?\s*[:=]\s*["'][^"'\s]{8,}["']/im,
  /(?:^|\n)\s*(?:[\w-]*[_-])?(?:api[_-]?key|auth[_-]?token|access[_-]?token|client[_-]?secret|password)\s*=\s*[^ \t\r\n"'$#]{8,}/i,
  /\b(?:https?|postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^/\s:@]+:[^/\s@]+@/i,
];

const firebaseFields = {
  projectId: /^[a-z][a-z0-9-]{4,29}$/,
  appId: /^1:\d+:web:[a-f0-9]+$/,
  apiKey: /^AIza[A-Za-z0-9_-]{35}$/,
  authDomain: /^[a-z0-9-]+\.(?:firebaseapp\.com|web\.app)$/,
  firestoreDatabaseId: /^[a-z0-9()-]+$/,
  storageBucket: /^[a-z0-9.-]+\.(?:appspot\.com|firebasestorage\.app)$/,
  messagingSenderId: /^\d+$/,
  measurementId: /^(?:G-[A-Z0-9]+)?$/,
  oAuthClientId: /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/,
  recaptchaSiteKey: /^(?:6L[A-Za-z0-9_-]{25,})?$/,
};

function inspectText(path, bytes, policy) {
  let text = utf8.decode(bytes);
  requireCondition(!text.includes('\0'), 'Binary or unsupported content.');
  if (path === policyName) {
    requireCondition(text.replace(/\r\n/g, '\n') === policy.text, 'Archived allowlist differs from the reviewed policy.');
  }
  if (path === 'firebase-applet-config.json') {
    const config = JSON.parse(text);
    requireCondition(config && Object.keys(config).length === Object.keys(firebaseFields).length &&
      Object.entries(firebaseFields).every(([key, shape]) => typeof config[key] === 'string' && shape.test(config[key])),
    'Unexpected Firebase configuration.');
    requireCondition(config.authDomain === config.projectId + '.firebaseapp.com' ||
      config.authDomain === config.projectId + '.web.app', 'Unexpected Firebase auth domain.');
    requireCondition(config.appId.startsWith('1:' + config.messagingSenderId + ':web:') &&
      (config.storageBucket === config.projectId + '.appspot.com' ||
        config.storageBucket === config.projectId + '.firebasestorage.app'),
    'Unexpected Firebase project configuration.');
    requireCondition(!text.includes('\\') && (text.match(/"apiKey"\s*:/g) ?? []).length === 1,
      'Unexpected Firebase configuration encoding.');
    text = text.replace(/"apiKey"\s*:\s*"AIza[A-Za-z0-9_-]{35}"/, '"apiKey":null');
  }
  requireCondition(!credentials.some((pattern) => pattern.test(text)), 'Potential privileged credential detected.');
}

function octal(field) {
  const text = field.toString('ascii').replace(/\0.*$/s, '').trim();
  requireCondition(/^[0-7]+$/.test(text), 'Invalid tar number.');
  return Number.parseInt(text, 8);
}

function tarText(field) {
  const end = field.indexOf(0);
  return utf8.decode(end === -1 ? field : field.subarray(0, end));
}

// Git's tar format uses plain headers and one global PAX commit record for this fixed path set.
export function inspectArchive(archive, source, policy) {
  requireCondition(shaPattern.test(source) && archive.length <= limit && archive.length % 512 === 0,
    'Invalid source or archive size.');
  const allowed = new Set(policy.paths);
  const directories = new Set();
  for (const path of allowed) {
    for (let parent = dirname(path); parent !== '.'; parent = dirname(parent)) directories.add(parent);
  }
  const files = new Set();
  const seenDirs = new Set();
  let sawCommit = false;
  let offset = 0;
  for (; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const checksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    requireCondition(checksum === octal(header.subarray(148, 156)) &&
      tarText(header.subarray(257, 263)) === 'ustar' &&
      header.subarray(345, 500).every((byte) => byte === 0), 'Unsupported tar header.');
    const name = tarText(header.subarray(0, 100));
    const size = octal(header.subarray(124, 136));
    const start = offset + 512;
    const next = start + Math.ceil(size / 512) * 512;
    requireCondition(Number.isSafeInteger(size) && next <= archive.length, 'Truncated tar entry.');
    const contents = archive.subarray(start, start + size);
    switch (header[156]) {
      case 103: {
        const record = 'comment=' + source + '\n';
        const pax = (record.length + 3) + ' ' + record;
        requireCondition(offset === 0 && name === 'pax_global_header' && utf8.decode(contents) === pax,
          'Missing or unexpected Git commit record.');
        sawCommit = true;
        break;
      }
      case 53: {
        const directory = name.replace(/\/$/, '');
        requireCondition(size === 0 && directories.has(directory) && !seenDirs.has(directory), 'Unexpected archive directory.');
        seenDirs.add(directory);
        break;
      }
      case 48:
      case 0:
        requireCondition(allowed.has(name) && !files.has(name), 'Unexpected or duplicate archive file.');
        inspectText(name, contents, policy);
        files.add(name);
        break;
      default:
        throw new RejectedContext('Archive contains a link or unsupported entry.');
    }
    offset = next;
  }
  requireCondition(sawCommit && archive.length - offset >= 1024 &&
    archive.subarray(offset).every((byte) => byte === 0), 'Invalid archive trailer.');
  requireCondition(files.size === allowed.size, 'Required release input missing.');
  return { source, archiveSha256: sha256(archive), files: [...files].sort() };
}

export function stageContext(source, cwd = root) {
  requireCondition(shaPattern.test(source), 'Use an exact lowercase Git commit SHA.');
  requireCondition(git(['rev-parse', '--verify', source + '^{commit}'], cwd).toString().trim() === source,
    'Source must be an exact Git commit.');
  const policy = loadPolicy(cwd);
  const paths = new Set(policy.paths);
  const tree = utf8.decode(git(['ls-tree', '-rz', source], cwd)).split('\0').filter(Boolean);
  for (const record of tree) {
    const match = /^([0-7]{6}) (\w+) [0-9a-f]{40}\t(.+)$/s.exec(record);
    requireCondition(match, 'Invalid Git tree entry.');
    const [, mode, type, path] = match;
    if (path === 'src' || path.startsWith('src/') || paths.has(path)) {
      requireCondition(paths.has(path), 'Git tree contains an unexpected release source file.');
      requireCondition(type === 'blob' && (mode === '100644' || mode === '100755'), 'Git tree contains a link or non-file input.');
    }
  }
  const archive = git(['-c', 'tar.umask=0022', 'archive', '--format=tar', source, '--', ...policy.paths], cwd);
  const audit = inspectArchive(archive, source, policy);
  return { archive, audit: { ...audit, sourceCommitTimestamp: git(['show', '-s', '--format=%cI', source], cwd).toString().trim() } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [action, source, path, ...extra] = process.argv.slice(2);
    requireCondition((action === 'stage' || action === 'verify') && source && path && extra.length === 0,
      'Usage: node scripts/release-context.mjs stage|verify <commit-sha> <tar-path>.');
    const { archive, audit } = stageContext(source);
    if (action === 'stage') {
      writeFileSync(path, archive, { flag: 'wx', mode: 0o600 });
    } else {
      const submitted = readFileSync(path);
      inspectArchive(submitted, source, loadPolicy());
      requireCondition(submitted.equals(archive), 'Archive differs from the verified Git archive.');
    }
    process.stdout.write(JSON.stringify({ status: 'PASS', ...audit }, null, 2) + '\n');
  } catch (error) {
    process.stderr.write(JSON.stringify({
      status: 'REJECTED',
      reason: error instanceof RejectedContext ? error.message : 'Inspection or staging failed.',
    }) + '\n');
    process.exitCode = 1;
  }
}
