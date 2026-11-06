const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.DB_PATH = path.join(__dirname, '..', 'data', `test_voice_${Date.now()}.sqlite`);

const { getDb } = require('../src/db/database');
const voiceService = require('../src/services/voiceService');

function createSampleWavBuffer(durationSec = 2.0, sampleRate = 16000) {
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // Mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);

  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const val = Math.floor(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 16000);
    buffer.writeInt16LE(val, 44 + i * 2);
  }

  return buffer;
}

test('Voice Library & Zero-Shot TTS Suite', async (t) => {
  const db = getDb();
  const tmpDir = path.join(__dirname, '..', 'data', 'tmp_test_voices');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  await t.test('1. Migration 8: voice_library table exists with correct schema', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'voice_library'").all();
    assert.equal(tables.length, 1, 'voice_library table must exist');

    const columns = db.prepare('PRAGMA table_info(voice_library)').all().map((c) => c.name);
    assert.ok(columns.includes('id'), 'id column exists');
    assert.ok(columns.includes('name'), 'name column exists');
    assert.ok(columns.includes('duration_seconds'), 'duration_seconds column exists');
    assert.ok(columns.includes('file_path'), 'file_path column exists');
    assert.ok(columns.includes('is_active'), 'is_active column exists');
  });

  await t.test('2. Duration limit validation: reject audio exceeding 15 seconds', () => {
    const longWav = createSampleWavBuffer(18.0); // 18 seconds
    const longFile = path.join(tmpDir, 'long_sample.wav');
    fs.writeFileSync(longFile, longWav);

    assert.throws(
      () => {
        voiceService.createVoice({
          name: 'Long Voice Test',
          description: 'Should fail duration check',
          file: {
            path: longFile,
            originalname: 'long_sample.wav',
            mimetype: 'audio/wav',
          },
        });
      },
      (err) => {
        return err.code === 'VOICE_DURATION_EXCEEDED';
      },
      'Should reject audio with duration > 15s'
    );

    if (fs.existsSync(longFile)) fs.unlinkSync(longFile);
  });

  await t.test('3. Unsupported format validation: reject non-audio files', () => {
    const txtFile = path.join(tmpDir, 'sample.txt');
    fs.writeFileSync(txtFile, 'This is a text file');

    assert.throws(
      () => {
        voiceService.createVoice({
          name: 'Text File Test',
          file: {
            path: txtFile,
            originalname: 'sample.txt',
            mimetype: 'text/plain',
          },
        });
      },
      (err) => {
        return err.code === 'UNSUPPORTED_AUDIO_FORMAT';
      }
    );

    if (fs.existsSync(txtFile)) fs.unlinkSync(txtFile);
  });

  let createdVoiceId = null;

  await t.test('4. Upload and register valid reference audio under 15 seconds', () => {
    const validWav = createSampleWavBuffer(4.5); // 4.5 seconds
    const validFile = path.join(tmpDir, 'valid_speaker.wav');
    fs.writeFileSync(validFile, validWav);

    const voice = voiceService.createVoice({
      name: 'Ahmed Reference Voice',
      description: 'Official clear Arabic speaker tone',
      speakerGender: 'male',
      language: 'ar',
      file: {
        path: validFile,
        originalname: 'valid_speaker.wav',
        mimetype: 'audio/wav',
      },
    });

    assert.ok(voice.id.startsWith('voice_'));
    assert.equal(voice.name, 'Ahmed Reference Voice');
    assert.ok(voice.duration_seconds >= 4.0 && voice.duration_seconds <= 5.0);
    assert.equal(voice.is_active, 1);
    assert.ok(fs.existsSync(voice.file_path));

    createdVoiceId = voice.id;
  });

  await t.test('5. List and get reference voices', () => {
    const voices = voiceService.listVoices({ activeOnly: true });
    assert.ok(voices.length >= 1);
    assert.ok(voices.some((v) => v.id === createdVoiceId));

    const single = voiceService.getVoice(createdVoiceId);
    assert.equal(single.name, 'Ahmed Reference Voice');
  });

  await t.test('6. Update voice details and active status', () => {
    const updated = voiceService.updateVoice(createdVoiceId, {
      name: 'Ahmed Formal Tone',
      description: 'Updated formal description',
      isActive: false,
    });

    assert.equal(updated.name, 'Ahmed Formal Tone');
    assert.equal(updated.description, 'Updated formal description');
    assert.equal(updated.is_active, 0);

    // Should not show in activeOnly list
    const activeList = voiceService.listVoices({ activeOnly: true });
    assert.ok(!activeList.some((v) => v.id === createdVoiceId));

    // Reactivate
    voiceService.updateVoice(createdVoiceId, { isActive: true });
  });

  await t.test('7. Zero-Shot Voice Synthesis with Reference Audio', async () => {
    const result = await voiceService.synthesizeSpeech(
      'This is a speech synthesis test using the chosen reference voice.',
      createdVoiceId
    );

    assert.ok(result.audioBuffer instanceof Buffer);
    assert.ok(result.audioBuffer.length > 1000);
    assert.equal(result.mimeType, 'audio/wav');
    assert.equal(result.voiceId, createdVoiceId);
    assert.ok(result.durationEstimate > 0);

    // Verify WAV header
    assert.equal(result.audioBuffer.toString('ascii', 0, 4), 'RIFF');
    assert.equal(result.audioBuffer.toString('ascii', 8, 12), 'WAVE');
  });

  await t.test('8. Delete voice removes file and database record', () => {
    const voice = voiceService.getVoice(createdVoiceId);
    const filePath = voice.file_path;
    assert.ok(fs.existsSync(filePath), 'File must exist before deletion');

    const res = voiceService.deleteVoice(createdVoiceId);
    assert.equal(res.success, true);
    assert.ok(!fs.existsSync(filePath), 'File must be unlinked after deletion');

    assert.throws(() => {
      voiceService.getVoice(createdVoiceId);
    }, (err) => err.code === 'VOICE_NOT_FOUND');
  });
});
