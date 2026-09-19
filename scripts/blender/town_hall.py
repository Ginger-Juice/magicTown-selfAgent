# -*- coding: utf-8 -*-
"""Magic Town 镇公所 — Blender 5.1 clay diorama.

This is the ONLY authoring path for the town-hall GLB. Do not generate
the mesh in Three.js. There is no npm / Three.js fallback.

Matches public/b-townhall.png: offset-L half-timber civic hall, clock
tower at the jog, west + east gables, south porch, slate roofs, ivy.

Bake (from the repo root, Blender 5.1 on PATH):

    blender --background --python scripts/blender/town_hall.py

Writes:
    assets/diorama-town-hall/town_hall.blend
    assets/diorama-town-hall/town_hall.glb
    assets/diorama-town-hall/preview.png
    public/diorama-town-hall/town_hall.glb   (runtime load)

Blender is Z-up. The glTF exporter converts to Y-up so the existing
Three.js overlay camera (southwest, seeing the west gable + south porch)
still frames the hall. South facade is −Y in Blender (= +Z in glTF).
"""

from __future__ import annotations

import math
import os
import shutil
import sys

import bpy
import bmesh


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_DIR = os.path.join(ROOT, "assets", "diorama-town-hall")
PUBLIC_DIR = os.path.join(ROOT, "public", "diorama-town-hall")
BLEND_PATH = os.path.join(OUT_DIR, "town_hall.blend")
GLB_PATH = os.path.join(OUT_DIR, "town_hall.glb")
PREVIEW_PATH = os.path.join(OUT_DIR, "preview.png")
PUBLIC_GLB = os.path.join(PUBLIC_DIR, "town_hall.glb")


# ---------------------------------------------------------------------------
# Materials (same clay/toon recipe as the konbini bake)
# ---------------------------------------------------------------------------

def _nt_clear(mat: bpy.types.Material):
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    return nt


def _out(nt):
    return nt.nodes.new("ShaderNodeOutputMaterial")


def _link(nt, a, b):
    nt.links.new(a, b)


def mat_toon(name, color, roughness=0.82, emit_str=0.0, level=1.0, emission=None):
    mat = bpy.data.materials.new(name)
    nt = _nt_clear(mat)
    out = _out(nt)
    princ = nt.nodes.new("ShaderNodeBsdfPrincipled")
    princ.inputs["Base Color"].default_value = (*color, 1)
    princ.inputs["Roughness"].default_value = roughness
    princ.inputs["Metallic"].default_value = 0.03
    princ.inputs["Emission Color"].default_value = (*(emission or color), 1)
    princ.inputs["Emission Strength"].default_value = emit_str if emit_str > 0 else max(0.14, level * 0.32)
    if "Specular IOR Level" in princ.inputs:
        princ.inputs["Specular IOR Level"].default_value = 0.22
    _link(nt, princ.outputs["BSDF"], out.inputs["Surface"])
    return mat


def mat_emit(name, color, strength=2.6):
    return mat_toon(name, color, roughness=0.32, emit_str=strength, emission=color)


def build_materials():
    return {
        "wall": mat_toon("TownHallWall", (0.72, 0.42, 0.30), roughness=0.86, level=0.78),
        "timber": mat_toon("TownHallTimber", (0.93, 0.84, 0.70), roughness=0.58, level=0.84),
        "roof": mat_toon("TownHallRoof", (0.40, 0.44, 0.52), roughness=0.9, level=0.58),
        "ridge": mat_toon("TownHallRidge", (0.26, 0.29, 0.34), roughness=0.72, level=0.5),
        "frame": mat_toon("TownHallFrame", (0.38, 0.24, 0.18), roughness=0.68, level=0.55),
        "mullion": mat_toon("TownHallMullion", (0.78, 0.62, 0.46), roughness=0.55, level=0.7),
        "door": mat_toon("TownHallDoor", (0.48, 0.28, 0.20), roughness=0.7, level=0.6),
        "window": mat_emit("InteriorLight", (1.0, 0.82, 0.48), 2.8),
        "clock": mat_toon("ClockFace", (0.98, 0.94, 0.88), roughness=0.38, emit_str=0.7, emission=(1.0, 0.95, 0.86)),
        "bezel": mat_toon("ClockBezel", (0.84, 0.76, 0.62), roughness=0.45, level=0.7),
        "hand": mat_toon("ClockHand", (0.16, 0.15, 0.14), roughness=0.5, level=0.4),
        "ivy": mat_toon("TownHallIvy", (0.36, 0.44, 0.28), roughness=0.92, level=0.6),
        "bush": mat_toon("TownHallBush", (0.40, 0.47, 0.30), roughness=0.94, level=0.58),
        "ground": mat_toon("TownHallGround", (0.78, 0.70, 0.60), roughness=0.92, level=0.62),
        "cobble": mat_toon("TownHallCobble", (0.72, 0.64, 0.54), roughness=0.94, level=0.6),
        "chimney": mat_toon("TownHallChimney", (0.18, 0.17, 0.18), roughness=0.76, level=0.45),
        "step": mat_toon("TownHallStep", (0.62, 0.35, 0.24), roughness=0.74, level=0.65),
    }


# ---------------------------------------------------------------------------
# Mesh helpers
# ---------------------------------------------------------------------------

def col(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def link(obj, collection):
    collection.objects.link(obj)
    return obj


def _new_obj(name, mesh, loc, collection, mat=None, rot=(0, 0, 0), scale=(1, 1, 1)):
    obj = bpy.data.objects.new(name, mesh)
    obj.location = loc
    obj.rotation_euler = rot
    obj.scale = scale
    if mat:
        obj.data.materials.append(mat)
    return link(obj, collection)


def box(name, loc, size, collection, mat, rot=(0, 0, 0)):
    """Unit cube scaled in mesh data so Bevel width is world-ish, not stretched."""
    sx, sy, sz = size
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= sx
        v.co.y *= sy
        v.co.z *= sz
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return _new_obj(name, mesh, loc, collection, mat, rot)


def cyl(name, loc, radius, depth, collection, mat, rot=(0, 0, 0), segs=20):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm, cap_ends=True, cap_tris=False, segments=segs, radius1=radius, radius2=radius, depth=depth
    )
    bm.to_mesh(mesh)
    bm.free()
    return _new_obj(name, mesh, loc, collection, mat, rot)


def cone(name, loc, r1, depth, collection, mat, rot=(0, 0, 0), segs=4):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r1, radius2=0.002, depth=depth
    )
    bm.to_mesh(mesh)
    bm.free()
    return _new_obj(name, mesh, loc, collection, mat, rot)


def ico(name, loc, radius, collection, mat, subdiv=1, scale=(1, 1, 1)):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=radius)
    bm.to_mesh(mesh)
    bm.free()
    return _new_obj(name, mesh, loc, collection, mat, scale=scale)


def attic_prism(name, cx, cy, z0, width, depth, height, ridge_along, collection, mat):
    """Solid gable volume so the silhouette is a house, not a box with a floating roof.

    ridge_along 'x': gables face ±X (triangle in YZ), eaves on ±Y.
    ridge_along 'y': gables face ±Y (triangle in XZ), eaves on ±X.
    """
    hw, hd = width / 2.0, depth / 2.0
    if ridge_along == "x":
        coords = [
            (cx - hw, cy - hd, z0),
            (cx + hw, cy - hd, z0),
            (cx + hw, cy + hd, z0),
            (cx - hw, cy + hd, z0),
            (cx - hw, cy, z0 + height),
            (cx + hw, cy, z0 + height),
        ]
        faces = [(0, 3, 4), (1, 5, 2), (0, 4, 5, 1), (3, 2, 5, 4), (0, 1, 2, 3)]
    else:
        coords = [
            (cx - hw, cy - hd, z0),
            (cx + hw, cy - hd, z0),
            (cx + hw, cy + hd, z0),
            (cx - hw, cy + hd, z0),
            (cx, cy - hd, z0 + height),
            (cx, cy + hd, z0 + height),
        ]
        faces = [(0, 1, 4), (2, 3, 5), (0, 4, 5, 3), (1, 2, 5, 4), (0, 3, 2, 1)]

    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    verts = [bm.verts.new(co) for co in coords]
    bm.verts.ensure_lookup_table()
    for face in faces:
        try:
            bm.faces.new([verts[i] for i in face])
        except ValueError:
            pass
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    obj = _new_obj(name, mesh, (0, 0, 0), collection, mat)
    clay_bevel(obj, 0.045, 2)
    return obj


def shade_smooth(obj, angle=0.7):
    mesh = obj.data
    if hasattr(mesh, "use_auto_smooth"):
        mesh.use_auto_smooth = True
        mesh.auto_smooth_angle = angle
    for p in mesh.polygons:
        p.use_smooth = True


def clay_bevel(obj, width=0.07, segments=3):
    if obj.type != "MESH":
        return obj
    mod = obj.modifiers.new("ClayBevel", "BEVEL")
    mod.width = width
    mod.segments = segments
    if hasattr(mod, "affect"):
        try:
            mod.affect = "EDGES"
        except TypeError:
            pass
    shade_smooth(obj)
    return obj


def curve_wire(name, points, collection, mat, radius=0.07):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = 3
    cu.fill_mode = "FULL"
    spline = cu.splines.new("NURBS")
    spline.points.add(len(points) - 1)
    for i, p in enumerate(points):
        spline.points[i].co = (p[0], p[1], p[2], 1.0)
    spline.use_endpoint_u = True
    spline.order_u = min(4, len(points))
    obj = bpy.data.objects.new(name, cu)
    if mat:
        obj.data.materials.append(mat)
    return link(obj, collection)


def join_named(name, objects):
    objects = [o for o in objects if o is not None]
    if not objects:
        return None
    if len(objects) == 1:
        objects[0].name = name
        return objects[0]
    if bpy.ops.object.mode_set.poll():
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    objects[0].name = name
    return objects[0]


# ---------------------------------------------------------------------------
# Hall parts
# ---------------------------------------------------------------------------

def gable_roof(name, cx, cy, eaves_z, width, depth, height, ridge_along, collection, mats, overhang=0.2):
    """Slate planes + ridge. width = span across the ridge; depth = length along it."""
    half = width / 2 + overhang
    length = depth + overhang * 2
    slope = math.hypot(half, height)
    angle = math.atan2(height, half)
    thick = 0.14
    mid_z = eaves_z + height / 2
    if ridge_along == "y":
        a = box(name + "L", (cx - half / 2, cy, mid_z), (slope, length, thick), collection, mats["roof"], rot=(0, -angle, 0))
        b = box(name + "R", (cx + half / 2, cy, mid_z), (slope, length, thick), collection, mats["roof"], rot=(0, angle, 0))
        ridge = cyl(name + "Ridge", (cx, cy, eaves_z + height + 0.02), 0.045, length * 0.98, collection, mats["ridge"], rot=(math.pi / 2, 0, 0), segs=10)
    else:
        a = box(name + "N", (cx, cy + half / 2, mid_z), (length, slope, thick), collection, mats["roof"], rot=(angle, 0, 0))
        b = box(name + "S", (cx, cy - half / 2, mid_z), (length, slope, thick), collection, mats["roof"], rot=(-angle, 0, 0))
        ridge = cyl(name + "Ridge", (cx, cy, eaves_z + height + 0.02), 0.045, length * 0.98, collection, mats["ridge"], rot=(0, 0, math.pi / 2), segs=10)
    for obj in (a, b):
        clay_bevel(obj, 0.035, 2)
    shingles(name + "Tiles", cx, cy, eaves_z, width, depth, height, ridge_along, collection, mats["roof"], overhang)
    return a, b, ridge


def shingles(name, cx, cy, eaves_z, width, depth, height, ridge_along, collection, mat, overhang=0.2):
    half = width / 2 + overhang
    length = depth + overhang * 2
    angle = math.atan2(height, half)
    rows, cols = 8, 11
    tiles = []
    if ridge_along == "x":
        x0 = cx - length / 2
        for side in (-1, 1):
            for r in range(rows):
                t = (r + 0.58) / rows
                z = eaves_z + t * height + 0.06
                y = cy + side * half * (1.0 - t)
                stagger = (length / cols) * 0.28 if r % 2 else 0.0
                for c in range(cols):
                    x = x0 + stagger + (c + 0.5) * (length / cols)
                    tiles.append(
                        box(
                            f"{name}_{side}_{r}_{c}",
                            (x, y, z),
                            (length / cols * 0.92, 0.15, 0.035),
                            collection,
                            mat,
                            rot=(side * angle, 0, 0),
                        )
                    )
    else:
        y0 = cy - length / 2
        for side in (-1, 1):
            for r in range(rows):
                t = (r + 0.58) / rows
                z = eaves_z + t * height + 0.06
                x = cx + side * half * (1.0 - t)
                stagger = (length / cols) * 0.28 if r % 2 else 0.0
                for c in range(cols):
                    y = y0 + stagger + (c + 0.5) * (length / cols)
                    tiles.append(
                        box(
                            f"{name}_{side}_{r}_{c}",
                            (x, y, z),
                            (0.15, length / cols * 0.92, 0.035),
                            collection,
                            mat,
                            rot=(0, -side * angle, 0),
                        )
                    )
    join_named(name, tiles)


def window(name, loc, w, h, facing, collection, mats, arched=False):
    """facing: 'x' / '-x' / 'y' / '-y' — thin glowing pane, not a shutter box."""
    lip = 0.05
    ox, oy, oz = loc
    if facing in {"x", "-x"}:
        out = 1 if facing == "x" else -1
        frame = box(name + "Frame", (ox, oy, oz), (0.04, w + lip * 2, h + lip * 2), collection, mats["frame"])
        pane = box(name + "Pane", (ox + out * 0.02, oy, oz), (0.018, w * 0.86, h * 0.86), collection, mats["window"])
        box(name + "MullV", (ox + out * 0.03, oy, oz), (0.012, 0.016, h * 0.86), collection, mats["mullion"])
        box(name + "MullH", (ox + out * 0.03, oy, oz), (0.012, w * 0.86, 0.016), collection, mats["mullion"])
        if arched:
            cyl(name + "Arch", (ox + out * 0.01, oy, oz + h * 0.42), w * 0.48, 0.04, collection, mats["frame"], rot=(0, math.pi / 2, 0), segs=14)
    else:
        out = 1 if facing == "y" else -1
        frame = box(name + "Frame", (ox, oy, oz), (w + lip * 2, 0.04, h + lip * 2), collection, mats["frame"])
        pane = box(name + "Pane", (ox, oy + out * 0.02, oz), (w * 0.86, 0.018, h * 0.86), collection, mats["window"])
        box(name + "MullV", (ox, oy + out * 0.03, oz), (0.016, 0.012, h * 0.86), collection, mats["mullion"])
        box(name + "MullH", (ox, oy + out * 0.03, oz), (w * 0.86, 0.012, 0.016), collection, mats["mullion"])
        if arched:
            cyl(name + "Arch", (ox, oy + out * 0.01, oz + h * 0.42), w * 0.48, 0.04, collection, mats["frame"], rot=(math.pi / 2, 0, 0), segs=14)
    clay_bevel(frame, 0.012, 2)
    return pane


def clock_face(name, loc, facing, collection, mats):
    ox, oy, oz = loc
    rot = (math.pi / 2, 0, 0)
    if facing == "-x":
        rot = (0, math.pi / 2, 0)
    elif facing == "x":
        rot = (0, -math.pi / 2, 0)
    face = cyl(name, loc, 0.30, 0.03, collection, mats["clock"], rot=rot, segs=28)
    bezel = cyl(name + "Bezel", loc, 0.34, 0.022, collection, mats["bezel"], rot=rot, segs=28)
    ticks = []
    for i in range(12):
        ang = i * math.pi / 6
        reach = 0.255
        if facing == "-y":
            tloc = (ox, oy - 0.02, oz + math.cos(ang) * reach)
            tw = 0.018 if i % 3 == 0 else 0.012
            th = 0.04 if i % 3 == 0 else 0.028
            ticks.append(box(f"{name}Tick{i}", (tloc[0] + math.sin(ang) * reach, tloc[1], tloc[2]), (tw, 0.012, th), collection, mats["hand"]))
        else:
            tloc = (ox - 0.02, oy + math.sin(ang) * reach, oz + math.cos(ang) * reach)
            tw = 0.018 if i % 3 == 0 else 0.012
            th = 0.04 if i % 3 == 0 else 0.028
            ticks.append(box(f"{name}Tick{i}", tloc, (0.012, tw, th), collection, mats["hand"]))
    join_named(name + "Ticks", ticks)
    hour = box(name + "Hour", loc, (0.03, 0.014, 0.12), collection, mats["hand"])
    minute = box(name + "Minute", loc, (0.022, 0.014, 0.18), collection, mats["hand"])
    hub = ico(name + "Hub", loc, 0.022, collection, mats["hand"], subdiv=1)
    if facing == "-y":
        hour.location = (ox, oy - 0.025, oz + 0.04)
        hour.rotation_euler = (0.52, 0, 0)
        minute.location = (ox, oy - 0.028, oz + 0.06)
        minute.rotation_euler = (-0.42, 0, 0)
        hub.location = (ox, oy - 0.03, oz)
    else:
        hour.location = (ox - 0.025, oy, oz + 0.04)
        hour.rotation_euler = (0, 0, -0.52)
        minute.location = (ox - 0.028, oy, oz + 0.06)
        minute.rotation_euler = (0, 0, 0.42)
        hub.location = (ox - 0.03, oy, oz)
    return face, bezel


def steps(name, cx, cy, collection, mats, count=3, width=1.05, facing="-y"):
    for i in range(count):
        t = 0.1
        w = width - i * 0.05
        z = 0.055 + i * t
        if facing == "-y":
            box(f"{name}{i}", (cx, cy - i * 0.15, z), (w, 0.24, t), collection, mats["step"])
        else:
            box(f"{name}{i}", (cx - i * 0.15, cy, z), (0.24, w, t), collection, mats["step"])


def chimney(name, loc, collection, mats, size=(0.32, 0.26, 0.52)):
    ox, oy, oz = loc
    w, d, h = size
    body = box(name, (ox, oy, oz + h / 2), (w, d, h), collection, mats["chimney"])
    clay_bevel(body, 0.05, 2)
    cyl(name + "PotL", (ox - w * 0.2, oy, oz + h + 0.08), 0.05, 0.18, collection, mats["chimney"], segs=10)
    cyl(name + "PotR", (ox + w * 0.2, oy, oz + h + 0.1), 0.05, 0.22, collection, mats["chimney"], segs=10)


def bush(name, loc, collection, mats, s=1.0):
    ox, oy, oz = loc
    ico(name, loc, 0.28 * s, collection, mats["bush"], subdiv=1, scale=(1.25, 1.2, 0.88))
    ico(name + "A", (ox + 0.16 * s, oy + 0.08 * s, oz + 0.07 * s), 0.16 * s, collection, mats["bush"])
    ico(name + "B", (ox - 0.14 * s, oy - 0.08 * s, oz + 0.05 * s), 0.14 * s, collection, mats["ivy"])


def build_plaza(mats, c):
    pad = box("Plaza", (0, -0.18, -0.06), (9.6, 9.6, 0.16), c, mats["ground"])
    clay_bevel(pad, 0.12, 3)
    cobbles = []
    span, n = 8.4, 11
    step = span / n
    for i in range(n):
        for j in range(n):
            x = -span / 2 + (i + 0.5) * step
            y = -span / 2 - 0.18 + (j + 0.5) * step
            if (x * x + (y + 0.18) * (y + 0.18)) ** 0.5 > 4.55:
                continue
            h = 0.035 + ((i * 3 + j * 7) % 5) * 0.004
            cobbles.append(
                box(
                    f"Cobble{i}_{j}",
                    (x, y, 0.03),
                    (step * 0.78, step * 0.78, h),
                    c,
                    mats["cobble"],
                )
            )
    join_named("Cobbles", cobbles)
    nubs = [
        (-3.7, 0.2),
        (-2.3, 2.7),
        (0.3, 2.9),
        (2.9, 2.3),
        (4.0, -0.15),
        (3.7, -2.5),
        (1.1, -3.4),
        (-1.5, -3.2),
        (-3.6, -2.3),
        (-4.1, -0.55),
    ]
    for i, (x, y) in enumerate(nubs):
        ico(f"Nub{i}", (x, y, 0.04), 0.11, c, mats["ivy"], scale=(1.25, 1.15, 0.65))


def timber_x(name, loc, facing, span, collection, mat):
    """Cream X in a gable triangle (PNG west / east peaks)."""
    length = span * 0.92
    if facing in {"x", "-x"}:
        box(name + "A", loc, (0.1, 0.1, length), collection, mat, rot=(0.72, 0, 0))
        box(name + "B", loc, (0.1, 0.1, length), collection, mat, rot=(-0.72, 0, 0))
    else:
        box(name + "A", loc, (0.1, 0.1, length), collection, mat, rot=(0, 0.72, 0))
        box(name + "B", loc, (0.1, 0.1, length), collection, mat, rot=(0, -0.72, 0))


def build_wings(mats, c_hall):
    # Offset-L: both wings ridge along X so west + east read as gables and
    # the south face of the right wing is a long eave wall with the porch.
    # Blender Y = −Three Z, so south is −Y.
    left = {"cx": -1.55, "cy": 0.38, "w": 3.55, "d": 3.12, "h": 2.52}
    right = {"cx": 1.48, "cy": -0.82, "w": 4.42, "d": 3.18, "h": 2.52}
    eaves = left["h"]
    roof_h = 2.12

    lw = box("LeftWing", (left["cx"], left["cy"], left["h"] / 2), (left["w"], left["d"], left["h"]), c_hall, mats["wall"])
    rw = box("RightWing", (right["cx"], right["cy"], right["h"] / 2), (right["w"], right["d"], right["h"]), c_hall, mats["wall"])
    clay_bevel(lw, 0.1, 3)
    clay_bevel(rw, 0.1, 3)

    attic_prism("LeftAttic", left["cx"], left["cy"], eaves - 0.04, left["w"] * 0.98, left["d"] * 0.98, roof_h * 0.92, "x", c_hall, mats["wall"])
    attic_prism("RightAttic", right["cx"], right["cy"], eaves - 0.04, right["w"] * 0.98, right["d"] * 0.98, roof_h * 0.96, "x", c_hall, mats["wall"])

    gable_roof("LeftRoof", left["cx"], left["cy"], eaves - 0.02, left["d"], left["w"], roof_h, "x", c_hall, mats)
    gable_roof("RightRoof", right["cx"], right["cy"], eaves - 0.02, right["d"], right["w"], roof_h + 0.06, "x", c_hall, mats)

    west = left["cx"] - left["w"] / 2 - 0.035
    south = right["cy"] - right["d"] / 2 - 0.035
    east = right["cx"] + right["w"] / 2 + 0.035
    left_south = left["cy"] - left["d"] / 2 - 0.03

    # West gable timber (the cutout's readable face).
    for i, y in enumerate((left["cy"] - left["d"] * 0.32, left["cy"], left["cy"] + left["d"] * 0.32)):
        box(f"TimberW{i}", (west, y, left["h"] / 2), (0.11, 0.13, left["h"] + 0.06), c_hall, mats["timber"])
    box("TimberWH", (west, left["cy"], 1.28), (0.11, left["d"] * 0.9, 0.13), c_hall, mats["timber"])
    box("TimberWE", (west, left["cy"], 2.4), (0.11, left["d"] * 0.9, 0.13), c_hall, mats["timber"])
    timber_x("TimberWX", (west, left["cy"], eaves + 0.82), "-x", 1.55, c_hall, mats["timber"])
    box("TimberWPeak", (west, left["cy"], eaves + 1.55), (0.1, 0.12, 0.55), c_hall, mats["timber"])

    # South timber on the right wing (long eave wall).
    box("TimberSH", (right["cx"], south, 1.3), (right["w"] * 0.9, 0.11, 0.13), c_hall, mats["timber"])
    box("TimberSE", (right["cx"], south, 2.42), (right["w"] * 0.9, 0.11, 0.13), c_hall, mats["timber"])
    for i, ox in enumerate((-1.7, -0.85, 0.0, 0.85, 1.7)):
        box(f"TimberSV{i}", (right["cx"] + ox, south, 1.88), (0.12, 0.11, 1.18), c_hall, mats["timber"])
    box("TimberSBraceL", (right["cx"] - 0.42, south, 1.85), (0.9, 0.08, 0.08), c_hall, mats["timber"], rot=(0, 0, 0.55))
    box("TimberSBraceR", (right["cx"] + 0.42, south, 1.85), (0.9, 0.08, 0.08), c_hall, mats["timber"], rot=(0, 0, -0.55))

    # East gable timber.
    box("TimberE0", (east, right["cy"] - 0.72, right["h"] / 2), (0.11, 0.13, right["h"] + 0.06), c_hall, mats["timber"])
    box("TimberE1", (east, right["cy"] + 0.72, right["h"] / 2), (0.11, 0.13, right["h"] + 0.06), c_hall, mats["timber"])
    box("TimberEH", (east, right["cy"], 1.28), (0.11, right["d"] * 0.86, 0.13), c_hall, mats["timber"])
    box("TimberEE", (east, right["cy"], 2.4), (0.11, right["d"] * 0.86, 0.13), c_hall, mats["timber"])
    timber_x("TimberEX", (east, right["cy"], eaves + 0.86), "x", 1.45, c_hall, mats["timber"])

    window("WinWW0", (west - 0.02, left["cy"] - 0.55, 1.84), 0.34, 0.44, "-x", c_hall, mats)
    window("WinWW1", (west - 0.02, left["cy"] + 0.55, 1.84), 0.34, 0.44, "-x", c_hall, mats)
    window("WinWW2", (west - 0.02, left["cy"] - 0.55, 0.74), 0.34, 0.44, "-x", c_hall, mats)
    window("WinWW3", (west - 0.02, left["cy"] + 0.55, 0.74), 0.34, 0.44, "-x", c_hall, mats)
    window("WinWD0", (west - 0.02, left["cy"] - 0.42, eaves + 0.78), 0.24, 0.30, "-x", c_hall, mats)
    window("WinWD1", (west - 0.02, left["cy"] + 0.42, eaves + 0.78), 0.24, 0.30, "-x", c_hall, mats)

    window("WinLS0", (left["cx"] - 0.55, left_south, 1.82), 0.32, 0.42, "-y", c_hall, mats)
    window("WinLS1", (left["cx"] + 0.55, left_south, 0.72), 0.32, 0.42, "-y", c_hall, mats)

    window("WinRS0", (right["cx"] - 1.25, south - 0.02, 1.88), 0.32, 0.42, "-y", c_hall, mats)
    window("WinRS1", (right["cx"] - 0.28, south - 0.02, 1.88), 0.32, 0.42, "-y", c_hall, mats)
    window("WinRS2", (right["cx"] + 0.7, south - 0.02, 1.88), 0.32, 0.42, "-y", c_hall, mats)
    window("WinRS3", (right["cx"] - 1.25, south - 0.02, 0.74), 0.32, 0.42, "-y", c_hall, mats)
    window("WinRS4", (right["cx"] - 0.28, south - 0.02, 0.74), 0.32, 0.42, "-y", c_hall, mats)

    door = box("Door", (right["cx"] + 1.22, south - 0.04, 0.7), (0.62, 0.06, 1.14), c_hall, mats["door"])
    clay_bevel(door, 0.03, 2)
    # Timber porch: posts, beam, diagonal braces, small gable.
    cyl("PostL", (right["cx"] + 0.84, south - 0.46, 0.84), 0.07, 1.58, c_hall, mats["timber"], segs=12)
    cyl("PostR", (right["cx"] + 1.60, south - 0.46, 0.84), 0.07, 1.58, c_hall, mats["timber"], segs=12)
    box("PorchBeam", (right["cx"] + 1.22, south - 0.46, 1.62), (1.0, 0.1, 0.1), c_hall, mats["timber"])
    box("PorchBraceL", (right["cx"] + 0.98, south - 0.46, 1.28), (0.08, 0.08, 0.7), c_hall, mats["timber"], rot=(0, 0.55, 0))
    box("PorchBraceR", (right["cx"] + 1.46, south - 0.46, 1.28), (0.08, 0.08, 0.7), c_hall, mats["timber"], rot=(0, -0.55, 0))
    porch = box("PorchRoof", (right["cx"] + 1.22, south - 0.36, 1.78), (1.18, 0.82, 0.1), c_hall, mats["roof"])
    clay_bevel(porch, 0.04, 2)
    attic_prism("PorchAttic", right["cx"] + 1.22, south - 0.36, 1.78, 1.18, 0.7, 0.38, "y", c_hall, mats["roof"])
    steps("PorchStep", right["cx"] + 1.22, south - 0.62, c_hall, mats, 3, 1.12, "-y")

    window("WinE0", (east + 0.02, right["cy"] - 0.38, 1.86), 0.30, 0.40, "x", c_hall, mats, arched=True)
    window("WinE1", (east + 0.02, right["cy"] + 0.38, 1.86), 0.30, 0.40, "x", c_hall, mats, arched=True)
    window("WinE2", (east + 0.02, right["cy"] + 0.05, 0.74), 0.32, 0.42, "x", c_hall, mats)

    dormer = box("Dormer", (right["cx"] + 0.05, south + 0.18, eaves + 0.58), (0.62, 0.56, 0.5), c_hall, mats["wall"])
    clay_bevel(dormer, 0.04, 2)
    gable_roof("DormerRoof", right["cx"] + 0.05, south + 0.18, eaves + 0.78, 0.7, 0.6, 0.42, "y", c_hall, mats, overhang=0.05)
    window("WinDorm", (right["cx"] + 0.05, south - 0.08, eaves + 0.62), 0.22, 0.26, "-y", c_hall, mats)

    chimney("ChimL", (left["cx"] + 0.15, left["cy"] + 0.12, eaves + roof_h - 0.08), c_hall, mats)
    chimney("ChimR", (right["cx"] + 1.55, right["cy"] + 0.08, eaves + roof_h - 0.02), c_hall, mats)
    steps("LeftStep", left["cx"] - 0.15, left_south - 0.22, c_hall, mats, 2, 0.9, "-y")

    return left, right, eaves, roof_h, south


def build_tower(mats, c):
    cx, cy = 0.08, 0.22
    base, top, w = 2.28, 5.18, 1.28
    shaft = box("Tower", (cx, cy, (base + top) / 2), (w, w, top - base), c, mats["wall"])
    loft = box("ClockLoft", (cx, cy, top + 0.5), (w + 0.16, w + 0.16, 1.08), c, mats["wall"])
    clay_bevel(shaft, 0.08, 3)
    clay_bevel(loft, 0.07, 3)
    clock_face("ClockS", (cx, cy - (w + 0.16) / 2 - 0.04, top + 0.5), "-y", c, mats)
    clock_face("ClockW", (cx - (w + 0.16) / 2 - 0.04, cy, top + 0.5), "-x", c, mats)

    inset = (w + 0.16) / 2 + 0.02
    for i, (dx, dy) in enumerate(((-inset, -inset), (inset, -inset), (-inset, inset), (inset, inset))):
        pin = box(f"Pinnacle{i}", (cx + dx, cy + dy, top + 0.95), (0.11, 0.11, 0.5), c, mats["chimney"])
        clay_bevel(pin, 0.02, 2)

    hat_z = top + 0.5 + 0.54 + 0.7
    hat = cone("TowerRoof", (cx, cy, hat_z), 1.08, 1.4, c, mats["roof"], segs=4)
    clay_bevel(hat, 0.03, 2)
    # Four-sided pyramid shingles.
    tiles = []
    hat_h = 1.4
    for side, rot in enumerate(((0.72, 0, 0), (-0.72, 0, 0), (0, 0.72, 0), (0, -0.72, 0))):
        for r in range(6):
            t = (r + 0.5) / 6
            z = (top + 1.04) + t * hat_h * 0.85
            span = 1.7 * (1.0 - t)
            n = max(3, 7 - r)
            for k in range(n):
                off = (k + 0.5 - n / 2) * (span / n)
                if side == 0:
                    loc = (cx + off, cy - span * 0.28, z)
                elif side == 1:
                    loc = (cx + off, cy + span * 0.28, z)
                elif side == 2:
                    loc = (cx - span * 0.28, cy + off, z)
                else:
                    loc = (cx + span * 0.28, cy + off, z)
                tiles.append(box(f"TowerTile{side}_{r}_{k}", loc, (span / n * 0.9, 0.12, 0.03), c, mats["roof"], rot=rot))
    join_named("TowerTiles", tiles)
    cyl("Spire", (cx, cy, hat_z + 0.92), 0.026, 0.7, c, mats["chimney"], segs=10)
    ico("Finial", (cx, cy, hat_z + 1.28), 0.042, c, mats["bezel"])
    box("VaneArm", (cx, cy, hat_z + 1.38), (0.22, 0.028, 0.028), c, mats["chimney"])
    box("Vane", (cx, cy, hat_z + 1.46), (0.028, 0.028, 0.12), c, mats["chimney"])


def build_garden(mats, c):
    curve_wire(
        "IvyWest",
        [(-3.36, -0.85, 0.18), (-3.34, -0.62, 0.9), (-3.32, -0.28, 1.65), (-3.28, 0.05, 2.25), (-3.18, 0.32, 2.62)],
        c,
        mats["ivy"],
        0.07,
    )
    curve_wire(
        "IvyWestArm",
        [(-3.34, -1.15, 0.2), (-3.22, -1.35, 0.95), (-3.1, -1.42, 1.55)],
        c,
        mats["ivy"],
        0.055,
    )
    curve_wire(
        "IvySouthL",
        [(-0.72, -2.02, 0.16), (-0.62, -2.04, 0.88), (-0.52, -2.02, 1.58)],
        c,
        mats["ivy"],
        0.055,
    )
    curve_wire(
        "IvySouth",
        [(0.55, -2.46, 0.18), (0.62, -2.45, 1.05), (0.55, -2.42, 1.85), (0.42, -2.28, 2.48)],
        c,
        mats["ivy"],
        0.065,
    )
    curve_wire(
        "IvyPorch",
        [(2.05, -2.48, 0.2), (2.12, -2.46, 1.1), (2.2, -2.36, 1.88), (2.22, -2.12, 2.48)],
        c,
        mats["ivy"],
        0.058,
    )
    curve_wire(
        "IvyEast",
        [(3.72, -1.4, 0.2), (3.73, -1.22, 1.05), (3.7, -0.92, 1.82), (3.62, -0.62, 2.42)],
        c,
        mats["ivy"],
        0.065,
    )
    bush("BushSW", (-3.42, -1.55, 0.18), c, mats, 1.28)
    bush("BushS", (-2.05, -2.12, 0.16), c, mats, 1.08)
    bush("BushFront", (0.18, -2.78, 0.16), c, mats, 0.95)
    bush("BushSE", (3.62, -2.15, 0.18), c, mats, 1.18)
    bush("BushE", (3.92, -0.28, 0.16), c, mats, 0.98)
    bush("BushNW", (-3.48, 1.85, 0.16), c, mats, 1.05)


def reset_scene():
    if bpy.ops.object.mode_set.poll():
        bpy.ops.object.mode_set(mode="OBJECT")
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    for mat in list(bpy.data.materials):
        if mat.users == 0:
            bpy.data.materials.remove(mat)
    for cu in list(bpy.data.curves):
        if cu.users == 0:
            bpy.data.curves.remove(cu)
    for coll in list(bpy.data.collections):
        if coll.name not in {"Collection", "Scene Collection"}:
            try:
                bpy.data.collections.remove(coll)
            except RuntimeError:
                pass


def setup_render(scene):
    engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    for pref in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        if pref in engines:
            scene.render.engine = pref
            break
    else:
        scene.render.engine = engines[0]
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 1200
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = PREVIEW_PATH
    world = scene.world or bpy.data.worlds.new("TownHallWorld")
    scene.world = world
    if hasattr(world, "use_nodes"):
        world.use_nodes = True
    wnt = world.node_tree
    if wnt:
        bg = next((n for n in wnt.nodes if n.type == "BACKGROUND"), None)
        if bg:
            bg.inputs["Color"].default_value = (0.95, 0.93, 0.88, 1)
            bg.inputs["Strength"].default_value = 0.85
    try:
        scene.display_settings.display_device = "sRGB"
        scene.view_settings.view_transform = "Standard"
    except Exception:
        pass
    ee = scene.eevee
    for attr, val in (("taa_render_samples", 32), ("use_shadows", True), ("use_raytracing", True)):
        if hasattr(ee, attr):
            try:
                setattr(ee, attr, val)
            except Exception:
                pass


def build_camera():
    cam_data = bpy.data.cameras.new("DioramaCamera")
    cam_data.lens = 32
    cam = bpy.data.objects.new("DioramaCamera", cam_data)
    # Southwest, matching the overlay: Three (−10.2, 6.2, 12) → Blender (−10.2, −12.0, 6.2)
    cam.location = (-10.2, -12.0, 6.2)
    bpy.context.scene.collection.objects.link(cam)
    target = bpy.data.objects.new("CameraTarget", None)
    target.location = (0.1, -0.2, 2.55)
    bpy.context.scene.collection.objects.link(target)
    cns = cam.constraints.new("TRACK_TO")
    cns.target = target
    cns.track_axis = "TRACK_NEGATIVE_Z"
    cns.up_axis = "UP_Y"
    bpy.context.scene.camera = cam

    sun = bpy.data.lights.new("Sun", "SUN")
    sun.energy = 5.5
    sun.color = (1.0, 0.88, 0.68)
    sun_obj = bpy.data.objects.new("Sun", sun)
    sun_obj.location = (7.2, -5.4, 11.5)
    sun_obj.rotation_euler = (0.7, 0.15, 0.4)
    bpy.context.scene.collection.objects.link(sun_obj)

    fill = bpy.data.lights.new("Fill", "AREA")
    fill.energy = 80
    fill.color = (0.78, 0.85, 0.95)
    if hasattr(fill, "size"):
        fill.size = 6
    fill_obj = bpy.data.objects.new("Fill", fill)
    fill_obj.location = (-6.5, 3.8, 6.2)
    bpy.context.scene.collection.objects.link(fill_obj)


def apply_visuals():
    """Bevels and ivy curves must land in the GLB as real mesh, not modifiers."""
    view = bpy.context.view_layer
    if bpy.ops.object.mode_set.poll():
        bpy.ops.object.mode_set(mode="OBJECT")
    for obj in list(bpy.context.scene.objects):
        if obj.type != "CURVE":
            continue
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        view.objects.active = obj
        try:
            bpy.ops.object.convert(target="MESH")
        except Exception as exc:
            print("CURVE CONVERT SKIP", obj.name, exc)
    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH" or not obj.modifiers:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        view.objects.active = obj
        for mod in list(obj.modifiers):
            try:
                bpy.ops.object.modifier_apply(modifier=mod.name)
            except Exception as exc:
                print("MOD SKIP", obj.name, mod.name, exc)


def save_and_export():
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(PUBLIC_DIR, exist_ok=True)
    apply_visuals()
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    print("SAVED", BLEND_PATH)
    try:
        bpy.ops.render.render(write_still=True)
        print("RENDERED", PREVIEW_PATH)
    except Exception as exc:
        print("RENDER SKIP", exc)

    bpy.ops.object.select_all(action="DESELECT")
    for obj in bpy.context.scene.objects:
        if obj.type in {"MESH", "CURVE"}:
            obj.select_set(True)
    export_kwargs = dict(filepath=GLB_PATH, export_format="GLB", use_selection=True)
    for key, val in (
        ("export_apply", True),
        ("export_texcoords", True),
        ("export_normals", True),
        ("export_cameras", False),
        ("export_lights", False),
        ("export_yup", True),
    ):
        export_kwargs[key] = val
    try:
        bpy.ops.export_scene.gltf(**export_kwargs)
    except TypeError:
        bpy.ops.export_scene.gltf(filepath=GLB_PATH, export_format="GLB")
    print("EXPORTED", GLB_PATH)
    try:
        shutil.copy2(GLB_PATH, PUBLIC_GLB)
        print("COPIED", PUBLIC_GLB)
    except OSError as exc:
        print("COPY FAIL", exc)


def main():
    print("=== Town-hall clay diorama (Blender-authored, not Three.js) ===")
    reset_scene()
    setup_render(bpy.context.scene)
    mats = build_materials()
    c_base = col("01_Plaza")
    c_hall = col("02_Hall")
    c_tower = col("03_Tower")
    c_garden = col("04_Garden")
    build_plaza(mats, c_base)
    build_wings(mats, c_hall)
    build_tower(mats, c_tower)
    build_garden(mats, c_garden)
    build_camera()
    save_and_export()
    print("=== Done. Runtime loads public/diorama-town-hall/town_hall.glb ===")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        import traceback

        traceback.print_exc()
        sys.exit(1)
