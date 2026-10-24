import test from 'node:test';
import assert from 'node:assert/strict';
import { cli, commit, gitRepo, initMemory, write } from './helpers.mjs';

// Only the project's translation file can map "fidan" (seedling) to the code's word; map shows the words it added.
function gardenProject(translations) {
  const root = gitRepo();
  for (const [file, text] of Object.entries(translations)) write(root, file, text);
  write(root, 'garden/watering.py', 'def water_seedling(seedling_id):\n    return schedule_watering(seedling_id)\n');
  write(root, 'garden/harvest.py', 'def harvest_crop(crop_id):\n    return crop_id\n');
  commit(root, 'garden');
  initMemory(root);
  const res = cli(root, ['map', 'fidanları ne zaman suluyoruz, hangi kod?']);
  assert.equal(res.status, 0, res.stderr);
  return res.stdout;
}

test('a gettext catalog maps Turkish words to the code\'s English ones', () => {
  const text = gardenProject({
    'locale/tr/LC_MESSAGES/django.po': 'msgid "Water the seedling"\nmsgstr "Fidanı sula"\n\nmsgid "Seedling list"\nmsgstr "Fidan listesi"\n\nmsgid "New seedling"\nmsgstr "Yeni fidan"\n',
  });
  assert.match(text, /\(Sözlük: [^)]*\bseedling/);
});

test('YAML locale files map Turkish words to the code\'s English ones', () => {
  const text = gardenProject({
    'config/locales/tr.yml': 'tr:\n  seedlings:\n    water: "Fidanı sula"\n    list: "Fidan listesi"\n    create: "Yeni fidan"\n',
    'config/locales/en.yml': 'en:\n  seedlings:\n    water: "Water the seedling"\n    list: "Seedling list"\n    create: "New seedling"\n',
  });
  assert.match(text, /\(Sözlük: [^)]*\bseedling/);
});

test('Android string resources map Turkish words to the code\'s English ones', () => {
  const text = gardenProject({
    'app/src/main/res/values-tr/strings.xml': '<resources>\n  <string name="seedling_water">Fidanı sula</string>\n  <string name="seedling_list">Fidan listesi</string>\n  <string name="seedling_new">Yeni fidan</string>\n</resources>\n',
    'app/src/main/res/values/strings.xml': '<resources>\n  <string name="seedling_water">Water the seedling</string>\n  <string name="seedling_list">Seedling list</string>\n  <string name="seedling_new">New seedling</string>\n</resources>\n',
  });
  assert.match(text, /\(Sözlük: [^)]*\bseedling/);
});

// Without the project's own translations nothing is guessed: the model translates with legacies vocab.
test('map adds no dictionary words when the project has no translation files', () => {
  const root = gitRepo();
  write(root, 'accounts/password_reset.py', 'def send_reset_email(user):\n    token = make_token(user)\n    return mail(user.email, token)\n');
  commit(root, 'accounts');
  initMemory(root);
  const res = cli(root, ['map', 'şifre sıfırlama e-postası nerede gönderiliyor?']);
  assert.equal(res.status, 0, res.stderr);
  assert.doesNotMatch(res.stdout, /Sözlük/);
});
