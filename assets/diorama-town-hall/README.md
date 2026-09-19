# Town Hall diorama (镇公所)

Homepage-aligned 3D scene for the `town-hall` landmark. Not the konbini tech sample.

The shipped mesh is a clay-cutout hall (rounded volumes, plaster/slate noise, inset windows, ivy worms). Lighting in the app overlay is a warm studio preset — konbini-level richness, civic subject.

## Regenerate

Preferred (local Blender 4+/5 — bevelled clay + preview PNG):

```bash
blender --background --python scripts/blender/town_hall.py
```

Cloud / CI fallback (scripted Three.js, no Blender) — this is what ships from the cloud agent:

```bash
npm run diorama:town-hall
```

Both write `town_hall.glb` here and copy it to `public/diorama-town-hall/`.
