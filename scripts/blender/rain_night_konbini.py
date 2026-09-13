# -*- coding: utf-8 -*-
"""Rain-night Japanese konbini street-corner diorama for Blender 5.1."""

from __future__ import annotations

import math
import os
import random
import sys

import bpy
import bmesh
from mathutils import Vector


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_DIR = os.path.join(ROOT, "assets", "diorama-konbini")
PUBLIC_DIR = os.path.join(ROOT, "public", "diorama-konbini")
BLEND_PATH = os.path.join(OUT_DIR, "konbini_rain_night.blend")
GLB_PATH = os.path.join(OUT_DIR, "konbini_rain_night.glb")
PREVIEW_PATH = os.path.join(OUT_DIR, "preview.png")
PUBLIC_GLB = os.path.join(PUBLIC_DIR, "konbini_rain_night.glb")

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\YuGothR.ttc",
    r"C:\Windows\Fonts\YuGothM.ttc",
    r"C:\Windows\Fonts\MEIRYO.TTC",
    r"C:\Windows\Fonts\msgothic.ttc",
    r"C:\Windows\Fonts\msyh.ttc",
]

BASE_Z = 0.28
STORE_ORIGIN = Vector((0.72, 0.58, BASE_Z))
STORE_SIZE = Vector((3.28, 2.82, 2.92))
RNG = random.Random(24)


# ---------------------------------------------------------------------------
# Materials
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


def _set_blend(mat, blended=False):
    if hasattr(mat, "surface_render_method"):
        mat.surface_render_method = "BLENDED" if blended else "DITHERED"
    if hasattr(mat, "blend_method"):
        mat.blend_method = "BLEND" if blended else "OPAQUE"
    if hasattr(mat, "shadow_method") and blended:
        try:
            mat.shadow_method = "NONE"
        except TypeError:
            pass


def mat_toon(name, color, shade=None, steps=3, roughness=0.82, emission=None, emit_str=0.0, level=1.0):
    """Cel-tinted Principled surface. Base Color is required so glTF keeps the hue."""
    mat = bpy.data.materials.new(name)
    nt = _nt_clear(mat)
    out = _out(nt)
    out.location = (560, 0)
    shade = shade or tuple(max(0.0, c * 0.62) for c in color)

    princ = nt.nodes.new("ShaderNodeBsdfPrincipled")
    princ.location = (200, 0)
    princ.inputs["Base Color"].default_value = (*color, 1)
    princ.inputs["Roughness"].default_value = roughness
    princ.inputs["Metallic"].default_value = 0.04 if roughness > 0.4 else 0.12
    princ.inputs["Emission Color"].default_value = (*(emission or color), 1)
    princ.inputs["Emission Strength"].default_value = emit_str if emit_str > 0 else max(0.12, level * 0.35)
    if "Specular IOR Level" in princ.inputs:
        princ.inputs["Specular IOR Level"].default_value = 0.22
    _link(nt, princ.outputs["BSDF"], out.inputs["Surface"])
    return mat


def mat_emit(name, color, strength=4.0):
    mat = bpy.data.materials.new(name)
    nt = _nt_clear(mat)
    out = _out(nt)
    princ = nt.nodes.new("ShaderNodeBsdfPrincipled")
    princ.inputs["Base Color"].default_value = (*color, 1)
    princ.inputs["Roughness"].default_value = 0.35
    princ.inputs["Emission Color"].default_value = (*color, 1)
    princ.inputs["Emission Strength"].default_value = strength
    _link(nt, princ.outputs["BSDF"], out.inputs["Surface"])
    return mat


def mat_glass(name, color=(1.0, 0.96, 0.88), rough=0.06):
    """Anime window: almost clear, slight warm veil, almost no Fresnel so it never goes black."""
    mat = bpy.data.materials.new(name)
    nt = _nt_clear(mat)
    out = _out(nt)
    trans = nt.nodes.new("ShaderNodeBsdfTransparent")
    trans.inputs["Color"].default_value = (*color, 1)
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (1.0, 0.88, 0.62, 1)
    emit.inputs["Strength"].default_value = 0.08
    mix = nt.nodes.new("ShaderNodeMixShader")
    mix.inputs["Fac"].default_value = 0.08
    _link(nt, trans.outputs["BSDF"], mix.inputs[1])
    _link(nt, emit.outputs["Emission"], mix.inputs[2])
    _link(nt, mix.outputs["Shader"], out.inputs["Surface"])
    _set_blend(mat, True)
    mat.use_backface_culling = False
    if hasattr(mat, "use_raytrace_refraction"):
        mat.use_raytrace_refraction = False
    return mat


def mat_water(name):
    mat = bpy.data.materials.new(name)
    nt = _nt_clear(mat)
    out = _out(nt)
    out.location = (700, 0)

    glass = nt.nodes.new("ShaderNodeBsdfGlass")
    glass.location = (360, 80)
    glass.inputs["Color"].default_value = (0.55, 0.72, 0.82, 1)
    glass.inputs["Roughness"].default_value = 0.06
    glass.inputs["IOR"].default_value = 1.333

    gloss = nt.nodes.new("ShaderNodeBsdfGlossy")
    gloss.location = (360, -120)
    gloss.inputs["Color"].default_value = (0.75, 0.85, 0.95, 1)
    gloss.inputs["Roughness"].default_value = 0.08

    mix = nt.nodes.new("ShaderNodeMixShader")
    mix.location = (540, 0)
    mix.inputs["Fac"].default_value = 0.45

    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.location = (0, 200)
    wave.wave_type = "RINGS"
    wave.inputs["Scale"].default_value = 28.0
    wave.inputs["Distortion"].default_value = 1.4
    wave.inputs["Detail"].default_value = 2.0

    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.location = (-220, 200)
    texcoord = nt.nodes.new("ShaderNodeTexCoord")
    texcoord.location = (-420, 200)
    _link(nt, texcoord.outputs["Generated"], mapping.inputs["Vector"])
    _link(nt, mapping.outputs["Vector"], wave.inputs["Vector"])

    bump = nt.nodes.new("ShaderNodeBump")
    bump.location = (180, 80)
    bump.inputs["Strength"].default_value = 0.28
    _link(nt, wave.outputs["Color"], bump.inputs["Height"])
    _link(nt, bump.outputs["Normal"], glass.inputs["Normal"])
    _link(nt, bump.outputs["Normal"], gloss.inputs["Normal"])
    _link(nt, glass.outputs["BSDF"], mix.inputs[1])
    _link(nt, gloss.outputs["BSDF"], mix.inputs[2])
    _link(nt, mix.outputs["Shader"], out.inputs["Surface"])
    _set_blend(mat, True)

    # Animate ripple phase.
    fcurve = mapping.inputs["Location"].driver_add("default_value", 0)
    drv = fcurve.driver
    drv.type = "SCRIPTED"
    drv.expression = "frame * 0.035"
    return mat


def mat_outline():
    mat = bpy.data.materials.new("MAT_Outline")
    nt = _nt_clear(mat)
    out = _out(nt)
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (0.035, 0.03, 0.05, 1)
    emit.inputs["Strength"].default_value = 1.0
    _link(nt, emit.outputs["Emission"], out.inputs["Surface"])
    mat.use_backface_culling = True
    if hasattr(mat, "use_backface_culling_shadow"):
        mat.use_backface_culling_shadow = True
    return mat


def load_font():
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return bpy.data.fonts.load(path)
            except RuntimeError:
                existing = [f for f in bpy.data.fonts if path.replace("\\", "/") in f.filepath.replace("\\", "/")]
                if existing:
                    return existing[0]
    return bpy.data.fonts[0]


def build_materials():
    mats = {
        "outline": mat_outline(),
        "plinth": mat_toon("MAT_Plinth", (0.18, 0.14, 0.13), roughness=0.9, level=0.55),
        "plinth_edge": mat_toon("MAT_PlinthEdge", (0.52, 0.40, 0.28), roughness=0.7, level=0.6),
        "asphalt": mat_toon("MAT_Asphalt", (0.12, 0.14, 0.18), roughness=0.22, level=0.5),
        "sidewalk": mat_toon("MAT_Sidewalk", (0.32, 0.33, 0.36), roughness=0.55, level=0.58),
        "curb": mat_toon("MAT_Curb", (0.42, 0.42, 0.44), level=0.58),
        "gutter": mat_toon("MAT_Gutter", (0.10, 0.12, 0.14), roughness=0.18, level=0.45),
        "zebra": mat_toon("MAT_Zebra", (0.86, 0.88, 0.90), roughness=0.2, level=0.7),
        "paint": mat_toon("MAT_Paint", (0.90, 0.91, 0.92), roughness=0.35, level=0.65),
        "wall_cream": mat_toon("MAT_WallCream", (0.93, 0.86, 0.72), level=0.7),
        "wall_teal": mat_toon("MAT_WallTeal", (0.12, 0.58, 0.56), level=0.75),
        "wall_navy": mat_toon("MAT_WallNavy", (0.10, 0.20, 0.42), level=0.6),
        "roof": mat_toon("MAT_Roof", (0.16, 0.17, 0.20), level=0.5),
        "frame": mat_toon("MAT_Frame", (0.16, 0.16, 0.18), level=0.5),
        "metal": mat_toon("MAT_Metal", (0.48, 0.50, 0.54), roughness=0.35, level=0.6),
        "metal_dark": mat_toon("MAT_MetalDark", (0.18, 0.18, 0.20), roughness=0.4, level=0.5),
        "awning": mat_toon("MAT_Awning", (0.08, 0.56, 0.58), level=0.75),
        "mat": mat_toon("MAT_Doormat", (0.20, 0.32, 0.22), level=0.55),
        "wood": mat_toon("MAT_Wood", (0.52, 0.32, 0.16), level=0.7),
        "plastic_red": mat_toon("MAT_Red", (0.86, 0.16, 0.18), level=0.85),
        "plastic_blue": mat_toon("MAT_Blue", (0.16, 0.36, 0.82), level=0.85),
        "plastic_green": mat_toon("MAT_Green", (0.16, 0.64, 0.32), level=0.85),
        "plastic_yellow": mat_toon("MAT_Yellow", (0.95, 0.78, 0.18), level=0.85),
        "plastic_orange": mat_toon("MAT_Orange", (0.92, 0.46, 0.12), level=0.85),
        "plastic_pink": mat_toon("MAT_Pink", (0.90, 0.38, 0.56), level=0.85),
        "plastic_white": mat_toon("MAT_White", (0.95, 0.94, 0.88), level=0.8),
        "floor": mat_toon("MAT_Floor", (0.88, 0.76, 0.54), roughness=0.45, level=0.85),
        "counter": mat_toon("MAT_Counter", (0.28, 0.24, 0.22), level=0.75),
        "shelf": mat_toon("MAT_Shelf", (0.78, 0.74, 0.62), level=0.8),
        "concrete": mat_toon("MAT_Concrete", (0.38, 0.38, 0.40), level=0.55),
        "yellow_stripe": mat_toon("MAT_YellowStripe", (0.95, 0.80, 0.10), level=0.8),
        "black": mat_toon("MAT_Black", (0.08, 0.08, 0.09), level=0.4),
        "poster_a": mat_toon("MAT_PosterA", (0.90, 0.22, 0.28), level=0.8),
        "poster_b": mat_toon("MAT_PosterB", (0.16, 0.58, 0.78), level=0.8),
        "poster_c": mat_toon("MAT_PosterC", (0.95, 0.82, 0.18), level=0.8),
        "glass": mat_glass("MAT_Glass"),
        "glass_dark": mat_glass("MAT_GlassDark", (0.85, 0.90, 0.95), 0.08),
        "water": mat_water("MAT_Water"),
        "sign_teal": mat_emit("MAT_SignTeal", (0.22, 0.88, 0.84), 1.35),
        "sign_white": mat_emit("MAT_SignWhite", (0.92, 0.90, 0.82), 1.15),
        "sign_navy": mat_emit("MAT_SignNavy", (0.22, 0.36, 0.82), 1.05),
        "neon_warm": mat_emit("MAT_NeonWarm", (1.0, 0.74, 0.38), 1.8),
        "neon_cool": mat_emit("MAT_NeonCool", (0.45, 0.70, 0.88), 0.55),
        "interior_light": mat_emit("MAT_InteriorLight", (1.0, 0.86, 0.60), 2.4),
        "lamp_glow": mat_emit("MAT_LampGlow", (1.0, 0.70, 0.40), 2.6),
        "vending_glass": mat_emit("MAT_VendingGlass", (0.18, 0.36, 0.78), 0.85),
        "guide": mat_toon("MAT_Guide", (0.95, 0.78, 0.12), level=0.85),
        "rail": mat_toon("MAT_Rail", (0.52, 0.54, 0.58), roughness=0.3, level=0.6),
        "tire": mat_toon("MAT_Tire", (0.10, 0.10, 0.11), level=0.45),
        "umbrella_a": mat_toon("MAT_UmbA", (0.18, 0.32, 0.72), level=0.75),
        "umbrella_b": mat_toon("MAT_UmbB", (0.82, 0.16, 0.16), level=0.75),
        "umbrella_c": mat_toon("MAT_UmbC", (0.16, 0.16, 0.18), level=0.55),
        "plant": mat_toon("MAT_Plant", (0.18, 0.46, 0.20), level=0.65),
    }
    return mats


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
        if isinstance(mat, (list, tuple)):
            for m in mat:
                obj.data.materials.append(m)
        else:
            obj.data.materials.append(mat)
    return link(obj, collection)


def box(name, loc, size, collection, mat, rot=(0, 0, 0)):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bm.to_mesh(mesh)
    bm.free()
    obj = _new_obj(name, mesh, loc, collection, mat, rot, size)
    return obj


def cyl(name, loc, radius, depth, collection, mat, rot=(0, 0, 0), segs=24):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=radius, radius2=radius, depth=depth)
    bm.to_mesh(mesh)
    bm.free()
    return _new_obj(name, mesh, loc, collection, mat, rot)


def cone(name, loc, r1, r2, depth, collection, mat, rot=(0, 0, 0), segs=20):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r1, radius2=r2, depth=depth)
    bm.to_mesh(mesh)
    bm.free()
    return _new_obj(name, mesh, loc, collection, mat, rot)


def ico(name, loc, radius, collection, mat, subdiv=1):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=radius)
    bm.to_mesh(mesh)
    bm.free()
    return _new_obj(name, mesh, loc, collection, mat)


def torus(name, loc, major, minor, collection, mat, rot=(0, 0, 0)):
    # Stylized toon wheel: tire ring + hub, no torus op in Blender 5.1 bmesh.
    tire = cyl(name, loc, major + minor * 0.15, minor * 2.2, collection, mat, rot, segs=20)
    hub = cyl(name + "Hub", loc, major * 0.22, minor * 1.1, collection, bpy.data.materials.get("MAT_Metal") or mat, rot, segs=12)
    return tire


def plane(name, loc, size, collection, mat, rot=(0, 0, 0)):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=1.0)
    bm.to_mesh(mesh)
    bm.free()
    return _new_obj(name, mesh, loc, collection, mat, rot, (size[0], size[1], 1))


def add_outline(obj, mats, thickness=0.007):
    if obj.type != "MESH":
        return
    outline = mats["outline"]
    names = [m.name for m in obj.data.materials]
    if outline.name not in names:
        obj.data.materials.append(outline)
    idx = list(obj.data.materials).index(outline)
    mod = obj.modifiers.new("Outline", "SOLIDIFY")
    mod.thickness = thickness
    mod.offset = 1.0
    mod.use_flip_normals = True
    mod.use_rim = False
    mod.material_offset = idx
    if hasattr(mod, "material_offset_rim"):
        mod.material_offset_rim = idx


def shade_smooth(obj, angle=0.55):
    mesh = obj.data
    if hasattr(mesh, "use_auto_smooth"):
        mesh.use_auto_smooth = True
        mesh.auto_smooth_angle = angle
    for p in mesh.polygons:
        p.use_smooth = True


def join_named(name, objects):
    objects = [o for o in objects if o is not None]
    if not objects:
        return None
    if len(objects) == 1:
        objects[0].name = name
        return objects[0]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    objects[0].name = name
    return objects[0]


def text_obj(name, body, loc, size, collection, mat, font, extrude=0.018, align="CENTER", rot=(0, 0, 0)):
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = body
    cu.size = size
    cu.extrude = extrude
    cu.bevel_depth = 0.001
    cu.align_x = align
    cu.align_y = "CENTER"
    cu.font = font
    obj = bpy.data.objects.new(name, cu)
    obj.location = loc
    obj.rotation_euler = rot
    if mat:
        obj.data.materials.append(mat)
    return link(obj, collection)


def curve_wire(name, points, collection, mat, radius=0.012):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = 2
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


# ---------------------------------------------------------------------------
# Scene setup
# ---------------------------------------------------------------------------

def reset_scene():
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
    scene.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in engines else engines[0]
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1440
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.fps = 24
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.filepath = PREVIEW_PATH
    scene.frame_start = 1
    scene.frame_end = 120
    scene.frame_current = 24

    world = scene.world
    if world is None:
        world = bpy.data.worlds.new("NightWorld")
        scene.world = world
    if hasattr(world, "use_nodes"):
        world.use_nodes = True
    wnt = world.node_tree
    if wnt:
        bg = next((n for n in wnt.nodes if n.type == "BACKGROUND"), None)
        if bg:
            bg.inputs["Color"].default_value = (0.006, 0.008, 0.016, 1)
            bg.inputs["Strength"].default_value = 0.12

    try:
        scene.display_settings.display_device = "sRGB"
        scene.view_settings.view_transform = "Standard"
        scene.view_settings.look = "None"
        scene.view_settings.exposure = -0.2
        scene.view_settings.gamma = 1.05
    except Exception:
        pass

    ee = scene.eevee
    for attr, val in (
        ("taa_render_samples", 64),
        ("taa_samples", 16),
        ("use_shadows", True),
        ("use_raytracing", True),
        ("use_volumetric", False),
        ("shadow_pool_size", 2048),
        ("use_fast_gi", True),
    ):
        if hasattr(ee, attr):
            try:
                setattr(ee, attr, val)
            except Exception:
                pass
    if hasattr(ee, "shadow_pool_size"):
        try:
            ee.shadow_pool_size = 4096
        except TypeError:
            pass

    # Blender 5 compositor is a standalone node group.
    nt = bpy.data.node_groups.new("DioramaComp", "CompositorNodeTree")
    scene.compositing_node_group = nt
    nt.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    rl = nt.nodes.new("CompositorNodeRLayers")
    rl.location = (0, 0)
    glare = nt.nodes.new("CompositorNodeGlare")
    glare.location = (280, 0)
    if "glare_type" in glare.bl_rna.properties:
        items = [i.identifier for i in glare.bl_rna.properties["glare_type"].enum_items]
        if "BLOOM" in items:
            glare.glare_type = "BLOOM"
        elif "FOG_GLOW" in items:
            glare.glare_type = "FOG_GLOW"
    for attr, val in (("quality", "HIGH"), ("mix", 0.06), ("threshold", 3.4), ("size", 6)):
        if hasattr(glare, attr):
            try:
                setattr(glare, attr, val)
            except Exception:
                pass
    out = nt.nodes.new("NodeGroupOutput")
    out.location = (560, 0)
    try:
        nt.links.new(rl.outputs["Image"], glare.inputs[0])
        nt.links.new(glare.outputs[0], out.inputs[0])
    except Exception:
        nt.links.new(rl.outputs["Image"], out.inputs[0])


# ---------------------------------------------------------------------------
# Builders
# ---------------------------------------------------------------------------

def build_base(mats, c):
    plinth = box("Plinth", (0, 0, BASE_Z * 0.5 - 0.02), (8.0, 8.0, BASE_Z + 0.04), c, mats["plinth"])
    add_outline(plinth, mats, 0.016)
    edge = box("PlinthEdge", (0, 0, BASE_Z - 0.015), (8.08, 8.08, 0.05), c, mats["plinth_edge"])
    add_outline(edge, mats, 0.01)
    # Top street deck.
    deck = box("StreetDeck", (0, 0, BASE_Z + 0.01), (7.92, 7.92, 0.04), c, mats["asphalt"])
    add_outline(deck, mats, 0.01)
    return plinth


def build_street(mats, c):
    # L-shaped sidewalk around the store, leaving streets on -X and -Y.
    # Front sidewalk (south of store)
    sw_front = box("SidewalkFront", (0.95, -1.28, BASE_Z + 0.045), (4.55, 1.12, 0.07), c, mats["sidewalk"])
    sw_left = box("SidewalkLeft", (-1.22, 0.70, BASE_Z + 0.045), (1.12, 4.10, 0.07), c, mats["sidewalk"])
    sw_corner = box("SidewalkCorner", (-1.22, -1.28, BASE_Z + 0.045), (1.12, 1.12, 0.07), c, mats["sidewalk"])
    sw_back = box("SidewalkBack", (0.95, 2.72, BASE_Z + 0.045), (4.55, 0.70, 0.07), c, mats["sidewalk"])
    sw_right = box("SidewalkRight", (3.05, 0.72, BASE_Z + 0.045), (0.70, 3.30, 0.07), c, mats["sidewalk"])
    for o in (sw_front, sw_left, sw_corner, sw_back, sw_right):
        add_outline(o, mats, 0.006)

    curb_f = box("CurbFront", (0.55, -1.86, BASE_Z + 0.03), (5.4, 0.10, 0.08), c, mats["curb"])
    curb_l = box("CurbLeft", (-1.80, 0.35, BASE_Z + 0.03), (0.10, 4.55, 0.08), c, mats["curb"])
    add_outline(curb_f, mats, 0.004)
    add_outline(curb_l, mats, 0.004)

    gutter_f = box("GutterFront", (0.40, -1.98, BASE_Z + 0.018), (5.7, 0.16, 0.03), c, mats["gutter"])
    gutter_l = box("GutterLeft", (-1.94, 0.20, BASE_Z + 0.018), (0.16, 4.8, 0.03), c, mats["gutter"])

    # Zebra crossing on the front street.
    for i, x in enumerate((-1.55, -1.12, -0.69, -0.26, 0.17, 0.60, 1.03)):
        z = box(f"Zebra_{i}", (x, -2.55, BASE_Z + 0.026), (0.32, 1.05, 0.012), c, mats["zebra"])
        add_outline(z, mats, 0.003)

    # Parking bay on the side street.
    for name, loc, size in (
        ("ParkLineL", (-2.55, 0.15, BASE_Z + 0.026), (0.06, 2.05, 0.01)),
        ("ParkLineR", (-3.35, 0.15, BASE_Z + 0.026), (0.06, 2.05, 0.01)),
        ("ParkLineF", (-2.95, -0.85, BASE_Z + 0.026), (0.86, 0.06, 0.01)),
        ("ParkLineB", (-2.95, 1.15, BASE_Z + 0.026), (0.86, 0.06, 0.01)),
    ):
        add_outline(box(name, loc, size, c, mats["paint"]), mats, 0.002)

    # Alley entrance behind / left-back.
    alley_floor = box("AlleyFloor", (3.35, 2.85, BASE_Z + 0.02), (1.15, 1.85, 0.03), c, mats["gutter"])
    alley_wall_a = box("AlleyWallA", (3.88, 2.55, BASE_Z + 1.15), (0.12, 2.4, 2.3), c, mats["concrete"])
    alley_wall_b = box("AlleyWallB", (2.55, 3.55, BASE_Z + 1.25), (1.6, 0.12, 2.5), c, mats["wall_navy"])
    add_outline(alley_wall_a, mats, 0.008)
    add_outline(alley_wall_b, mats, 0.008)

    # Corner guardrail / bollards.
    for i, xy in enumerate(((-1.92, -1.92), (-1.70, -2.08), (-2.08, -1.70))):
        pole = cyl(f"Bollard_{i}", (xy[0], xy[1], BASE_Z + 0.28), 0.045, 0.42, c, mats["yellow_stripe"])
        add_outline(pole, mats, 0.004)
    rail = box("CornerRail", (-1.90, -1.90, BASE_Z + 0.38), (0.55, 0.04, 0.04), c, mats["rail"])
    rail.rotation_euler[2] = math.radians(45)
    add_outline(rail, mats, 0.003)

    # Puddles
    puddles = [
        ("Puddle_1", (-0.15, -2.45, BASE_Z + 0.028), (1.35, 0.72, 1)),
        ("Puddle_2", (1.55, -2.15, BASE_Z + 0.028), (0.85, 0.48, 1)),
        ("Puddle_3", (-2.35, -0.55, BASE_Z + 0.028), (0.95, 0.62, 1)),
        ("Puddle_4", (-0.85, -1.55, BASE_Z + 0.055), (0.55, 0.32, 1)),
        ("Puddle_5", (2.15, -1.55, BASE_Z + 0.055), (0.42, 0.28, 1)),
    ]
    for name, loc, size in puddles:
        p = plane(name, loc, size, c, mats["water"])
        p.scale.z = 1
        # slightly irregular via scale already

    return alley_floor


def build_store_exterior(mats, c, font):
    ox, oy, oz = STORE_ORIGIN
    sx, sy, sz = STORE_SIZE
    cx, cy = ox, oy
    floor_z = oz

    # Solid shell, then cut visually with glass panels (not boolean — cleaner toon).
    # Back and right solid walls, roof, floor slab, fascia.
    floor = box("StoreFloor", (cx, cy, floor_z + 0.03), (sx, sy, 0.06), c, mats["floor"])
    add_outline(floor, mats, 0.006)

    back = box("WallBack", (cx, cy + sy * 0.5 - 0.06, floor_z + sz * 0.5), (sx, 0.12, sz), c, mats["wall_cream"])
    right = box("WallRight", (cx + sx * 0.5 - 0.06, cy + 0.06, floor_z + sz * 0.5), (0.12, sy - 0.12, sz), c, mats["wall_cream"])
    # Front left solid piers
    pier_fl = box("PierFrontL", (cx - sx * 0.5 + 0.10, cy - sy * 0.5 + 0.06, floor_z + sz * 0.5), (0.20, 0.12, sz), c, mats["wall_cream"])
    pier_fr = box("PierFrontR", (cx + sx * 0.5 - 0.10, cy - sy * 0.5 + 0.06, floor_z + sz * 0.5), (0.20, 0.12, sz), c, mats["wall_cream"])
    pier_ll = box("PierLeftF", (cx - sx * 0.5 + 0.06, cy - sy * 0.5 + 0.10, floor_z + sz * 0.5), (0.12, 0.20, sz), c, mats["wall_cream"])
    pier_lb = box("PierLeftB", (cx - sx * 0.5 + 0.06, cy + sy * 0.5 - 0.10, floor_z + sz * 0.5), (0.12, 0.20, sz), c, mats["wall_cream"])
    lintel_f = box("LintelFront", (cx, cy - sy * 0.5 + 0.06, floor_z + sz - 0.22), (sx, 0.12, 0.44), c, mats["wall_cream"])
    lintel_l = box("LintelLeft", (cx - sx * 0.5 + 0.06, cy, floor_z + sz - 0.22), (0.12, sy, 0.44), c, mats["wall_cream"])
    sill_f = box("SillFront", (cx, cy - sy * 0.5 + 0.06, floor_z + 0.16), (sx - 0.4, 0.12, 0.20), c, mats["wall_cream"])
    sill_l = box("SillLeft", (cx - sx * 0.5 + 0.06, cy + 0.15, floor_z + 0.16), (0.12, sy - 0.5, 0.20), c, mats["wall_cream"])

    for o in (back, right, pier_fl, pier_fr, pier_ll, pier_lb, lintel_f, lintel_l, sill_f, sill_l):
        add_outline(o, mats, 0.008)

    # Fascia stripes (teal / white / navy)
    fascia_y = cy - sy * 0.5 - 0.02
    fascia_x = cx - sx * 0.5 - 0.02
    for i, (mat_key, zoff, h) in enumerate(
        (("wall_navy", 2.42, 0.16), ("sign_white", 2.28, 0.12), ("wall_teal", 2.10, 0.24))
    ):
        box(f"FasciaF_{i}", (cx, fascia_y, floor_z + zoff), (sx + 0.08, 0.06, h), c, mats[mat_key])
        box(f"FasciaL_{i}", (fascia_x, cy, floor_z + zoff), (0.06, sy + 0.08, h), c, mats[mat_key])

    roof = box("Roof", (cx, cy, floor_z + sz + 0.08), (sx + 0.22, sy + 0.22, 0.16), c, mats["roof"])
    add_outline(roof, mats, 0.01)

    # Big glass panes.
    glass_f = box(
        "GlassFront",
        (cx - 0.15, cy - sy * 0.5 + 0.055, floor_z + 1.28),
        (sx - 0.62, 0.03, 2.05),
        c,
        mats["glass"],
    )
    glass_l = box(
        "GlassLeft",
        (cx - sx * 0.5 + 0.055, cy + 0.12, floor_z + 1.28),
        (0.03, sy - 0.55, 2.05),
        c,
        mats["glass"],
    )
    # Mullions
    for i, x in enumerate((cx - 0.95, cx + 0.55)):
        add_outline(box(f"MullionF_{i}", (x, cy - sy * 0.5 + 0.07, floor_z + 1.28), (0.045, 0.05, 2.05), c, mats["frame"]), mats, 0.003)
    add_outline(box("MullionL_0", (cx - sx * 0.5 + 0.07, cy + 0.15, floor_z + 1.28), (0.05, 0.045, 2.05), c, mats["frame"]), mats, 0.003)

    # Automatic sliding doors (front, slightly left of center)
    door_x = cx - 0.35
    door_y = cy - sy * 0.5 - 0.02
    add_outline(box("DoorJambL", (door_x - 0.58, door_y, floor_z + 1.12), (0.08, 0.10, 2.20), c, mats["metal_dark"]), mats, 0.004)
    add_outline(box("DoorJambR", (door_x + 0.58, door_y, floor_z + 1.12), (0.08, 0.10, 2.20), c, mats["metal_dark"]), mats, 0.004)
    add_outline(box("DoorHead", (door_x, door_y, floor_z + 2.18), (1.24, 0.10, 0.10), c, mats["metal_dark"]), mats, 0.004)
    add_outline(box("DoorSill", (door_x, door_y, floor_z + 0.08), (1.24, 0.12, 0.08), c, mats["metal"]), mats, 0.003)
    box("DoorGlassL", (door_x - 0.28, door_y - 0.02, floor_z + 1.12), (0.52, 0.03, 2.00), c, mats["glass"])
    box("DoorGlassR", (door_x + 0.28, door_y - 0.02, floor_z + 1.12), (0.52, 0.03, 2.00), c, mats["glass"])
    box("DoorBar", (door_x, door_y - 0.04, floor_z + 1.05), (1.10, 0.04, 0.05), c, mats["metal"])
    # Sensor box
    add_outline(box("DoorSensor", (door_x, door_y - 0.06, floor_z + 2.28), (0.28, 0.08, 0.06), c, mats["metal_dark"]), mats, 0.003)

    # Awning / eaves
    awning = box("Awning", (cx - 0.15, cy - sy * 0.5 - 0.42, floor_z + 2.52), (sx + 0.15, 0.78, 0.06), c, mats["awning"])
    add_outline(awning, mats, 0.006)
    awning_l = box("AwningLeft", (cx - sx * 0.5 - 0.38, cy + 0.05, floor_z + 2.52), (0.70, sy - 0.15, 0.06), c, mats["awning"])
    add_outline(awning_l, mats, 0.006)
    for i, x in enumerate((cx - 1.35, cx - 0.15, cx + 1.05)):
        add_outline(cyl(f"AwningRod_{i}", (x, cy - sy * 0.5 - 0.08, floor_z + 2.28), 0.02, 0.48, c, mats["metal"], rot=(math.radians(90), 0, 0)), mats, 0.002)

    # Main sign box
    sign = box("SignBox", (cx - 0.05, cy - sy * 0.5 - 0.16, floor_z + 3.18), (2.55, 0.18, 0.62), c, mats["sign_teal"])
    add_outline(sign, mats, 0.008)
    box("SignBoxInner", (cx - 0.05, cy - sy * 0.5 - 0.20, floor_z + 3.18), (2.40, 0.06, 0.50), c, mats["sign_white"])
    text_obj("SignTextJP", "ほしマート", (cx - 0.18, cy - sy * 0.5 - 0.24, floor_z + 3.22), 0.28, c, mats["wall_navy"], font, 0.012, rot=(math.radians(90), 0, 0))
    text_obj("Sign24", "24h", (cx + 0.95, cy - sy * 0.5 - 0.24, floor_z + 3.16), 0.16, c, mats["plastic_red"], font, 0.01, rot=(math.radians(90), 0, 0))
    # Side sign
    box("SideSign", (cx - sx * 0.5 - 0.14, cy + 0.35, floor_z + 3.05), (0.12, 1.15, 0.42), c, mats["sign_navy"])
    text_obj("SideSignText", "HOSHI", (cx - sx * 0.5 - 0.21, cy + 0.35, floor_z + 3.05), 0.16, c, mats["sign_white"], font, 0.008, rot=(math.radians(90), 0, math.radians(90)))

    # Vertical neon 24
    neon = box("Neon24Box", (cx + sx * 0.5 + 0.05, cy - sy * 0.5 + 0.35, floor_z + 2.15), (0.08, 0.36, 1.15), c, mats["sign_teal"])
    add_outline(neon, mats, 0.004)
    text_obj("Neon24Text", "24", (cx + sx * 0.5 + 0.10, cy - sy * 0.5 + 0.35, floor_z + 2.25), 0.28, c, mats["sign_white"], font, 0.01, rot=(math.radians(90), 0, math.radians(-90)))

    # Window posters / campaign boards on the glass
    box("WinPosterA", (cx + 0.95, cy - sy * 0.5 + 0.03, floor_z + 1.55), (0.42, 0.01, 0.58), c, mats["poster_a"])
    box("WinPosterB", (cx + 1.32, cy - sy * 0.5 + 0.03, floor_z + 1.55), (0.28, 0.01, 0.42), c, mats["poster_c"])
    box("WinPosterC", (cx - 1.25, cy - sy * 0.5 + 0.03, floor_z + 1.48), (0.36, 0.01, 0.50), c, mats["poster_b"])

    # Doormat
    add_outline(box("Doormat", (door_x, door_y - 0.32, floor_z + 0.055), (1.15, 0.55, 0.03), c, mats["mat"]), mats, 0.003)

    # AC outdoor unit on right wall
    ac = box("ACUnit", (cx + sx * 0.5 + 0.16, cy + 0.55, floor_z + 1.85), (0.28, 0.72, 0.52), c, mats["metal"])
    add_outline(ac, mats, 0.005)
    box("ACVent", (cx + sx * 0.5 + 0.31, cy + 0.55, floor_z + 1.85), (0.02, 0.62, 0.40), c, mats["metal_dark"])
    box("ACPipe", (cx + sx * 0.5 + 0.08, cy + 0.90, floor_z + 2.25), (0.05, 0.05, 0.55), c, mats["metal_dark"])

    # Poster board on left-back exterior
    board = box("PosterBoard", (cx - sx * 0.5 - 0.04, cy + 0.95, floor_z + 1.35), (0.04, 0.72, 0.95), c, mats["metal_dark"])
    add_outline(board, mats, 0.004)
    box("Poster1", (cx - sx * 0.5 - 0.065, cy + 0.78, floor_z + 1.58), (0.01, 0.28, 0.38), c, mats["poster_a"])
    box("Poster2", (cx - sx * 0.5 - 0.065, cy + 1.12, floor_z + 1.58), (0.01, 0.28, 0.38), c, mats["poster_b"])
    box("Poster3", (cx - sx * 0.5 - 0.065, cy + 0.95, floor_z + 1.12), (0.01, 0.62, 0.22), c, mats["poster_c"])

    return {
        "origin": STORE_ORIGIN,
        "size": STORE_SIZE,
        "door_x": door_x,
        "door_y": door_y,
        "awning_front_y": cy - sy * 0.5 - 0.78,
        "awning_z": floor_z + 2.49,
        "sign": sign,
        "neon": neon,
    }


def _product_mat(mats, i):
    keys = (
        "plastic_red",
        "plastic_blue",
        "plastic_green",
        "plastic_yellow",
        "plastic_orange",
        "plastic_pink",
        "plastic_white",
        "wall_navy",
        "wall_teal",
    )
    return mats[keys[i % len(keys)]]


def build_store_interior(mats, c, font, store):
    ox, oy, oz = store["origin"]
    sx, sy, sz = store["size"]
    z0 = oz + 0.08

    # Ceiling
    ceil = box("Ceiling", (ox, oy, oz + sz - 0.10), (sx - 0.16, sy - 0.16, 0.08), c, mats["plastic_white"])
    # Warm ceiling panels
    for i, (x, y) in enumerate(((-0.85, -0.35), (0.15, -0.35), (1.10, -0.35), (-0.85, 0.70), (0.15, 0.70), (1.10, 0.70))):
        box(f"CeilLight_{i}", (ox + x, oy + y, oz + sz - 0.15), (0.72, 0.28, 0.03), c, mats["interior_light"])

    # Interior lightbox over aisles
    box("InteriorSign", (ox + 0.05, oy + 0.15, oz + 2.48), (1.35, 0.08, 0.22), c, mats["sign_white"])
    text_obj("InteriorSignTxt", "お弁当・おにぎり", (ox + 0.05, oy + 0.10, oz + 2.48), 0.09, c, mats["wall_teal"], font, 0.004, rot=(math.radians(90), 0, 0))

    # Center gondola shelves (2 aisles)
    def shelf_unit(name, loc, n_bays=4):
        parts = []
        parts.append(box(f"{name}_frame", loc, (0.42, 1.55, 1.62), c, mats["shelf"]))
        for s in range(4):
            z = loc[2] - 0.62 + s * 0.38
            parts.append(box(f"{name}_plank_{s}", (loc[0], loc[1], z), (0.40, 1.50, 0.03), c, mats["shelf"]))
            for k in range(n_bays * 3):
                px = loc[0] + RNG.uniform(-0.12, 0.12)
                py = loc[1] - 0.62 + (k % 9) * 0.15
                pz = z + 0.08 + RNG.uniform(0, 0.02)
                h = RNG.choice((0.10, 0.13, 0.16, 0.09))
                w = RNG.choice((0.07, 0.09, 0.06, 0.11))
                d = 0.08
                parts.append(box(f"{name}_sku_{s}_{k}", (px, py, pz), (w, d, h), c, _product_mat(mats, k + s)))
        joined = join_named(name, parts)
        if joined:
            add_outline(joined, mats, 0.004)
        return joined

    shelf_unit("ShelfA", (ox - 0.45, oy - 0.15, z0 + 0.85))
    shelf_unit("ShelfB", (ox + 0.42, oy - 0.05, z0 + 0.85))

    # Colorful window-facing display just inside the front glass.
    window_sku = []
    for i in range(14):
        window_sku.append(
            box(
                f"WindowSku_{i}",
                (ox - 1.15 + (i % 7) * 0.18, oy - sy * 0.5 + 0.28, z0 + 0.22 + (i // 7) * 0.22),
                (0.14, 0.10, 0.16),
                c,
                _product_mat(mats, i + 1),
            )
        )
    window_sku.append(box("WindowLowShelf", (ox - 0.55, oy - sy * 0.5 + 0.30, z0 + 0.10), (1.45, 0.22, 0.06), c, mats["shelf"]))
    wg = join_named("WindowDisplay", window_sku)
    if wg:
        add_outline(wg, mats, 0.003)

    # Drink coolers along the back wall
    cooler_parts = []
    for i in range(5):
        x = ox - 1.15 + i * 0.52
        y = oy + sy * 0.5 - 0.32
        cooler_parts.append(box(f"Cooler_{i}", (x, y, z0 + 0.95), (0.48, 0.38, 1.85), c, mats["metal"]))
        cooler_parts.append(box(f"CoolerGlass_{i}", (x, y - 0.20, z0 + 0.95), (0.42, 0.02, 1.55), c, mats["glass_dark"]))
        for row in range(5):
            for col_i in range(3):
                cooler_parts.append(
                    cyl(
                        f"Bottle_{i}_{row}_{col_i}",
                        (x - 0.12 + col_i * 0.12, y - 0.05, z0 + 0.28 + row * 0.30),
                        0.035,
                        0.16,
                        c,
                        _product_mat(mats, i + row + col_i),
                    )
                )
    coolers = join_named("DrinkCoolers", cooler_parts)
    if coolers:
        add_outline(coolers, mats, 0.005)

    # Onigiri / snack low fridge along left glass, inside
    snack_parts = []
    snack_parts.append(box("SnackCase", (ox - sx * 0.5 + 0.42, oy + 0.20, z0 + 0.42), (0.42, 1.85, 0.82), c, mats["metal"]))
    snack_parts.append(box("SnackGlass", (ox - sx * 0.5 + 0.62, oy + 0.20, z0 + 0.50), (0.02, 1.75, 0.55), c, mats["glass"]))
    for i in range(18):
        snack_parts.append(
            box(
                f"Onigiri_{i}",
                (ox - sx * 0.5 + 0.42, oy - 0.55 + (i % 9) * 0.18, z0 + 0.22 + (i // 9) * 0.28),
                (0.12, 0.10, 0.09),
                c,
                mats["plastic_white"] if i % 3 else mats["plastic_green"],
            )
        )
    snacks = join_named("SnackCaseGroup", snack_parts)
    if snacks:
        add_outline(snacks, mats, 0.004)

    # Bento warmer near register
    bento = []
    bento.append(box("BentoCase", (ox + 1.05, oy - 0.15, z0 + 0.55), (0.62, 0.72, 1.05), c, mats["metal"]))
    bento.append(box("BentoLight", (ox + 1.05, oy - 0.15, z0 + 1.02), (0.56, 0.66, 0.04), c, mats["neon_warm"]))
    for i in range(8):
        bento.append(
            box(
                f"Bento_{i}",
                (ox + 0.88 + (i % 2) * 0.28, oy - 0.38 + (i // 2) * 0.18, z0 + 0.38),
                (0.22, 0.14, 0.08),
                c,
                mats["plastic_orange"] if i % 2 else mats["plastic_yellow"],
            )
        )
    bento_g = join_named("BentoGroup", bento)
    if bento_g:
        add_outline(bento_g, mats, 0.004)

    # Ice cream freezer near front left
    ice = box("IceFreezer", (ox - 1.05, oy - sy * 0.5 + 0.42, z0 + 0.42), (0.85, 0.55, 0.82), c, mats["metal"])
    add_outline(ice, mats, 0.005)
    box("IceLid", (ox - 1.05, oy - sy * 0.5 + 0.55, z0 + 0.84), (0.80, 0.50, 0.03), c, mats["glass"])
    box("IceDecal", (ox - 1.05, oy - sy * 0.5 + 0.28, z0 + 0.50), (0.70, 0.02, 0.28), c, mats["poster_b"])

    # Magazine rack by the door
    mag = []
    mag.append(box("MagRack", (ox - 1.20, oy - sy * 0.5 + 0.42, z0 + 0.55), (0.38, 0.22, 1.05), c, mats["wood"]))
    for i in range(6):
        mag.append(
            box(
                f"Mag_{i}",
                (ox - 1.20, oy - sy * 0.5 + 0.32, z0 + 0.18 + i * 0.16),
                (0.32, 0.02, 0.14),
                c,
                _product_mat(mats, i + 2),
            )
        )
    mag_g = join_named("MagazineGroup", mag)
    if mag_g:
        add_outline(mag_g, mats, 0.004)

    # Register counter on the right of the entrance
    counter = box("Counter", (ox + 1.18, oy - sy * 0.5 + 0.72, z0 + 0.48), (0.85, 1.15, 0.92), c, mats["counter"])
    add_outline(counter, mats, 0.006)
    box("CounterTop", (ox + 1.18, oy - sy * 0.5 + 0.72, z0 + 0.96), (0.90, 1.20, 0.04), c, mats["plastic_white"])
    reg = box("Register", (ox + 1.18, oy - sy * 0.5 + 0.55, z0 + 1.12), (0.32, 0.28, 0.22), c, mats["plastic_white"])
    add_outline(reg, mats, 0.003)
    box("RegScreen", (ox + 1.18, oy - sy * 0.5 + 0.42, z0 + 1.28), (0.26, 0.02, 0.18), c, mats["vending_glass"])
    # Coffee machine
    coffee = box("CoffeeMachine", (ox + 1.35, oy - sy * 0.5 + 1.05, z0 + 1.22), (0.28, 0.26, 0.42), c, mats["metal_dark"])
    add_outline(coffee, mats, 0.003)
    box("CoffeeHead", (ox + 1.35, oy - sy * 0.5 + 0.95, z0 + 1.18), (0.08, 0.10, 0.08), c, mats["metal"])
    # Oden counter
    oden = box("OdenCounter", (ox + 0.55, oy - sy * 0.5 + 0.62, z0 + 0.52), (0.55, 0.48, 0.95), c, mats["metal"])
    add_outline(oden, mats, 0.004)
    box("OdenPot", (ox + 0.55, oy - sy * 0.5 + 0.62, z0 + 1.02), (0.48, 0.40, 0.12), c, mats["plastic_orange"])
    box("OdenSteam", (ox + 0.55, oy - sy * 0.5 + 0.62, z0 + 1.10), (0.42, 0.34, 0.03), c, mats["neon_warm"])
    text_obj("OdenLabel", "おでん", (ox + 0.55, oy - sy * 0.5 + 0.36, z0 + 0.72), 0.08, c, mats["plastic_white"], font, 0.004, rot=(math.radians(90), 0, 0))

    # Interior posters
    box("InPoster1", (ox + sx * 0.5 - 0.14, oy - 0.15, z0 + 1.55), (0.02, 0.42, 0.58), c, mats["poster_a"])
    box("InPoster2", (ox + sx * 0.5 - 0.14, oy + 0.40, z0 + 1.55), (0.02, 0.42, 0.58), c, mats["poster_c"])
    box("InLightBox", (ox + 0.15, oy + sy * 0.5 - 0.14, z0 + 2.05), (1.15, 0.04, 0.32), c, mats["sign_white"])
    text_obj("InLightTxt", "HOT SNACK", (ox + 0.15, oy + sy * 0.5 - 0.18, z0 + 2.05), 0.10, c, mats["plastic_red"], font, 0.004, rot=(math.radians(90), 0, 0))

    # Floor guides
    add_outline(box("GuideArrow", (ox - 0.10, oy - sy * 0.5 + 0.85, z0 + 0.01), (0.18, 0.42, 0.01), c, mats["guide"]), mats, 0.002)
    add_outline(box("GuideLine", (ox + 0.85, oy - 0.05, z0 + 0.01), (0.08, 1.15, 0.01), c, mats["guide"]), mats, 0.002)

    # Lockers / back room door
    door = box("BackDoor", (ox + sx * 0.5 - 0.14, oy + 0.95, z0 + 1.05), (0.06, 0.78, 2.05), c, mats["wall_navy"])
    add_outline(door, mats, 0.005)
    box("DoorWindow", (ox + sx * 0.5 - 0.18, oy + 0.95, z0 + 1.55), (0.02, 0.22, 0.35), c, mats["glass_dark"])
    lockers = box("Lockers", (ox + sx * 0.5 - 0.32, oy + 0.15, z0 + 0.85), (0.28, 0.62, 1.65), c, mats["metal"])
    add_outline(lockers, mats, 0.004)
    for i in range(6):
        box(f"LockerDoor_{i}", (ox + sx * 0.5 - 0.47, oy - 0.05 + (i % 2) * 0.28, z0 + 0.28 + (i // 2) * 0.50), (0.02, 0.24, 0.42), c, mats["metal_dark"])

    # Extra snack endcap near coolers
    endcap = []
    endcap.append(box("Endcap", (ox + 1.15, oy + 0.85, z0 + 0.70), (0.38, 0.38, 1.35), c, mats["shelf"]))
    for i in range(12):
        endcap.append(
            box(
                f"EndSku_{i}",
                (ox + 1.15, oy + 0.85, z0 + 0.18 + (i % 4) * 0.28),
                (0.12 + (i % 3) * 0.04, 0.10, 0.14),
                c,
                _product_mat(mats, i),
            )
        )
    eg = join_named("EndcapGroup", endcap)
    if eg:
        add_outline(eg, mats, 0.003)


def build_props(mats, c, font, store):
    ox, oy, oz = store["origin"]
    sx, sy, sz = store["size"]
    door_x, door_y = store["door_x"], store["door_y"]

    # Vending machines
    def vending(name, loc, accent):
        body = box(f"{name}_body", loc, (0.72, 0.62, 1.85), c, mats["metal_dark"])
        add_outline(body, mats, 0.006)
        box(f"{name}_glass", (loc[0], loc[1] - 0.30, loc[2] + 0.12), (0.58, 0.03, 1.05), c, mats["vending_glass"])
        box(f"{name}_band", (loc[0], loc[1] - 0.32, loc[2] + 0.82), (0.62, 0.02, 0.10), c, accent)
        box(f"{name}_logo", (loc[0], loc[1] - 0.32, loc[2] + 0.78), (0.28, 0.02, 0.16), c, mats["sign_white"])
        box(f"{name}_btn", (loc[0] + 0.18, loc[1] - 0.32, loc[2] - 0.45), (0.18, 0.02, 0.28), c, mats["plastic_white"])
        box(f"{name}_slot", (loc[0] - 0.10, loc[1] - 0.32, loc[2] - 0.72), (0.32, 0.04, 0.10), c, mats["black"])
        for r in range(4):
            for k in range(3):
                box(
                    f"{name}_can_{r}_{k}",
                    (loc[0] - 0.16 + k * 0.16, loc[1] - 0.18, loc[2] + 0.45 - r * 0.22),
                    (0.08, 0.08, 0.12),
                    c,
                    _product_mat(mats, r * 3 + k),
                )

    vending("VendA", (ox - sx * 0.5 - 0.58, oy + 0.55, oz + 0.98), mats["plastic_red"])
    vending("VendB", (ox - sx * 0.5 - 0.58, oy + 1.25, oz + 0.98), mats["plastic_blue"])

    # Bicycle on the front sidewalk, readable from the 3/4 view
    bike_loc = Vector((ox - 1.55, oy - sy * 0.5 - 0.55, oz + 0.08))
    bike_parts = []
    bike_parts.append(torus("BikeWheelF", (bike_loc.x + 0.32, bike_loc.y, bike_loc.z + 0.22), 0.17, 0.018, c, mats["tire"], rot=(math.radians(90), 0, 0)))
    bike_parts.append(torus("BikeWheelR", (bike_loc.x - 0.32, bike_loc.y, bike_loc.z + 0.22), 0.17, 0.018, c, mats["tire"], rot=(math.radians(90), 0, 0)))
    bike_parts.append(cyl("BikeFrameA", (bike_loc.x, bike_loc.y, bike_loc.z + 0.36), 0.022, 0.62, c, mats["plastic_green"], rot=(0, math.radians(90), 0)))
    bike_parts.append(cyl("BikeFrameB", (bike_loc.x + 0.08, bike_loc.y, bike_loc.z + 0.48), 0.020, 0.36, c, mats["plastic_green"], rot=(0, math.radians(55), 0)))
    bike_parts.append(cyl("BikeSteer", (bike_loc.x + 0.32, bike_loc.y, bike_loc.z + 0.52), 0.018, 0.36, c, mats["metal"]))
    bike_parts.append(cyl("BikeBar", (bike_loc.x + 0.32, bike_loc.y, bike_loc.z + 0.70), 0.016, 0.28, c, mats["metal"], rot=(math.radians(90), 0, 0)))
    bike_parts.append(box("BikeSeat", (bike_loc.x - 0.18, bike_loc.y, bike_loc.z + 0.60), (0.16, 0.07, 0.04), c, mats["black"]))
    bike_parts.append(box("BikeBasket", (bike_loc.x + 0.44, bike_loc.y, bike_loc.z + 0.52), (0.18, 0.16, 0.12), c, mats["metal"]))
    bike = join_named("Bicycle", bike_parts)
    if bike:
        add_outline(bike, mats, 0.004)
        shade_smooth(bike)

    # Umbrella stand
    stand = cyl("UmbrellaStand", (door_x + 0.85, door_y - 0.18, oz + 0.22), 0.16, 0.28, c, mats["metal_dark"])
    add_outline(stand, mats, 0.003)
    for i, (mat_key, ang) in enumerate((("umbrella_a", 0.2), ("umbrella_b", 1.2), ("umbrella_c", 2.3), ("umbrella_a", 3.5))):
        x = door_x + 0.85 + math.cos(ang) * 0.07
        y = door_y - 0.18 + math.sin(ang) * 0.07
        u = cyl(f"Umbrella_{i}", (x, y, oz + 0.55), 0.018, 0.85, c, mats[mat_key], rot=(math.radians(8), 0, ang))
        add_outline(u, mats, 0.002)
        cone(f"UmbrellaCap_{i}", (x, y, oz + 0.98), 0.05, 0.01, 0.06, c, mats[mat_key])

    # Trash bins
    for i, (off, key) in enumerate(((-0.22, "plastic_white"), (0.18, "plastic_yellow"))):
        b = box(f"Trash_{i}", (ox - sx * 0.5 - 0.95, oy - sy * 0.5 + 1.45 + off, oz + 0.38), (0.32, 0.28, 0.62), c, mats[key])
        add_outline(b, mats, 0.004)
        box(f"TrashLid_{i}", (ox - sx * 0.5 - 0.95, oy - sy * 0.5 + 1.45 + off, oz + 0.72), (0.34, 0.30, 0.05), c, mats["metal_dark"])

    # Street lamp
    lamp_x, lamp_y = -2.15, -2.05
    post = cyl("LampPost", (lamp_x, lamp_y, oz + 1.55), 0.055, 3.05, c, mats["metal_dark"])
    add_outline(post, mats, 0.006)
    arm = cyl("LampArm", (lamp_x + 0.35, lamp_y, oz + 3.05), 0.035, 0.75, c, mats["metal_dark"], rot=(0, math.radians(90), 0))
    add_outline(arm, mats, 0.004)
    shade = cone("LampShade", (lamp_x + 0.68, lamp_y, oz + 2.92), 0.18, 0.08, 0.16, c, mats["metal"])
    add_outline(shade, mats, 0.004)
    glow = ico("LampBulb", (lamp_x + 0.68, lamp_y, oz + 2.82), 0.09, c, mats["lamp_glow"])

    # Utility pole + transformer + wires
    pole_x, pole_y = -3.15, 1.85
    upole = cyl("UtilityPole", (pole_x, pole_y, oz + 2.35), 0.09, 4.55, c, mats["concrete"])
    add_outline(upole, mats, 0.008)
    box("Transformer", (pole_x + 0.18, pole_y, oz + 3.55), (0.32, 0.22, 0.28), c, mats["metal_dark"])
    cross = box("CrossArm", (pole_x, pole_y, oz + 4.25), (1.15, 0.08, 0.08), c, mats["wood"])
    add_outline(cross, mats, 0.004)
    # Wires sagging toward store and off-board
    roof_attach = (ox - 0.2, oy + sy * 0.2, oz + sz + 0.22)
    curve_wire(
        "Wire1",
        [
            (pole_x - 0.4, pole_y, oz + 4.28),
            (pole_x + 0.6, pole_y - 0.4, oz + 3.85),
            (ox - 1.0, oy + 0.8, oz + 3.55),
            roof_attach,
        ],
        c,
        mats["black"],
        0.012,
    )
    curve_wire(
        "Wire2",
        [
            (pole_x + 0.4, pole_y, oz + 4.22),
            (-1.2, 2.4, oz + 3.70),
            (1.2, 3.2, oz + 3.55),
            (3.6, 3.6, oz + 3.85),
        ],
        c,
        mats["black"],
        0.011,
    )
    curve_wire(
        "Wire3",
        [
            (pole_x, pole_y + 0.05, oz + 4.35),
            (-3.6, 3.2, oz + 3.95),
            (-3.8, 3.7, oz + 4.15),
        ],
        c,
        mats["black"],
        0.011,
    )

    # Street signs
    signpost = cyl("SignPost", (-1.55, -1.72, oz + 1.15), 0.03, 2.15, c, mats["metal_dark"])
    add_outline(signpost, mats, 0.003)
    plate = box("StreetPlate", (-1.55, -1.72, oz + 2.15), (0.72, 0.04, 0.18), c, mats["plastic_blue"])
    add_outline(plate, mats, 0.003)
    text_obj("StreetName", "あおい通り", (-1.55, -1.75, oz + 2.15), 0.09, c, mats["sign_white"], font, 0.004, rot=(math.radians(90), 0, 0))
    stop = box("StopSign", (-1.55, -1.70, oz + 1.72), (0.28, 0.04, 0.22), c, mats["plastic_red"])
    add_outline(stop, mats, 0.003)
    text_obj("StopText", "止まれ", (-1.55, -1.73, oz + 1.72), 0.07, c, mats["sign_white"], font, 0.003, rot=(math.radians(90), 0, 0))

    # Small planter near alley
    pot = cyl("Planter", (ox + sx * 0.5 + 0.42, oy - 0.35, oz + 0.18), 0.16, 0.22, c, mats["terracotta"] if "terracotta" in mats else mats["wood"])
    add_outline(pot, mats, 0.003)
    cone("Shrub", (ox + sx * 0.5 + 0.42, oy - 0.35, oz + 0.42), 0.18, 0.04, 0.32, c, mats["plant"])


def build_lights(store):
    ox, oy, oz = store["origin"]
    sx, sy, sz = store["size"]

    def area(name, loc, size, color, energy, rot=(0, 0, 0)):
        data = bpy.data.lights.new(name, "AREA")
        data.shape = "RECTANGLE"
        data.size = size[0]
        data.size_y = size[1]
        data.color = color
        data.energy = energy
        obj = bpy.data.objects.new(name, data)
        obj.location = loc
        obj.rotation_euler = rot
        bpy.context.scene.collection.objects.link(obj)
        return obj

    def point(name, loc, color, energy, radius=0.4):
        data = bpy.data.lights.new(name, "POINT")
        data.color = color
        data.energy = energy
        if hasattr(data, "shadow_soft_size"):
            data.shadow_soft_size = radius
        obj = bpy.data.objects.new(name, data)
        obj.location = loc
        bpy.context.scene.collection.objects.link(obj)
        return obj

    def spot(name, loc, color, energy, rot, size=0.7):
        data = bpy.data.lights.new(name, "SPOT")
        data.color = color
        data.energy = energy
        data.spot_size = size
        data.spot_blend = 0.35
        obj = bpy.data.objects.new(name, data)
        obj.location = loc
        obj.rotation_euler = rot
        bpy.context.scene.collection.objects.link(obj)
        return obj

    # Warm interior flood — this is what makes the shop glow through glass.
    area(
        "LightInteriorMain",
        (ox, oy, oz + sz - 0.28),
        (2.4, 1.8),
        (1.0, 0.86, 0.62),
        70,
        (0, 0, 0),
    )
    area(
        "LightInteriorFront",
        (ox - 0.2, oy - sy * 0.25, oz + sz - 0.32),
        (2.0, 1.0),
        (1.0, 0.88, 0.68),
        40,
        (math.radians(18), 0, 0),
    )
    point("LightRegister", (ox + 1.15, oy - sy * 0.5 + 0.7, oz + 1.55), (1.0, 0.82, 0.55), 10, 0.25)
    point("LightOden", (ox + 0.55, oy - sy * 0.5 + 0.6, oz + 1.35), (1.0, 0.65, 0.35), 8, 0.2)
    point("LightCooler", (ox, oy + sy * 0.35, oz + 1.6), (0.75, 0.9, 1.0), 8, 0.35)

    point("LightStreet", (-1.47, -2.05, oz + 2.82), (1.0, 0.68, 0.36), 16, 0.55)
    spot("LightStreetSpot", (-1.47, -2.05, oz + 2.95), (1.0, 0.70, 0.38), 28, (math.radians(72), 0, math.radians(20)), 1.1)

    point("LightSign", (ox, oy - sy * 0.5 - 0.4, oz + 3.2), (0.45, 1.0, 0.95), 7, 0.6)
    point("LightVending", (ox - sx * 0.5 - 0.55, oy - sy * 0.5 + 0.5, oz + 1.4), (0.4, 0.55, 1.0), 5, 0.35)

    area("LightSkyFill", (0, 0, 6.4), (8.0, 8.0), (0.28, 0.38, 0.58), 8)
    area("LightRim", (3.8, -4.2, 3.6), (3.0, 2.0), (0.38, 0.46, 0.68), 8, (math.radians(65), math.radians(15), 0))


def build_fx(mats, c, store):
    ox, oy, oz = store["origin"]
    sx, sy = store["size"].x, store["size"].y

    rain_mat = mat_emit("MAT_RainStreak", (0.55, 0.66, 0.78), 0.28)
    for i in range(160):
        x = RNG.uniform(-3.9, 3.9)
        y = RNG.uniform(-3.9, 3.9)
        z0 = RNG.uniform(0.6, 5.4)
        drop = box(f"Rain_{i}", (x, y, z0), (0.012, 0.012, 0.32), c, rain_mat)
        drop.rotation_euler[1] = math.radians(8)
        if hasattr(drop, "visible_shadow"):
            drop.visible_shadow = False
        fcu = drop.driver_add("location", 2)
        drv = fcu.driver
        drv.type = "SCRIPTED"
        drv.expression = f"{z0:.3f} - (frame * 0.085 + {i * 0.17:.3f}) % 5.1"

    # Eaves drips — looping falling droplets
    drip_x = [ox - 1.2, ox - 0.35, ox + 0.45, ox + 1.2, ox - sx * 0.5 - 0.55]
    drip_y = [store["awning_front_y"]] * 4 + [oy]
    drip_z = store["awning_z"]
    for i, (x, y) in enumerate(zip(drip_x, drip_y)):
        drop = ico(f"Drip_{i}", (x, y, drip_z), 0.018, c, mats["neon_cool"], subdiv=1)
        drop.scale = (0.7, 0.7, 1.4)
        start = 1 + i * 8
        for f, z, s in (
            (start, drip_z, 0.7),
            (start + 2, drip_z - 0.02, 1.0),
            (start + 18, BASE_Z + 0.08, 0.4),
            (start + 19, drip_z, 0.01),
            (start + 24, drip_z, 0.7),
        ):
            drop.location = (x, y, z)
            drop.scale = (0.7 * s, 0.7 * s, 1.4 * s)
            drop.keyframe_insert("location", frame=f)
            drop.keyframe_insert("scale", frame=f)
        act = drop.animation_data.action if drop.animation_data else None
        if act and hasattr(act, "use_cyclic"):
            act.use_cyclic = True

    # Sign / lightbox pulse
    def pulse_emission(mat, base, amp=0.55, speed=0.11):
        nt = mat.node_tree
        princ = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        emit = next((n for n in nt.nodes if n.type == "EMISSION"), None)
        sock = None
        if princ and "Emission Strength" in princ.inputs:
            sock = princ.inputs["Emission Strength"]
        elif emit:
            sock = emit.inputs["Strength"]
        if sock is None:
            return
        sock.default_value = base
        fcu = sock.driver_add("default_value")
        drv = fcu.driver
        drv.type = "SCRIPTED"
        drv.expression = f"{base} + {amp} * (0.5 + 0.5 * sin(frame * {speed})) + 0.12 * (0.5 + 0.5 * sin(frame * 0.73))"

    pulse_emission(mats["sign_teal"], 1.35, 0.18, 0.09)
    pulse_emission(mats["sign_white"], 1.15, 0.12, 0.07)
    pulse_emission(mats["sign_navy"], 1.05, 0.10, 0.08)
    pulse_emission(mats["interior_light"], 2.4, 0.12, 0.04)

    return None


def build_camera():
    cam_data = bpy.data.cameras.new("DioramaCamera")
    cam_data.lens = 42
    cam_data.clip_start = 0.05
    cam_data.clip_end = 80
    cam_data.dof.use_dof = False
    cam = bpy.data.objects.new("DioramaCamera", cam_data)
    cam.location = (-6.9, -8.4, 4.85)
    bpy.context.scene.collection.objects.link(cam)

    target = bpy.data.objects.new("CameraTarget", None)
    target.empty_display_type = "PLAIN_AXES"
    target.location = (0.15, 0.05, 0.95)
    bpy.context.scene.collection.objects.link(target)
    cns = cam.constraints.new("TRACK_TO")
    cns.target = target
    cns.track_axis = "TRACK_NEGATIVE_Z"
    cns.up_axis = "UP_Y"
    bpy.context.scene.camera = cam
    return cam


def save_and_export():
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(PUBLIC_DIR, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    print("SAVED", BLEND_PATH)

    bpy.ops.render.render(write_still=True)
    print("RENDERED", PREVIEW_PATH)

    # GLB: apply nothing destructive; export selected visible meshes/curves.
    bpy.ops.object.select_all(action="DESELECT")
    for obj in bpy.context.scene.objects:
        if obj.type in {"MESH", "CURVE", "FONT"} and not obj.hide_render and not obj.name.startswith("Rain_"):
            obj.select_set(True)
    export_kwargs = dict(filepath=GLB_PATH, export_format="GLB", use_selection=True)
    for key, val in (
        ("export_apply", True),
        ("export_texcoords", True),
        ("export_normals", True),
        ("export_cameras", False),
        ("export_lights", True),
        ("export_animations", True),
    ):
        export_kwargs[key] = val
    try:
        bpy.ops.export_scene.gltf(**export_kwargs)
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
    print("=== Building rain-night konbini diorama ===")
    reset_scene()
    scene = bpy.context.scene
    setup_render(scene)
    font = load_font()
    mats = build_materials()

    c_base = col("01_Base")
    c_street = col("02_Street")
    c_store = col("03_Store")
    c_in = col("04_Interior")
    c_props = col("05_Props")
    c_fx = col("06_FX")

    build_base(mats, c_base)
    build_street(mats, c_street)
    store = build_store_exterior(mats, c_store, font)
    build_store_interior(mats, c_in, font, store)
    build_props(mats, c_props, font, store)
    build_lights(store)
    build_fx(mats, c_fx, store)
    build_camera()

    pass

    print("Objects:", len(bpy.data.objects))
    save_and_export()
    print("=== Done ===")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        import traceback

        traceback.print_exc()
        sys.exit(1)
