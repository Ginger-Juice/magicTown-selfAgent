# Town Hall diorama (镇公所)

Homepage-aligned 3D scene for the `town-hall` landmark. Not the konbini tech sample.

**Authoring path: Blender only.** The mesh is modelled by `scripts/blender/town_hall.py`. Three.js procedural geometry is not a source of truth and is not shipped. There is no `npm run diorama:town-hall` fallback.

Runtime (`src/lib/diorama.ts`) loads only `/diorama-town-hall/town_hall.glb`. The overlay uses Three.js for camera, lights, and orbit — not for building the hall.

## Bake (Blender 5.1)

From the repo root, with Blender 5.1 on `PATH`:

```bash
blender --background --python scripts/blender/town_hall.py
```

Writes:

- `assets/diorama-town-hall/town_hall.blend`
- `assets/diorama-town-hall/town_hall.glb`
- `assets/diorama-town-hall/preview.png`
- `public/diorama-town-hall/town_hall.glb` (what the app loads)

The GLB currently in git is a Blender 5.1 export. Re-run the command after pulling so slates lie flush on the roof pitch (downslope overlap, not shelf/fin tiles). Do **not** regenerate it with Node or Three.js.
