// Real tests of the converter engine with the installed FFmpeg (no mocks of FFmpeg).
// Usage: npm run test:convert -- <folder with the test media> [scenario filter]
// The media files are described in tests/README.md.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Converter, detectHardware, probeFile, freeOutputPath } from '../src/main/convert';
import { buildPlan, presetSettings, MB, type ConvertSettings, type EncoderPref } from '../src/shared/convert';
import { defaultSettings } from '../src/main/store';

const media = process.argv[2];
const only = process.argv[3];
if (!media) throw new Error('usage: convert-engine <media folder> [filter]');
const settings = { ...defaultSettings, ffmpegPath: process.env.FFMPEG_PATH || defaultSettings.ffmpegPath };
const outDir = path.join(media, 'saida');
fs.rmSync(outDir, { recursive: true, force: true });

const results: { name: string; ok: boolean; info: string }[] = [];
const record = (name: string, ok: boolean, info: string) => { results.push({ name, ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${info}`); };
const probeRaw = (f: string) => JSON.parse(execFileSync(path.join(path.dirname(settings.ffmpegPath), 'ffprobe.exe'), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', f], { encoding: 'utf8' }));
const mb = (n?: number) => (n ? (n / MB).toFixed(1) + ' MB' : '?');
const faststart = (f: string) => { const fd = fs.openSync(f, 'r'); const b = Buffer.alloc(4 * 1024 * 1024); const n = fs.readSync(fd, b, 0, b.length, 0); fs.closeSync(fd); const s = b.subarray(0, n); const moov = s.indexOf('moov'), mdat = s.indexOf('mdat'); return moov >= 0 && (mdat < 0 || moov < mdat); };

async function convert(input: string, s: ConvertSettings, pref: EncoderPref, suffix: string, onState?: (c: Converter) => void) {
  let done!: () => void;
  const wait = new Promise<void>((r) => (done = r));
  let maxProgress = 0, sawEta = false;
  const c: Converter = new Converter(() => settings, (st) => { maxProgress = Math.max(maxProgress, st.progress); if (st.eta !== undefined) sawEta = true; if (st.status === 'running') onState?.(c); }, () => done());
  const t0 = Date.now();
  const r = await c.start({ input: path.join(media, input), settings: s, pref, gpuEnabled: pref !== 'cpu', outputDir: outDir, suffix });
  if (r.ok) await wait;
  return { start: r, state: c.state, seconds: (Date.now() - t0) / 1000, maxProgress, sawEta };
}

function leftovers() {
  return fs.existsSync(outDir) ? fs.readdirSync(outDir).filter((f) => f.includes('.convertendo')) : [];
}
const run = (name: string) => !only || name.includes(only);

/** Converts and checks the real output with ffprobe. */
async function scenario(name: string, input: string, s: ConvertSettings, pref: EncoderPref, expect: (v: any, a: any, o: any, r: Awaited<ReturnType<typeof convert>>) => string | true) {
  if (!run(name)) return;
  const source = path.join(media, input);
  const before = fs.statSync(source);
  const r = await convert(input, s, pref, name.slice(0, 40));
  const after = fs.statSync(source);
  if (!r.start.ok || r.state.status !== 'done') return record(name, false, r.start.error || r.state.error || r.state.status);
  const o = probeRaw(r.state.output!);
  const v = o.streams.find((x: any) => x.codec_type === 'video');
  const a = o.streams.find((x: any) => x.codec_type === 'audio');
  let verdict = expect(v, a, o, r);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) verdict = 'ARQUIVO ORIGINAL FOI ALTERADO';
  if (leftovers().length) verdict = 'sobrou arquivo temporário';
  record(name, verdict === true, `${verdict === true ? '' : verdict + ' · '}${mb(before.size)} -> ${mb(r.state.outputSize)} · ${r.seconds.toFixed(1)} s · ${r.state.encoderLabel} · ${v ? `${v.codec_name} ${v.width}x${v.height} ${v.avg_frame_rate}` : 'sem vídeo'}${a ? ' + ' + a.codec_name : ''}${r.state.attempt! > 1 ? ' · tentativas ' + r.state.attempt : ''}`);
}

async function main() {
  const hw = await detectHardware(settings, true);
  console.log(hw.encoders.map((e) => `${e.id}: ${e.works ? 'ok' : e.listed ? 'listado/falhou' : 'ausente'}`).join(' | '), '| tonemap', hw.canTonemap);
  const gpu = !!hw.encoders.find((e) => e.id === 'h264_nvenc')?.works;

  if (run('probe')) {
    const p = await probeFile(settings, path.join(media, 'longo.mp4'));
    record('probe: dados do vídeo', p.width === 1280 && p.height === 720 && Math.round(p.fps!) === 60 && p.vcodec === 'h264' && p.hasAudio && p.duration! > 630, `${p.width}x${p.height} ${p.fps} fps ${p.vcodec}/${p.acodec} ${p.videoKbps} kbps ${mb(p.size)}`);
    const rot = await probeFile(settings, path.join(media, 'vertical-rotacionado.mp4'));
    record('probe: rotação aplicada', rot.height! > rot.width!, `${rot.width}x${rot.height}`);
    for (const bad of ['invalido.mp4', 'corrompido-sem-indice.mp4']) {
      const err = await probeFile(settings, path.join(media, bad)).then(() => '', (e) => e.message);
      record(`probe: rejeita ${bad}`, !!err, err);
    }
  }

  const wa = () => presetSettings('whatsapp');
  const h264mp4 = (v: any, a: any, o: any, r: any) => (v.codec_name !== 'h264' || v.pix_fmt !== 'yuv420p' ? 'não é H.264 yuv420p' : a && a.codec_name !== 'aac' ? 'áudio não é AAC' : !faststart(r.state.output) ? 'sem faststart' : true);

  await scenario('whatsapp curto CPU', 'curto.mp4', wa(), 'cpu', (v, a, o, r) => (v.width !== 1280 ? 'mudou resolução' : r.state.outputSize! > 180 * MB ? 'acima de 180 MB' : r.state.outputSize! > r.state.inputSize! * 1.35 ? 'inflou o arquivo' : h264mp4(v, a, o, r)));
  if (gpu) await scenario('whatsapp curto GPU', 'curto.mp4', wa(), 'gpu', (v, a, o, r) => (!r.state.usesGpu ? 'não usou GPU' : h264mp4(v, a, o, r)));
  const bigOk = (v: any, a: any, o: any, r: any) => (r.state.outputSize! > 180 * MB ? 'acima de 180 MB' : h264mp4(v, a, o, r));
  await scenario('whatsapp 4K bitrate alto CPU', 'alta-resolucao-4k.mp4', wa(), 'cpu', bigOk);
  if (gpu) await scenario('whatsapp 4K bitrate alto GPU', 'alta-resolucao-4k.mp4', wa(), 'gpu', bigOk);
  // a tighter limit on the long real video forces the size math to matter
  const wa100 = { ...wa(), targetBytes: 100 * MB };
  const limit100 = (v: any, a: any, o: any, r: any) => (r.state.outputSize! > 100 * MB ? 'acima de 100 MB' : r.state.outputSize! < 70 * MB ? 'muito abaixo do alvo' : h264mp4(v, a, o, r));
  await scenario('longo limite 100 MB CPU 2 passagens', 'longo.mp4', wa100, 'cpu', limit100);
  if (gpu) await scenario('longo limite 100 MB GPU', 'longo.mp4', wa100, 'gpu', limit100);

  await scenario('universal sem áudio CPU', 'sem-audio.mp4', presetSettings('universal'), 'cpu', (v, a) => (a ? 'criou áudio' : v.codec_name === 'h264' || 'codec'));
  await scenario('nome com caracteres especiais', 'Vídeo de TESTE — ção & #1 [é] \'aspas\' 100%.mp4', presetSettings('balanced'), 'cpu', (v, a, o, r) => (path.basename(r.state.output!).startsWith("Vídeo de TESTE — ção & #1 [é] 'aspas' 100% (") ? true : 'nome diferente'));
  await scenario('480p30', 'curto.mp4', presetSettings('480p30'), 'cpu', (v) => (v.height === 480 && v.avg_frame_rate === '30/1' ? true : 'resolução/fps'));
  await scenario('1080p60 sem upscale', 'curto.mp4', presetSettings('1080p60'), 'cpu', (v) => (v.height === 720 ? true : 'ampliou'));
  await scenario('720p24', 'curto.mp4', presetSettings('720p24'), 'cpu', (v) => (v.avg_frame_rate === '24/1' ? true : 'fps'));
  await scenario('2160p60 reduz 5K', 'grande-5k.mp4', presetSettings('2160p60'), 'cpu', (v) => (v.height === 2160 && v.avg_frame_rate === '30/1' ? true : `${v.height} ${v.avg_frame_rate}`));
  await scenario('1440p60', 'alta-resolucao-4k.mp4', presetSettings('1440p60'), gpu ? 'gpu' : 'cpu', (v) => (v.height === 1440 ? true : 'resolução'));
  await scenario('1080p30', 'alta-resolucao-4k.mp4', presetSettings('1080p30'), 'cpu', (v) => (v.height === 1080 && v.avg_frame_rate === '30/1' ? true : 'resolução'));
  await scenario('1080p24', 'alta-resolucao-4k.mp4', presetSettings('1080p24'), gpu ? 'gpu' : 'cpu', (v) => (v.height === 1080 && v.avg_frame_rate === '24/1' ? true : 'resolução'));
  await scenario('720p60', 'curto.mp4', presetSettings('720p60'), 'cpu', (v) => (v.height === 720 ? true : 'resolução'));
  await scenario('720p30', 'curto.mp4', presetSettings('720p30'), 'cpu', (v) => (v.avg_frame_rate === '30/1' ? true : 'fps'));
  await scenario('original', 'curto.mp4', presetSettings('orig'), 'cpu', (v) => (v.height === 720 && v.avg_frame_rate === '60/1' ? true : 'mudou'));
  await scenario('alta compatibilidade', 'curto.mp4', presetSettings('legacy'), 'cpu', (v, a) => (v.profile === 'Main' && v.level === 31 && v.avg_frame_rate === '30/1' && a.channels === 2 ? true : `${v.profile} ${v.level}`));
  await scenario('alta qualidade', 'curto.mp4', presetSettings('high'), 'cpu', h264mp4);
  await scenario('arquivo menor', 'curto.mp4', presetSettings('small'), 'cpu', (v, a, o, r) => (r.state.outputSize! < r.state.inputSize! * 0.8 ? true : 'não reduziu'));
  await scenario('discord sem limite', 'alta-resolucao-4k.mp4', presetSettings('discord'), gpu ? 'gpu' : 'cpu', (v) => (v.height === 1080 ? true : 'resolução'));
  await scenario('discord limite 25 MB', 'alta-resolucao-4k.mp4', { ...presetSettings('discord'), rate: 'size', targetBytes: 25 * MB }, 'cpu', (v, a, o, r) => (r.state.outputSize! <= 25 * MB ? true : 'acima'));
  await scenario('redes sociais', 'alta-resolucao-4k.mp4', presetSettings('social'), gpu ? 'gpu' : 'cpu', (v) => (v.height === 1080 ? true : 'resolução'));
  await scenario('remux webm para mkv', 'fonte.webm', { ...presetSettings('remux'), container: 'mkv' }, 'cpu', (v, a) => (v.codec_name === 'vp9' && a.codec_name === 'opus' ? true : 'recodificou'));
  await scenario('remux para mp4', 'curto.mp4', presetSettings('remux'), 'cpu', (v, a, o, r) => (v.codec_name === 'h264' && faststart(r.state.output!) ? true : 'remux'));
  await scenario('extrair mp3', 'curto.mp4', presetSettings('mp3'), 'cpu', (v, a) => (!v && a.codec_name === 'mp3' ? true : 'saída'));
  await scenario('webm vp9', 'curto.mp4', presetSettings('webm'), 'cpu', (v, a) => (v.codec_name === 'vp9' && a.codec_name === 'opus' ? true : 'codec'));
  await scenario('vertical 480p', 'vertical-rotacionado.mp4', { ...presetSettings('480p30') }, 'cpu', (v) => (v.width === 480 && v.height > v.width ? true : `${v.width}x${v.height}`));
  await scenario('HDR para SDR', 'hdr-pq.mp4', presetSettings('universal'), 'cpu', (v) => (v.color_transfer === 'bt709' && v.pix_fmt === 'yuv420p' ? true : `${v.color_transfer} ${v.pix_fmt}`));

  // custom mode: every encoder that passed the test, in a compatible container
  for (const [codec, container] of [['hevc', 'mp4'], ['av1', 'mkv'], ['av1', 'webm']] as const) {
    for (const pref of ['cpu', 'gpu'] as const) {
      if (pref === 'gpu' && !hw.encoders.find((e) => e.id === `${codec}_nvenc`)?.works) continue;
      const s: ConvertSettings = { ...presetSettings('balanced'), video: codec, container, audio: container === 'webm' ? 'opus' : 'aac', shortSide: 480 };
      await scenario(`personalizado ${codec} ${container} ${pref}`, 'curto.mp4', s, pref, (v) => (v.codec_name === codec ? true : v.codec_name));
    }
  }
  await scenario('personalizado bitrate manual, mono, sem upscale', 'curto.mp4', { ...presetSettings('balanced'), rate: 'bitrate', videoKbps: 800, custom: { width: 4000, height: 400 }, channels: 1, audioKbps: 64 }, 'cpu', (v, a) => (v.height === 400 && a.channels === 1 ? true : `${v.width}x${v.height} ${a.channels}`));
  await scenario('personalizado remover áudio', 'curto.mp4', { ...presetSettings('balanced'), audio: 'none' }, 'cpu', (v, a) => (!a ? true : 'tem áudio'));

  if (run('bloqueios')) {
    const p = await probeFile(settings, path.join(media, 'longo.mp4'));
    const blocked = buildPlan(p, { ...wa(), targetBytes: 15 * MB }, 'cpu', false, hw);
    record('bloqueios: limite impossível é recusado com sugestões', !!blocked.blocked && (blocked.suggestions?.length ?? 0) > 0, `${blocked.blocked} | ${blocked.suggestions?.map((x) => x.label).join(' / ')}`);
    const bad = buildPlan(p, { ...presetSettings('balanced'), container: 'webm' }, 'cpu', false, hw);
    record('bloqueios: H.264 em WebM é recusado', !!bad.blocked, bad.blocked ?? '');
    const w = await probeFile(settings, path.join(media, 'fonte.webm'));
    const remux = buildPlan(w, presetSettings('remux'), 'cpu', false, hw);
    record('bloqueios: remux incompatível', !remux.blocked || /sem recodificar/.test(remux.blocked), remux.blocked ?? 'VP9 cabe em MP4? plano aceito');
    const n = await probeFile(settings, path.join(media, 'sem-audio.mp4'));
    record('bloqueios: extrair áudio sem áudio', !!buildPlan(n, presetSettings('mp3'), 'cpu', false, hw).blocked, '');
  }

  if (run('corrompido truncado')) {
    const r = await convert('corrompido-truncado.mp4', presetSettings('balanced'), 'cpu', 'trunc');
    const failed = !r.start.ok || r.state.status === 'error';
    record('corrompido truncado: não vira "concluído"', failed && !leftovers().length && !(r.state.output && fs.existsSync(r.state.output)), r.start.error || r.state.error || r.state.status);
  }

  if (run('cancelamento')) {
    let asked = false;
    const r = await convert('longo.mp4', presetSettings('balanced'), 'cpu', 'cancelado', (c) => { if (!asked && c.state.progress > 3) { asked = true; void c.cancel(); } });
    record('cancelamento: para e limpa', r.state.status === 'canceled' && !leftovers().length && !fs.existsSync(r.state.output!), `${r.state.status} em ${r.seconds.toFixed(1)} s`);
  }

  if (run('nomes')) {
    const a = freeOutputPath(outDir, path.join(media, 'curto.mp4'), 'X', 'mp4');
    fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(a, 'x');
    const b = freeOutputPath(outDir, path.join(media, 'curto.mp4'), 'X', 'mp4');
    record('nomes: nunca sobrescreve', a !== b, path.basename(b));
    fs.rmSync(a);
  }

  // Real NVENC failure: hide the GPU from the FFmpeg child process after the detection passed.
  if (gpu && run('falha da GPU')) {
    process.env.CUDA_VISIBLE_DEVICES = '-1';
    const r = await convert('curto.mp4', presetSettings('balanced'), 'gpu', 'gpu-falha');
    delete process.env.CUDA_VISIBLE_DEVICES;
    const reallyFailed = r.state.status === 'error';
    record('falha da GPU: erro claro, sem reinício automático', reallyFailed && r.state.canRetryCpu === true && !leftovers().length, reallyFailed ? r.state.error! : 'a falha NÃO foi provocada (a GPU continuou funcionando)');
    const again = await convert('curto.mp4', presetSettings('balanced'), 'cpu', 'gpu-falha cpu');
    record('falha da GPU: nova tentativa na CPU funciona', again.state.status === 'done' && !again.state.usesGpu, again.state.encoderLabel ?? '');
  }
  if (gpu && run('limite do NVENC')) {
    const r = await convert('grande-5k.mp4', presetSettings('balanced'), 'gpu', 'nvenc-5k');
    record('limite do NVENC: H.264 acima de 4096 px falha de verdade e oferece CPU', r.state.status === 'error' && r.state.canRetryCpu === true, r.state.status === 'error' ? 'erro tratado' : 'NVENC aceitou o arquivo');
  }

  if (run('progresso')) {
    const r = await convert('longo.mp4', { ...presetSettings('480p30') }, gpu ? 'gpu' : 'cpu', 'progresso');
    record('progresso e tempo restante reais', r.maxProgress >= 99 && r.sawEta, `máx ${r.maxProgress}% · eta ${r.sawEta}`);
  }
  if (run('estimativa')) {
    const c = new Converter(() => settings, () => {});
    const est = await c.estimate(path.join(media, 'longo.mp4'), presetSettings('balanced'), 'cpu', false);
    if ('error' in est) record('estimativa por amostras', false, est.error);
    else {
      const r = await convert('longo.mp4', presetSettings('balanced'), 'cpu', 'estimativa');
      record('estimativa por amostras contém o resultado real', r.state.outputSize! >= est.min && r.state.outputSize! <= est.max, `estimado ${mb(est.min)}–${mb(est.max)} · real ${mb(r.state.outputSize)} · CPU ${r.seconds.toFixed(1)} s`);
    }
  }

  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passaram`);
  fs.writeFileSync(path.join(media, 'resultado.json'), JSON.stringify(results, null, 2));
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}
void main();
