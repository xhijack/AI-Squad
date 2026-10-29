#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Packs several glTF files (with their .bin and textures) into one GLB: one root node per model, named after the
// file, textures embedded once (PNG or JPEG; every texture slot). Node built-ins only (a dev tool, not part of the server).
//   node scripts/pack-glb.js out.glb a.gltf b.gltf ...
import fs from 'node:fs';
import path from 'node:path';

const [outFile, ...inputs] = process.argv.slice(2);
if (!outFile || !inputs.length) { console.error('usage: pack-glb.js out.glb a.gltf [b.gltf ...]'); process.exit(1); }
const pad4 = (n) => (n + 3) & ~3;
const out = { asset: { version: '2.0', generator: 'The AI Squad pack-glb' }, scene: 0, scenes: [{ name: 'Scene', nodes: [] }],
  nodes: [], meshes: [], accessors: [], bufferViews: [], materials: [], textures: [], images: [], samplers: [], buffers: [{ byteLength: 0 }] };
const chunks = [];
let length = 0;
const addBytes = (buf) => { const off = length; chunks.push(buf); length += buf.length; const p = pad4(length) - length; if (p) { chunks.push(Buffer.alloc(p)); length += p; } return off; };
const imageIndex = new Map();                       // source file path -> image index (each atlas once)

for (const file of inputs) {
  const dir = path.dirname(file), name = path.basename(file, '.gltf');
  const g = JSON.parse(fs.readFileSync(file, 'utf8'));
  const bin = fs.readFileSync(path.join(dir, g.buffers[0].uri));
  const base = addBytes(bin);
  const bv0 = out.bufferViews.length, acc0 = out.accessors.length, mesh0 = out.meshes.length, mat0 = out.materials.length, tex0 = out.textures.length, node0 = out.nodes.length, smp0 = out.samplers.length;
  for (const v of g.bufferViews) out.bufferViews.push({ ...v, buffer: 0, byteOffset: (v.byteOffset || 0) + base });
  for (const a of g.accessors) out.accessors.push({ ...a, bufferView: a.bufferView + bv0 });
  for (const s of g.samplers || []) out.samplers.push(s);
  const imgMap = (g.images || []).map((im) => {
    const src = path.resolve(dir, im.uri);
    if (!imageIndex.has(src)) {
      const off = addBytes(fs.readFileSync(src));
      out.bufferViews.push({ buffer: 0, byteOffset: off, byteLength: fs.statSync(src).size });
      out.images.push({ name: path.basename(src).replace(/\.\w+$/, ''), mimeType: /\.jpe?g$/i.test(src) ? 'image/jpeg' : 'image/png', bufferView: out.bufferViews.length - 1 });
      imageIndex.set(src, out.images.length - 1);
    }
    return imageIndex.get(src);
  });
  for (const t of g.textures || []) out.textures.push({ ...t, source: imgMap[t.source], ...(t.sampler != null ? { sampler: t.sampler + smp0 } : {}) });
  for (const m of g.materials || []) {
    const c = JSON.parse(JSON.stringify(m));
    for (const t of [c.pbrMetallicRoughness?.baseColorTexture, c.pbrMetallicRoughness?.metallicRoughnessTexture, c.normalTexture, c.occlusionTexture, c.emissiveTexture]) if (t) t.index += tex0;
    out.materials.push(c);
  }
  for (const m of g.meshes) out.meshes.push({ ...m, primitives: m.primitives.map((p) => ({ ...p, attributes: Object.fromEntries(Object.entries(p.attributes).map(([k, v]) => [k, v + acc0])),
    ...(p.indices != null ? { indices: p.indices + acc0 } : {}), ...(p.material != null ? { material: p.material + mat0 } : {}) })) });
  for (const n of g.nodes) out.nodes.push({ ...n, ...(n.mesh != null ? { mesh: n.mesh + mesh0 } : {}), ...(n.children ? { children: n.children.map((c) => c + node0) } : {}) });
  out.nodes.push({ name, children: g.scenes[g.scene || 0].nodes.map((i) => i + node0) });
  out.scenes[0].nodes.push(out.nodes.length - 1);
}
out.buffers[0].byteLength = length;
for (const k of ['samplers', 'textures', 'images']) if (!out[k].length) delete out[k];
let json = Buffer.from(JSON.stringify(out));
json = Buffer.concat([json, Buffer.alloc(pad4(json.length) - json.length, 0x20)]);
const binChunk = Buffer.concat(chunks);
const header = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + json.length + 8 + binChunk.length, 8);
jh.writeUInt32LE(json.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
bh.writeUInt32LE(binChunk.length, 0); bh.writeUInt32LE(0x004e4942, 4);
fs.writeFileSync(outFile, Buffer.concat([header, jh, json, bh, binChunk]));
console.log(`${outFile}: ${inputs.length} models, ${out.images?.length || 0} textures, ${(fs.statSync(outFile).size / 1024).toFixed(0)} KB`);
