# -*- coding: utf-8 -*-
"""Magic Town 镇公所 clay diorama for Blender 4+/5.

Matches the homepage DebugMap sprite (public/b-townhall.png): L-plan
half-timber civic hall, clock tower, ivy, garden plaza.

    blender --background --python scripts/blender/town_hall.py

If Blender is unavailable, regenerate the shipped GLB with:

    npm run diorama:town-hall
"""

from __future__ import annotations

import math
import os
import sys

import bpy


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_DIR = os.path.join(ROOT, "assets", "diorama-town-hall")
PUBLIC_DIR = os.path.join(ROOT, "public", "diorama-town-hall")
BLEND_PATH = os.path.join(OUT_DIR, "town_hall.blend")
GLB_PATH = os.path.join(OUT_DIR, "town_hall.glb")
PREVIEW_PATH = os.path.join(OUT_DIR, "preview.png")
PUBLIC_GLB = os.path.join(PUBLIC_DIR, "town_hall.glb")


def _nt_clear(mat: bpy.types.Material):
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    return nt


def mat_clay(name, color, emit=0.2, roughness=0.78):
    mat = bpy.data.materials.new(name)
    nt = _nt_clear(mat)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    princ = nt.nodes.new("ShaderNodeBsdfPrincipled")
    princ.inputs["Base Color"].default_value = (*color, 1)
    princ.inputs["Roughness"].default_value = roughness
    princ.inputs["Metallic"].default_value = 0.02
    princ.inputs["Emission Color"].default_value = (*color, 1)
    princ.inputs["Emission Strength"].default_value = emit
    nt.links.new(princ.outputs["BSDF"], out.inputs["Surface"])
    return mat


def mat_emit(name, color, strength=2.4):
    return mat_clay(name, color, emit=strength, roughness=0.35)


def link_obj(obj, collection):
    collection.objects.link(obj)
    if obj.name in bpy.context.scene.collection.objects:
        bpy.context.scene.collection.objects.unlink(obj)
    return obj


def mesh_box(name, size, loc, collection, mat, rot=(0, 0, 0), bevel=0.06):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if bevel > 0:
        mod = obj.modifiers.new("ClayBevel", "BEVEL")
        mod.width = bevel
        mod.segments = 3
        try:
            bpy.ops.object.modifier_apply(modifier=mod.name)
        except Exception:
            pass
    obj.data.materials.append(mat)
    link_obj(obj, collection)
    return obj


def mesh_cyl(name, r, h, loc, collection, mat, verts=12):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=h, location=loc, vertices=verts)
    obj = bpy.context.active_object
    obj.name = name
    obj.data.materials.append(mat)
    link_obj(obj, collection)
    return obj


def mesh_sphere(name, r, loc, collection, mat, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=12, ring_count=8)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    obj.data.materials.append(mat)
    link_obj(obj, collection)
    return obj


def mesh_cone(name, r, h, loc, collection, mat, verts=4):
    bpy.ops.mesh.primitive_cone_add(radius1=r, depth=h, location=loc, vertices=verts)
    obj = bpy.context.active_object
    obj.name = name
    obj.data.materials.append(mat)
    link_obj(obj, collection)
    return obj


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES" if "CYCLES" in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items else "BLENDER_EEVEE"
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 1024
    scene.render.filepath = PREVIEW_PATH
    scene.render.film_transparent = True
    world = bpy.data.worlds.new("TownHallWorld")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.91, 0.93, 0.96, 1)
        bg.inputs[1].default_value = 1.0


def col(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def gable_roof(cx, cz, eaves_z, width, depth, height, ridge_axis, collection, mat, overhang=0.16):
    # Blender Z-up
    half = width / 2 + overhang
    length = depth + overhang * 2
    slope = math.hypot(half, height)
    angle = math.atan2(height, half)
    thick = 0.08
    mid_z = eaves_z + height / 2
    if ridge_axis == "y":
        mesh_box("RoofL", (slope, length, thick), (cx - half / 2, cz, mid_z), collection, mat, rot=(0, -angle, 0))
        mesh_box("RoofR", (slope, length, thick), (cx + half / 2, cz, mid_z), collection, mat, rot=(0, angle, 0))
    else:
        mesh_box("RoofN", (length, slope, thick), (cx, cz - half / 2, mid_z), collection, mat, rot=(angle, 0, 0))
        mesh_box("RoofS", (length, slope, thick), (cx, cz + half / 2, mid_z), collection, mat, rot=(-angle, 0, 0))


def window(x, y, z, w, h, facing, collection, mats):
    if facing == "x":
        mesh_box("Frame", (0.06, w + 0.08, h + 0.08), (x, y, z), collection, mats["frame"])
        mesh_box("Window", (0.08, w * 0.78, h * 0.78), (x, y, z), collection, mats["window"])
    else:
        mesh_box("Frame", (w + 0.08, 0.06, h + 0.08), (x, y, z), collection, mats["frame"])
        mesh_box("Window", (w * 0.78, 0.08, h * 0.78), (x, y, z), collection, mats["window"])


def vine(points, collection, mat, radius=0.055):
    for i, (x, y, z) in enumerate(points):
        mesh_sphere(f"Ivy{i}", radius, (x, y, z), collection, mat, scale=(1, 1, 1.15))


def build_materials():
    return {
        "wall": mat_clay("TownHallWall", (0.60, 0.34, 0.24), 0.16),
        "timber": mat_clay("TownHallTimber", (0.90, 0.83, 0.71), 0.18, 0.72),
        "roof": mat_clay("TownHallRoof", (0.29, 0.33, 0.41), 0.08, 0.86),
        "window": mat_emit("InteriorLight", (0.95, 0.77, 0.42), 2.4),
        "frame": mat_clay("TownHallFrame", (0.36, 0.23, 0.16), 0.08),
        "clock": mat_clay("ClockFace", (0.96, 0.94, 0.89), 0.55, 0.45),
        "hand": mat_clay("ClockHand", (0.16, 0.15, 0.14), 0.05),
        "ivy": mat_clay("TownHallIvy", (0.36, 0.42, 0.28), 0.12, 0.9),
        "bush": mat_clay("TownHallBush", (0.40, 0.46, 0.31), 0.1, 0.92),
        "ground": mat_clay("TownHallGround", (0.78, 0.73, 0.66), 0.1, 0.88),
        "chimney": mat_clay("TownHallChimney", (0.18, 0.17, 0.18), 0.06),
    }


def build_hall(mats):
    c_base = col("01_Base")
    c_hall = col("02_Hall")
    c_tower = col("03_Tower")
    c_garden = col("04_Garden")

    mesh_box("Plaza", (9.4, 9.4, 0.1), (0, 0.15, -0.05), c_base, mats["ground"])

    left = {"cx": -1.72, "cy": -0.12, "w": 3.16, "d": 4.28, "h": 2.52}
    right = {"cx": 1.42, "cy": 0.92, "w": 4.36, "d": 3.16, "h": 2.52}
    eaves = left["h"]
    roof_h = 2.05

    mesh_box("LeftWing", (left["w"], left["d"], left["h"]), (left["cx"], left["cy"], left["h"] / 2), c_hall, mats["wall"])
    mesh_box("RightWing", (right["w"], right["d"], right["h"]), (right["cx"], right["cy"], right["h"] / 2), c_hall, mats["wall"])

    gable_roof(left["cx"], left["cy"], eaves, left["w"], left["d"], roof_h, "y", c_hall, mats["roof"])
    gable_roof(right["cx"], right["cy"], eaves, right["d"], right["w"], roof_h + 0.08, "x", c_hall, mats["roof"])

    west = left["cx"] - left["w"] / 2 - 0.03
    south = right["cy"] + right["d"] / 2 + 0.03
    east = right["cx"] + right["w"] / 2 + 0.03

    mesh_box("TimberW1", (0.1, 0.12, left["h"] + 0.08), (west, left["cy"] - 1.35, left["h"] / 2), c_hall, mats["timber"])
    mesh_box("TimberW2", (0.1, 0.12, left["h"] + 0.08), (west, left["cy"] + 1.35, left["h"] / 2), c_hall, mats["timber"])
    mesh_box("TimberW3", (0.1, left["d"] * 0.92, 0.12), (west, left["cy"], 1.28), c_hall, mats["timber"])
    mesh_box("TimberW4", (0.1, left["d"] * 0.92, 0.12), (west, left["cy"], 2.42), c_hall, mats["timber"])

    window(west - 0.02, left["cy"] - 0.55, 1.85, 0.32, 0.42, "x", c_hall, mats)
    window(west - 0.02, left["cy"] + 0.55, 1.85, 0.32, 0.42, "x", c_hall, mats)
    window(west - 0.02, left["cy"] - 0.55, 0.72, 0.32, 0.42, "x", c_hall, mats)
    window(west - 0.02, left["cy"] + 0.55, 0.72, 0.32, 0.42, "x", c_hall, mats)

    window(right["cx"] - 1.15, south + 0.02, 1.88, 0.3, 0.4, "y", c_hall, mats)
    window(right["cx"] - 0.15, south + 0.02, 1.88, 0.3, 0.4, "y", c_hall, mats)
    window(right["cx"] + 0.85, south + 0.02, 1.88, 0.3, 0.4, "y", c_hall, mats)
    window(right["cx"] - 1.15, south + 0.02, 0.72, 0.3, 0.4, "y", c_hall, mats)
    window(right["cx"] - 0.15, south + 0.02, 0.72, 0.3, 0.4, "y", c_hall, mats)

    mesh_box("Door", (0.58, 0.08, 1.12), (right["cx"] + 1.15, south + 0.05, 0.68), c_hall, mats["frame"])
    mesh_cyl("PostL", 0.07, 1.55, (right["cx"] + 0.78, south + 0.42, 0.82), c_hall, mats["wall"], 10)
    mesh_cyl("PostR", 0.07, 1.55, (right["cx"] + 1.52, south + 0.42, 0.82), c_hall, mats["wall"], 10)
    mesh_box("PorchRoof", (1.05, 0.7, 0.1), (right["cx"] + 1.15, south + 0.32, 1.64), c_hall, mats["roof"])

    window(east + 0.02, right["cy"] + 0.15, 1.86, 0.3, 0.4, "x", c_hall, mats)
    window(east + 0.02, right["cy"] + 0.15, 0.72, 0.3, 0.4, "x", c_hall, mats)

    mesh_box("ChimL", (0.32, 0.24, 0.5), (left["cx"] - 0.15, left["cy"] - 1.55, eaves + roof_h + 0.1), c_hall, mats["chimney"])
    mesh_box("ChimR", (0.3, 0.24, 0.48), (right["cx"] + 1.85, right["cy"] - 0.05, eaves + roof_h + 0.15), c_hall, mats["chimney"])

    cx, cy = 0.06, -0.18
    mesh_box("Tower", (1.28, 1.28, 2.77), (cx, cy, 3.735), c_tower, mats["wall"])
    mesh_box("ClockLoft", (1.36, 1.36, 0.95), (cx, cy, 5.54), c_tower, mats["wall"])
    mesh_cyl("ClockS", 0.28, 0.04, (cx, cy + 0.68, 5.54), c_tower, mats["clock"], 24)
    bpy.context.active_object.rotation_euler = (math.pi / 2, 0, 0)
    mesh_cyl("ClockW", 0.28, 0.04, (cx - 0.68, cy, 5.54), c_tower, mats["clock"], 24)
    bpy.context.active_object.rotation_euler = (0, math.pi / 2, 0)
    mesh_cone("TowerRoof", 1.05, 1.85, (cx, cy, 6.92), c_tower, mats["roof"], 4)
    mesh_cyl("Spire", 0.03, 1.15, (cx, cy, 8.15), c_tower, mats["chimney"], 8)

    vine([(-3.42, 1.55, 0.15), (-3.36, 1.25, 1.25), (-3.32, 0.75, 2.35)], c_garden, mats["ivy"])
    vine([(0.55, 2.55, 0.15), (0.58, 2.52, 1.6), (0.42, 2.3, 2.7)], c_garden, mats["ivy"])
    mesh_sphere("Bush1", 0.22, (-3.45, 1.85, 0.12), c_garden, mats["bush"], (1.15, 1.1, 0.85))
    mesh_sphere("Bush2", 0.2, (3.55, 2.15, 0.12), c_garden, mats["bush"], (1.1, 1.1, 0.85))
    mesh_sphere("Bush3", 0.16, (0.15, 2.75, 0.1), c_garden, mats["bush"], (1.1, 1.05, 0.8))


def build_camera():
    cam_data = bpy.data.cameras.new("DioramaCamera")
    cam_data.lens = 38
    cam = bpy.data.objects.new("DioramaCamera", cam_data)
    cam.location = (-7.4, -8.8, 8.6)
    bpy.context.scene.collection.objects.link(cam)
    target = bpy.data.objects.new("CameraTarget", None)
    target.location = (0.1, 0.15, 2.15)
    bpy.context.scene.collection.objects.link(target)
    cns = cam.constraints.new("TRACK_TO")
    cns.target = target
    cns.track_axis = "TRACK_NEGATIVE_Z"
    cns.up_axis = "UP_Y"
    bpy.context.scene.camera = cam
    sun = bpy.data.lights.new("Sun", "SUN")
    sun.energy = 4
    sun.color = (1.0, 0.88, 0.7)
    sun_obj = bpy.data.objects.new("Sun", sun)
    sun_obj.location = (8, -6, 12)
    bpy.context.scene.collection.objects.link(sun_obj)


def save_and_export():
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(PUBLIC_DIR, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    try:
        bpy.ops.render.render(write_still=True)
    except Exception as exc:
        print("RENDER SKIP", exc)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            obj.select_set(True)
    try:
        bpy.ops.export_scene.gltf(filepath=GLB_PATH, export_format="GLB", use_selection=True, export_apply=True)
    except TypeError:
        bpy.ops.export_scene.gltf(filepath=GLB_PATH, export_format="GLB")
    print("EXPORTED", GLB_PATH)
    try:
        import shutil

        shutil.copy2(GLB_PATH, PUBLIC_GLB)
        print("COPIED", PUBLIC_GLB)
    except OSError as exc:
        print("COPY FAIL", exc)


def main():
    print("=== Building town-hall garden diorama ===")
    reset_scene()
    mats = build_materials()
    build_hall(mats)
    build_camera()
    save_and_export()
    print("=== Done ===")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        import traceback

        traceback.print_exc()
        sys.exit(1)
