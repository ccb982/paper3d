const fs = require('fs');
const { loadBundle } = require('./src/vendor/player/core/bundle');
(async () => {
  const raw = fs.readFileSync('public/fx/bullets/维什戴尔子弹.scene.zip');
  const res = await loadBundle(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), false);
  for (const fd of res.frames) {
    console.log('frame:', fd.name, 'textureIndex:', fd.textureIndex);
    console.log('  regionEntities:', fd.regionEntities?.length ?? 0);
    for (const ent of fd.regionEntities ?? []) {
      console.log('  entity id:', ent.id, 'boundary rings:', ent.boundary?.length,
        'maskEffect:', JSON.stringify(ent.maskEffect ?? null).slice(0, 300));
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
