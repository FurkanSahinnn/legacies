import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { detectCatalog, matchDetect, scanProject } from '../scripts/lib/detect.mjs';
import { gitRepo, tempDir, write } from './helpers.mjs';

function project(files) {
  const root = tempDir();
  for (const [rel, content] of Object.entries(files)) write(root, rel, content);
  return root;
}

test('scanProject reads npm dependencies from every package.json outside node_modules', () => {
  const root = project({
    'package.json': JSON.stringify({ devDependencies: { turbo: '2' } }),
    'apps/web/package.json': JSON.stringify({ dependencies: { next: '15', react: '19' } }),
    'node_modules/vue/package.json': JSON.stringify({ dependencies: { '@vue/shared': '3' } }),
  });
  assert.deepEqual([...scanProject(root).deps.npm].sort(), ['next', 'react', 'turbo']);
});

test('scanProject reads Python dependencies from requirements files and pyproject.toml', () => {
  const root = project({
    'requirements/base.txt': 'Django>=5.0\npsycopg[binary]==3.2 ; python_version > "3.10"\n# comment\n-r other.txt\n',
    'pyproject.toml': '[project]\nname = "api"\ndependencies = [\n  "FastAPI>=0.110",\n  "pydantic_settings",\n]\n[tool.poetry.dependencies]\npython = "^3.12"\ncelery = "^5"\n',
  });
  assert.deepEqual([...scanProject(root).deps.pypi].sort(), ['celery', 'django', 'fastapi', 'psycopg', 'pydantic-settings']);
});

test('scanProject reads Go, Rust, Ruby, PHP, Dart and .NET dependencies', () => {
  const root = project({
    'go.mod': 'module example.com/api\n\ngo 1.22\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.10.0\n)\nrequire github.com/jackc/pgx/v5 v5.6.0\n',
    'Cargo.toml': '[package]\nname = "svc"\n[dependencies]\naxum = "0.7"\ntokio = { version = "1", features = ["full"] }\n',
    'Gemfile': "source 'https://rubygems.org'\ngem 'rails', '~> 8.0'\n",
    'composer.json': JSON.stringify({ require: { 'laravel/framework': '^11' } }),
    'mobile/pubspec.yaml': 'name: app\ndependencies:\n  flutter:\n    sdk: flutter\n  dio: ^5.0.0\ndev_dependencies:\n  flutter_test:\n    sdk: flutter\n',
    'src/Api/Api.csproj': '<Project><ItemGroup><PackageReference Include="Microsoft.EntityFrameworkCore" Version="8.0.0" /></ItemGroup></Project>',
  });
  const { deps } = scanProject(root);
  assert.deepEqual([...deps.go].sort(), ['github.com/gin-gonic/gin', 'github.com/jackc/pgx/v5']);
  assert.deepEqual([...deps.cargo].sort(), ['axum', 'tokio']);
  assert.deepEqual([...deps.gem], ['rails']);
  assert.deepEqual([...deps.composer], ['laravel/framework']);
  assert.deepEqual([...deps.pub].sort(), ['dio', 'flutter', 'flutter_test']);
  assert.deepEqual([...deps.nuget], ['microsoft.entityframeworkcore']);
});

test('scanProject lists what is on disk, not files git still tracks after they were deleted or moved', () => {
  const root = gitRepo();
  fs.renameSync(path.join(root, 'src', 'auth', 'session.ts'), path.join(root, 'session.ts'));
  const files = scanProject(root).files;
  assert.ok(files.includes('session.ts'));
  assert.equal(files.includes('src/auth/session.ts'), false);
});

test('scanProject leaves out test fixtures and examples, which say nothing about the project\'s own stack', () => {
  const facts = scanProject(project({
    'pyproject.toml': '[project]\nname = "tool"\n',
    'tests/fixtures/sample.csproj': '<Project />\n',
    'examples/rust-demo/Cargo.toml': '[dependencies]\naxum = "0.7"\n',
    'src/__fixtures__/package.json': JSON.stringify({ dependencies: { vue: '3' } }),
  }));
  assert.deepEqual(facts.files, ['pyproject.toml']);
});

test('matchDetect matches a marker file by its name at any depth or by a path ending, as in monorepos', () => {
  const facts = scanProject(project({ 'apps/web/next.config.ts': 'export default {}\n', 'apps/api/prisma/schema.prisma': 'datasource db {}\n' }));
  assert.deepEqual(matchDetect({ files: ['next.config.*'] }, facts).reasons, ['apps/web/next.config.ts']);
  assert.deepEqual(matchDetect({ files: ['prisma/schema.prisma'] }, facts).reasons, ['apps/api/prisma/schema.prisma']);
  assert.deepEqual(matchDetect({ dirs: ['api/prisma'] }, facts).reasons, ['apps/api/prisma/']);
  assert.equal(matchDetect({ files: ['eb/next.config.ts'] }, facts).reasons.length, 0);
});

test('matchDetect calls a match on a handful of files of one extension weak', () => {
  const few = scanProject(project({ 'scripts/a.py': '', 'scripts/b.py': '' }));
  const many = scanProject(project(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`src/m${i}.py`, '']))));
  assert.equal(matchDetect({ files: ['*.py'] }, few).weak, true);
  assert.equal(matchDetect({ files: ['*.py'] }, many).weak, false);
});

test('matchDetect counts one project file such as *.csproj as a strong marker', () => {
  const facts = scanProject(project({ 'src/Api/Api.csproj': '<Project />\n' }));
  assert.deepEqual(matchDetect({ files: ['*.csproj'] }, facts), { reasons: ['src/Api/Api.csproj'], weak: false });
});

test('matchDetect anchors a pattern that starts with / at the project root', () => {
  const native = scanProject(project({ 'app/src/main/AndroidManifest.xml': '<manifest />\n' }));
  const reactNative = scanProject(project({ 'android/app/src/main/AndroidManifest.xml': '<manifest />\n' }));
  assert.equal(matchDetect({ files: ['/*/src/main/AndroidManifest.xml'] }, native).reasons.length, 1);
  assert.equal(matchDetect({ files: ['/*/src/main/AndroidManifest.xml'] }, reactNative).reasons.length, 0);
});

test('matchDetect matches dependencies, compose images and text inside files', () => {
  const facts = scanProject(project({
    'package.json': JSON.stringify({ dependencies: { '@nutrient-sdk/viewer': '1' } }),
    'docker-compose.yml': 'services:\n  db:\n    image: "postgres:16-alpine"\n  cache:\n    image: redis\n',
    'infra/main.tf': 'provider "aws" {\n  region = "eu-west-1"\n}\n',
  }));
  assert.deepEqual(matchDetect({ npm: ['@nutrient-sdk/*'] }, facts).reasons, ['package.json: @nutrient-sdk/viewer']);
  assert.deepEqual(matchDetect({ compose: ['postgres', 'mysql'] }, facts).reasons, ['docker-compose: postgres']);
  assert.deepEqual(matchDetect({ contains: [{ files: '*.tf', text: 'provider "aws"' }] }, facts).reasons, ['infra/main.tf: provider "aws"']);
  assert.equal(matchDetect({ compose: ['mysql'], npm: ['pg'] }, facts).reasons.length, 0);
});

test('detectCatalog suggests matched packs and plugins with their reasons', () => {
  const facts = scanProject(project({ 'go.mod': 'module x\n\ngo 1.22\n' }));
  const registry = {
    packs: [
      { id: 'go', members: [{}], detect: { files: ['go.mod'] } },
      { id: 'rust', members: [{}], detect: { files: ['Cargo.toml'] } },
    ],
    official: [{ name: 'gopls-lsp', detect: { files: ['go.mod'] } }, { name: 'vercel', detect: {} }],
  };
  const result = detectCatalog(registry, facts);
  assert.deepEqual(result.packs, [{ id: 'go', reasons: ['go.mod'], weak: false }]);
  assert.deepEqual(result.official, [{ name: 'gopls-lsp', reasons: ['go.mod'], weak: false }]);
});

test('detectCatalog suggests a pack marked recommend: always in every project', () => {
  const facts = scanProject(project({ 'README.md': '# x\n' }));
  const registry = { packs: [{ id: 'security', recommend: 'always', members: [{}], detect: {} }], official: [] };
  assert.deepEqual(detectCatalog(registry, facts).packs, [{ id: 'security', reasons: ['her projede önerilir'], weak: false }]);
});

test('the catalog does not suggest Cypress for a folder that is only named cypress', () => {
  const registry = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '..', 'catalog', 'registry.json'), 'utf8'));
  const facts = scanProject(project({ 'packs/cypress/skills/cypress-testing/SKILL.md': '# Cypress\n' }));
  assert.equal(detectCatalog(registry, facts).packs.some((p) => p.id === 'cypress'), false);
});

test('detectCatalog leaves out packs that live in the core plugin', () => {
  const facts = scanProject(project({ 'README.md': '# x\n' }));
  const registry = { packs: [{ id: 'core', recommend: 'always', members: [], inCore: ['skill:recall'], detect: {} }], official: [] };
  assert.deepEqual(detectCatalog(registry, facts).packs, []);
});
