'use strict';

// test/release-script.test.js
// 覆盖 scripts/release.js 导出的纯逻辑（版本解析、CHANGELOG 变换、footer 更新、
// 模板渲染、参数解析）。副作用步骤（git / npm / gh）不在单测范围。

const test = require('node:test');
const assert = require('node:assert');

const release = require('../scripts/release.js');

test('parseArgs: 解析 --version / --yes / --no-ci / --dry-run', () => {
  const base = ['node', 'release.js'];
  assert.deepStrictEqual(release.parseArgs([...base, '--version', '1.2.3']), {
    version: '1.2.3',
    dryRun: false,
    yes: false,
    noCi: false,
  });
  assert.deepStrictEqual(release.parseArgs([...base, '--version', 'patch', '--yes', '--no-ci', '--dry-run']), {
    version: 'patch',
    dryRun: true,
    yes: true,
    noCi: true,
  });
  assert.deepStrictEqual(release.parseArgs([...base, '-y']), {
    version: null,
    dryRun: false,
    yes: true,
    noCi: false,
  });
});

test('isValidSemver: 只接受 x.y.z', () => {
  assert.ok(release.isValidSemver('0.7.16'));
  assert.ok(release.isValidSemver('10.0.1'));
  assert.ok(!release.isValidSemver('v0.7.16'));
  assert.ok(!release.isValidSemver('0.7'));
  assert.ok(!release.isValidSemver('0.7.16-beta'));
  assert.ok(!release.isValidSemver('patch'));
});

test('compareSemver: 语义化比较', () => {
  assert.strictEqual(release.compareSemver('0.7.17', '0.7.16'), 1);
  assert.strictEqual(release.compareSemver('0.7.16', '0.7.16'), 0);
  assert.strictEqual(release.compareSemver('0.7.16', '0.8.0'), -1);
  assert.strictEqual(release.compareSemver('1.0.0', '0.9.9'), 1);
});

test('bumpVersion: patch/minor/major', () => {
  assert.strictEqual(release.bumpVersion('0.7.16', 'patch'), '0.7.17');
  assert.strictEqual(release.bumpVersion('0.7.16', 'minor'), '0.8.0');
  assert.strictEqual(release.bumpVersion('0.7.16', 'major'), '1.0.0');
  assert.throws(() => release.bumpVersion('0.7.16', 'nope'), /Unknown bump kind/);
  assert.throws(() => release.bumpVersion('bad', 'patch'), /Invalid current version/);
});

test('resolveVersion: 关键字派生 + 直传 semver + 大小写', () => {
  assert.strictEqual(release.resolveVersion('patch', '0.7.16'), '0.7.17');
  assert.strictEqual(release.resolveVersion('MINOR', '0.7.16'), '0.8.0');
  assert.strictEqual(release.resolveVersion('0.9.0', '0.7.16'), '0.9.0');
  assert.strictEqual(release.resolveVersion('', '0.7.16'), null);
  assert.strictEqual(release.resolveVersion(null, '0.7.16'), null);
});

test('todayISO: 固定日期格式化补零', () => {
  assert.strictEqual(release.todayISO(new Date(2026, 0, 5)), '2026-01-05');
  assert.strictEqual(release.todayISO(new Date(2026, 11, 31)), '2026-12-31');
});

test('closeChangelogContent: 保留空 [Unreleased] 并开新版本段', () => {
  const input = [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '## [0.7.16] - 2026-07-15',
    '',
    '- old entry',
  ].join('\n');
  const out = release.closeChangelogContent(input, '0.7.17', '2026-07-20');
  assert.ok(out.includes('## [Unreleased]'));
  assert.ok(out.includes('## [0.7.17] - 2026-07-20'));
  // 新版本段应位于旧 [0.7.16] 段之前
  assert.ok(out.indexOf('## [0.7.17]') < out.indexOf('## [0.7.16]'));
  // 仍保留一个可继续追加的空 Unreleased（位于最前）
  assert.ok(out.indexOf('## [Unreleased]') < out.indexOf('## [0.7.17]'));
});

test('closeChangelogContent: 缺少 [Unreleased] 抛错', () => {
  assert.throws(
    () => release.closeChangelogContent('# Changelog\n\n## [0.7.16]', '0.7.17', '2026-07-20'),
    /Unreleased/
  );
});

test('updateChangelogFooter: 改写 compare 链接并追加版本链接', () => {
  const base = 'https://github.com/LetitiaChan/clawd-on-desk/compare/';
  const input = [
    'text',
    `[Unreleased]: ${base}v0.7.16...HEAD`,
    `[0.7.16]: ${base}v0.7.15...v0.7.16`,
  ].join('\n');
  const { content, changed } = release.updateChangelogFooter(input, '0.7.16', '0.7.17');
  assert.strictEqual(changed, true);
  assert.ok(content.includes(`[Unreleased]: ${base}v0.7.17...HEAD`));
  assert.ok(content.includes(`[0.7.17]: ${base}v0.7.16...v0.7.17`));
  // 原 0.7.16 链接保持不变
  assert.ok(content.includes(`[0.7.16]: ${base}v0.7.15...v0.7.16`));
});

test('updateChangelogFooter: 找不到匹配时 best-effort 原样返回', () => {
  const input = 'no footer here';
  const { content, changed } = release.updateChangelogFooter(input, '0.7.16', '0.7.17');
  assert.strictEqual(changed, false);
  assert.strictEqual(content, input);
});

test('renderTemplate: 替换所有 {VERSION} 占位符', () => {
  const tpl = '## v{VERSION}\n\nrelease-v{VERSION}.md';
  assert.strictEqual(release.renderTemplate(tpl, '0.7.17'), '## v0.7.17\n\nrelease-v0.7.17.md');
});

test('escapeRegExp: 转义正则特殊字符', () => {
  assert.strictEqual(release.escapeRegExp('0.7.16'), '0\\.7\\.16');
});
