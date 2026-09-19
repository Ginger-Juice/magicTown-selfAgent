# Town Hall diorama (镇公所)

Homepage-aligned 3D scene for the `town-hall` landmark. Not the konbini tech sample.

## Regenerate

Preferred (local Blender 4+/5 — clay lighting + preview PNG):

```bash
blender --background --python scripts/blender/town_hall.py
```

Cloud / CI fallback (scripted Three.js geometry, no Blender):

```bash
npm run diorama:town-hall
```

Both write `town_hall.glb` here and copy it to `public/diorama-town-hall/`.
