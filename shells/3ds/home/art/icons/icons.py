# SPDX-License-Identifier: GPL-3.0-or-later
"""Author Pocket Home's icons in Blender and render each one orthographically.

  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
    --python shells/3ds/home/art/icons/icons.py -- --out .pocket-build/home-icons/render [--only hn,mac]

(`bun run icons` in shells/3ds runs this, nexus.ts for Pocket Nexus's
letter and the bake.)

Every icon is an iOS 6 tile: a lacquered or metal plate with a raised,
beveled object on it, lit from above so top edges catch the light and the
object casts its shadow downward. The tile spans [-1, 1] in x and y; the
camera looks straight down and frames exactly that square. The plate runs
past the frame, so the render is opaque to its edges: bake.ts applies the
rounded-square mask, the gloss, the rim and the drop shadow afterwards, the
same way for every icon.
"""

import argparse
import math
import sys
from pathlib import Path

import bpy

args = argparse.ArgumentParser()
args.add_argument("--out", type=Path, required=True)
args.add_argument("--only", default="")
args.add_argument("--samples", type=int, default=128)
options = args.parse_args(sys.argv[sys.argv.index("--") + 1:])
options.out.mkdir(parents=True, exist_ok=True)

RES = 512
VERDANA_BOLD = "/System/Library/Fonts/Supplemental/Verdana Bold.ttf"


def linear(hex_color):
    c = [int(hex_color[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c) + (1.0,)


# ---- scene ------------------------------------------------------------------------


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = options.samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x = RES
    scene.render.resolution_y = RES
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = -0.25
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for device in prefs.devices:
            device.use = True
        scene.cycles.device = "GPU"
    except Exception:
        scene.cycles.device = "CPU"

    camera = bpy.data.cameras.new("Camera")
    camera.type = "ORTHO"
    camera.ortho_scale = 2.0
    cam = bpy.data.objects.new("Camera", camera)
    cam.location = (0, 0, 10)
    scene.collection.objects.link(cam)
    scene.camera = cam

    # World: a studio dome, dark overhead so a flat plate shows its own
    # color, bright in a band toward the top of the icon so every bevel that
    # faces up catches a highlight, as under a window.
    world = bpy.data.worlds.new("Studio")
    scene.world = world
    world.use_nodes = True
    nodes = world.node_tree.nodes
    links = world.node_tree.links
    nodes.clear()
    coord = nodes.new("ShaderNodeTexCoord")
    dot = nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    dot.inputs[1].default_value = (0.0, 0.8, 0.6)
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.62
    ramp.color_ramp.elements[0].color = (0.06, 0.06, 0.065, 1)
    ramp.color_ramp.elements[1].position = 0.95
    ramp.color_ramp.elements[1].color = (1.0, 1.0, 1.0, 1)
    background = nodes.new("ShaderNodeBackground")
    background.inputs["Strength"].default_value = 0.9
    output = nodes.new("ShaderNodeOutputWorld")
    links.new(coord.outputs["Generated"], dot.inputs[0])
    links.new(dot.outputs["Value"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], background.inputs["Color"])
    links.new(background.outputs["Background"], output.inputs["Surface"])

    # Key: a softbox above and toward the top edge. Fill: a weak one below.
    area("Key softbox", (0, 4.0, 3.5), 3.0, 650)
    area("Fill", (0, -5, 4), 6.0, 120)
    return scene


def area(name, location, size, energy):
    light = bpy.data.lights.new(name, "AREA")
    light.size = size
    light.energy = energy
    obj = bpy.data.objects.new(name, light)
    obj.location = location
    direction = -obj.location.normalized()
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.collection.objects.link(obj)
    return obj


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


# ---- materials ----------------------------------------------------------------------


def principled(name, color, rough=0.3, metal=0.0, coat=0.0, coat_rough=0.08):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = linear(color) if isinstance(color, str) else color
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    p.inputs["Coat Weight"].default_value = coat
    p.inputs["Coat Roughness"].default_value = coat_rough
    return m


def gradient(name, top, bottom, rough=0.35, metal=0.0, coat=0.4, axis=1, lo=-1.0, hi=1.0):
    """A plate whose color runs from `bottom` (at lo) to `top` (at hi) along an
    object axis (y by default)."""
    m = principled(name, top, rough, metal, coat)
    nodes = m.node_tree.nodes
    links = m.node_tree.links
    coord = nodes.new("ShaderNodeTexCoord")
    sep = nodes.new("ShaderNodeSeparateXYZ")
    rng = nodes.new("ShaderNodeMapRange")
    rng.inputs["From Min"].default_value = lo
    rng.inputs["From Max"].default_value = hi
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = linear(bottom)
    ramp.color_ramp.elements[1].color = linear(top)
    links.new(coord.outputs["Object"], sep.inputs[0])
    links.new(sep.outputs[axis], rng.inputs["Value"])
    links.new(rng.outputs["Result"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], nodes["Principled BSDF"].inputs["Base Color"])
    return m


def brushed_radial(name, light, dark):
    """Concentric brushed metal: a noise read along the distance from the
    centre, so its streaks run around it."""
    m = principled(name, light, 0.32, 1.0)
    nodes = m.node_tree.nodes
    links = m.node_tree.links
    p = nodes["Principled BSDF"]
    coord = nodes.new("ShaderNodeTexCoord")
    length = nodes.new("ShaderNodeVectorMath")
    length.operation = "LENGTH"
    combine = nodes.new("ShaderNodeCombineXYZ")
    scale = nodes.new("ShaderNodeMath")
    scale.operation = "MULTIPLY"
    scale.inputs[1].default_value = 90.0
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 1.0
    noise.inputs["Detail"].default_value = 6.0
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.3
    ramp.color_ramp.elements[0].color = linear(dark)
    ramp.color_ramp.elements[1].position = 0.7
    ramp.color_ramp.elements[1].color = linear(light)
    links.new(coord.outputs["Object"], length.inputs[0])
    links.new(length.outputs["Value"], scale.inputs[0])
    links.new(scale.outputs["Value"], combine.inputs["X"])
    links.new(combine.outputs["Vector"], noise.inputs["Vector"])
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], p.inputs["Base Color"])
    return m


def emissive_gradient(name, top, bottom, strength=1.4, lo=-1.0, hi=1.0):
    # A matte coat: a glossy one reflects the studio dome and washes the
    # picture out to white.
    m = gradient(name, top, bottom, 0.4, 0.0, 0.1, lo=lo, hi=hi)
    nodes = m.node_tree.nodes
    p = nodes["Principled BSDF"]
    ramp = [n for n in nodes if n.type == "VALTORGB"][0]
    m.node_tree.links.new(ramp.outputs["Color"], p.inputs["Emission Color"])
    p.inputs["Emission Strength"].default_value = strength
    p.inputs["Base Color"].default_value = (0, 0, 0, 1)
    return m


# ---- geometry ----------------------------------------------------------------------


def finish(obj, mat, bevel=0.02, segments=4):
    obj.data.materials.append(mat)
    if bevel:
        b = obj.modifiers.new("Bevel", "BEVEL")
        b.width = bevel
        b.segments = segments
        b.limit_method = "ANGLE"
    for face in obj.data.polygons:
        face.use_smooth = True
    n = obj.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    n.keep_sharp = True
    return obj


def prism(name, outer, z, depth, mat, bevel=0.02, holes=()):
    """Extrude a polygon (with optional polygon holes) from z to z + depth."""
    import bmesh

    bm = bmesh.new()
    loops = [outer, *holes]
    for index, points in enumerate(loops):
        verts = [bm.verts.new((x, y, z)) for x, y in points]
        for a in range(len(verts)):
            bm.edges.new((verts[a], verts[(a + 1) % len(verts)]))
    bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=True, edges=bm.edges[:])
    faces = bm.faces[:]
    ext = bmesh.ops.extrude_face_region(bm, geom=faces)
    moved = [g for g in ext["geom"] if isinstance(g, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(0, 0, depth), verts=moved)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = link(bpy.data.objects.new(name, mesh))
    return finish(obj, mat, bevel)


def rounded_rect(w, h, r, x=0.0, y=0.0, steps=10, angle=0.0):
    points = []
    for cx, cy, start in [(w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)]:
        for k in range(steps + 1):
            t = math.radians(start + k * 90 / steps)
            px, py = cx + r * math.cos(t), cy + r * math.sin(t)
            points.append((x + px * math.cos(angle) - py * math.sin(angle), y + px * math.sin(angle) + py * math.cos(angle)))
    return points


def circle(r, x=0.0, y=0.0, count=96):
    return [(x + r * math.cos(i * math.tau / count), y + r * math.sin(i * math.tau / count)) for i in range(count)]


def plate(mat):
    bpy.ops.mesh.primitive_plane_add(size=3.2, location=(0, 0, 0))
    obj = bpy.context.object
    obj.name = "Plate"
    obj.data.materials.append(mat)
    return obj


def text(body, font, size, x, y, z, depth, mat, bevel=0.012):
    curve = bpy.data.curves.new("Text " + body, "FONT")
    curve.body = body
    curve.font = bpy.data.fonts.load(font)
    curve.size = size
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    curve.extrude = depth / 2
    curve.bevel_depth = bevel
    curve.bevel_resolution = 4
    obj = link(bpy.data.objects.new("Text " + body, curve))
    obj.location = (x, y, z + depth / 2 + bevel)
    obj.data.materials.append(mat)
    return obj


def gear_outline(teeth, tip, root, steps=12, land=0.42):
    """A spur gear's outline: each tooth a trapezoid with eased flanks."""
    points = []
    count = teeth * steps
    for i in range(count):
        phase = (i % steps) / steps
        # 0..land: tip, then a flank down, the root, a flank up.
        flank = (1 - land) / 4
        if phase < land:
            r = tip
        elif phase < land + flank:
            r = tip - (tip - root) * (phase - land) / flank
        elif phase < land + 3 * flank:
            r = root
        else:
            r = root + (tip - root) * (phase - land - 3 * flank) / flank
        a = i * math.tau / count + math.pi / 2
        points.append((r * math.cos(a), r * math.sin(a)))
    return points


# ---- icons -------------------------------------------------------------------------


def settings():
    # One bold gear on brushed steel: eight wide teeth, a bright hub and a
    # dark axle, at about three quarters of the tile so the plate frames it.
    # At 46 and 24 px every part is a few pixels wide.
    plate(brushed_radial("Brushed steel", "e2e5e9", "a4abb4"))
    gun = principled("Gunmetal", "565e69", 0.32, 0.85)
    steel = principled("Polished steel", "eef1f4", 0.14, 1.0)
    prism("Gear", gear_outline(8, 0.62, 0.46, land=0.46), 0.0, 0.14, gun, 0.025, holes=[list(reversed(circle(0.22)))])
    prism("Hub ring", circle(0.22), 0.0, 0.18, steel, 0.03, holes=[list(reversed(circle(0.10)))])
    prism("Axle", circle(0.10), 0.0, 0.10, principled("Axle", "24282d", 0.3, 0.9), 0.015)


def profile_x(y):
    """The face's dividing line at height y: a gentle S with a nose that
    points into the light half just above the middle."""
    nose = 0.16 * math.exp(-(((y - 0.06) / 0.13) ** 2))
    return 0.04 + 0.07 * math.sin(y * 1.7) + nose


def arc_band(cx, cy, r, thickness, start, end, steps=24):
    """A band along a circular arc (degrees), as one closed outline."""
    outer = [(cx + (r + thickness / 2) * math.cos(math.radians(start + (end - start) * k / steps)),
              cy + (r + thickness / 2) * math.sin(math.radians(start + (end - start) * k / steps))) for k in range(steps + 1)]
    inner = [(cx + (r - thickness / 2) * math.cos(math.radians(start + (end - start) * k / steps)),
              cy + (r - thickness / 2) * math.sin(math.radians(start + (end - start) * k / steps))) for k in range(steps + 1)]
    return outer + list(reversed(inner))


def mac():
    # The Mac as a friendly two-tone face, after the Finder: the tile is a
    # light blue lacquer face, the left half a deeper blue raised a little
    # above it so the profile line between them catches the light, and the
    # eyes and smile are dark enamel. Shapes are wide enough to hold at 24 px.
    plate(gradient("Light face", "c4ecff", "5fb6f2", 0.26, coat=0.7))
    steps = 64
    edge = [(profile_x(1.7 - 3.4 * k / steps), 1.7 - 3.4 * k / steps) for k in range(steps + 1)]
    left = [(-1.7, 1.7), *edge, (-1.7, -1.7)]
    prism("Dark face", left, 0.0, 0.035, gradient("Deep face", "3f8fe6", "1648b8", 0.24, coat=0.7), 0.03)
    enamel = principled("Dark enamel", "0d1a33", 0.18, 0.0, 0.8)
    for x in (-0.46, 0.5):
        prism(f"Eye {x}", rounded_rect(0.16, 0.36, 0.07, x, 0.36), 0.035, 0.03, enamel, 0.012)
    prism("Smile", arc_band(0.02, 0.05, 0.62, 0.11, 212, 328), 0.035, 0.03, enamel, 0.012)


def hn():
    plate(gradient("Orange lacquer", "ff8d2e", "f05300", 0.24, coat=0.8))
    enamel = principled("White enamel", "fbfbf8", 0.22, 0.0, 0.6)
    outer = rounded_rect(1.30, 1.30, 0.06)
    inner = list(reversed(rounded_rect(1.12, 1.12, 0.03)))
    prism("Frame", outer, 0.0, 0.07, enamel, 0.02, holes=[inner])
    text("Y", VERDANA_BOLD, 1.18, 0.0, -0.03, 0.0, 0.07, enamel, 0.014)


def wifi():
    plate(gradient("Blue lacquer", "6cb6fb", "1a5fd0", 0.26, coat=0.7))
    enamel = principled("White enamel", "fbfbf8", 0.22, 0.0, 0.6)
    cx, cy = 0.0, -0.46
    for r in (0.34, 0.60, 0.86):
        t = 0.15
        span = math.radians(46)
        outer = [(cx + r * math.cos(math.pi / 2 + a), cy + r * math.sin(math.pi / 2 + a)) for a in [span - 2 * span * i / 24 for i in range(25)]]
        inner = [(cx + (r - t) * math.cos(math.pi / 2 + a), cy + (r - t) * math.sin(math.pi / 2 + a)) for a in [-span + 2 * span * i / 24 for i in range(25)]]
        prism("Arc", outer + inner, 0.0, 0.08, enamel, 0.025)
    prism("Dot", circle(0.11, cx, cy + 0.02), 0.0, 0.08, enamel, 0.03)


def apps():
    plate(gradient("Violet lacquer", "c592f7", "6a31c3", 0.26, coat=0.7))
    enamel = principled("White enamel", "fbfbf8", 0.22, 0.0, 0.6)
    for x in (-0.33, 0.33):
        for y in (-0.33, 0.33):
            prism("Cell", rounded_rect(0.52, 0.52, 0.12, x, y), 0.0, 0.09, enamel, 0.03)


# Pocket Nexus's icon is the wordmark's own letter, drawn by nexus.ts.
def bar(cx, cy, length, width, angle):
    """A rectangle `length` x `width` centred at (cx, cy), turned by `angle`."""
    c, sn = math.cos(angle), math.sin(angle)
    return [(cx + x * c - y * sn, cy + x * sn + y * c) for x, y in
            [(-length / 2, -width / 2), (length / 2, -width / 2), (length / 2, width / 2), (-length / 2, width / 2)]]


def youtube():
    # A raised red play button with a white triangle, on white lacquer.
    plate(gradient("White lacquer", "ffffff", "dcdfe3", 0.22, coat=0.8))
    red = gradient("Red lacquer", "ff4a3d", "c8120b", 0.2, coat=0.9, lo=-0.45, hi=0.45)
    prism("Button", rounded_rect(1.34, 0.94, 0.26), 0.0, 0.12, red, 0.04)
    enamel = principled("White enamel", "fbfbf8", 0.2, 0.0, 0.6)
    prism("Play", [(-0.17, 0.25), (-0.17, -0.25), (0.27, 0.0)], 0.12, 0.04, enamel, 0.015)


def slanted(top_x, bottom_x, half_height, width):
    """A stroke from (top_x, half_height) to (bottom_x, -half_height) whose
    ends are cut flat by horizontal lines; `width` is measured across x."""
    return [
        (top_x - width / 2, half_height),
        (top_x + width / 2, half_height),
        (bottom_x + width / 2, -half_height),
        (bottom_x - width / 2, -half_height),
    ]


def x():
    # A white enamel X on gloss black: one thick stroke from top left to
    # bottom right and one thin stroke across it, both cut flat at the same
    # top and bottom lines, the way the letter is set in its logotype.
    plate(gradient("Gloss black", "3a3d42", "050506", 0.18, coat=0.9))
    enamel = principled("White enamel", "f4f5f6", 0.2, 0.0, 0.6)
    h = 0.6
    run = h / math.tan(math.radians(54))
    prism("Thick", slanted(-run, run, h, 0.3), 0.0, 0.08, enamel, 0.016)
    prism("Thin", slanted(run, -run, h, 0.11), 0.0, 0.07, enamel, 0.01)


def camera():
    # The iOS 6 composition: a brushed-aluminium camera front filling the
    # tile, a thin dark band across the top, and a large black lens barrel in
    # the centre with blue-violet glass, a bright specular highlight and a
    # softer glare below it.
    plate(gradient("Brushed aluminium", "e9ecef", "a7aeb6", 0.32, 0.6, 0.4))
    prism("Band", [(-1.7, 0.66), (1.7, 0.66), (1.7, 1.7), (-1.7, 1.7)], 0.0, 0.03, principled("Leatherette", "26282c", 0.55, 0.0, 0.2), 0.01)
    prism("Bezel", circle(0.62, 0, -0.08), 0.0, 0.06, principled("Bezel", "c8cdd3", 0.22, 1.0), 0.02, holes=[list(reversed(circle(0.55, 0, -0.08)))])
    prism("Barrel", circle(0.55, 0, -0.08), 0.0, 0.1, principled("Barrel", "121315", 0.35, 0.3, 0.6), 0.03, holes=[list(reversed(circle(0.36, 0, -0.08)))])
    prism("Glass", circle(0.36, 0, -0.08), 0.0, 0.08, gradient("Lens glass", "6b5cf0", "0b1a5a", 0.04, coat=1.0, lo=-0.44, hi=0.28), 0.015)
    prism("Glint", circle(0.1, -0.12, 0.06), 0.08, 0.004, principled("Glint", "ffffff", 0.05, 0.0, 1.0), 0.0)
    prism("Glare", circle(0.05, 0.13, -0.24), 0.08, 0.004, principled("Glare", "b9c8ff", 0.1, 0.0, 1.0), 0.0)


def rotate(px, py, angle, cx=0.0, cy=0.0):
    c, sn = math.cos(angle), math.sin(angle)
    return (cx + px * c - py * sn, cy + px * sn + py * c)


def photos():
    # A single bright flower on a sky-blue gradient, after iOS 6's Photos:
    # twelve rounded petals, yellow and orange in turn, around a brown
    # centre. (A stem reads as a stray dash at 46 px, so there is none.)
    plate(gradient("Sky lacquer", "a6e0ff", "2c7fd8", 0.26, coat=0.7))
    fx, fy = 0.0, 0.0
    yellow = principled("Petal yellow", "ffd21f", 0.35, 0.0, 0.5)
    orange = principled("Petal orange", "ffab1a", 0.35, 0.0, 0.5)
    for index in range(12):
        a = index * math.tau / 12
        px, py = fx + 0.42 * math.cos(a), fy + 0.42 * math.sin(a)
        prism(f"Petal {index}", rounded_rect(0.26, 0.44, 0.12, px, py, angle=a - math.pi / 2), 0.03 + (index % 2) * 0.01, 0.03, yellow if index % 2 == 0 else orange, 0.012)
    prism("Centre", circle(0.27, fx, fy, 64), 0.06, 0.05, principled("Centre", "6e3a14", 0.6, 0.0, 0.2), 0.02)
    prism("Seeds", circle(0.17, fx + 0.03, fy + 0.03, 48), 0.11, 0.006, principled("Seeds", "8d5221", 0.7, 0.0, 0.1), 0.0)


def discord():
    # A white rounded controller of a face with two eyes, on blurple lacquer.
    plate(gradient("Blurple lacquer", "8a93ff", "4450c8", 0.24, coat=0.8))
    enamel = principled("White enamel", "fbfbff", 0.2, 0.0, 0.6)
    face = rounded_rect(1.28, 0.84, 0.34, 0, -0.04)
    eyes = [list(reversed(circle(0.13, -0.27, 0.02, 48))), list(reversed(circle(0.13, 0.27, 0.02, 48)))]
    prism("Face", face, 0.0, 0.1, enamel, 0.035, holes=eyes)
    prism("Ear L", rounded_rect(0.3, 0.3, 0.1, -0.42, 0.33, angle=math.radians(20)), 0.0, 0.1, enamel, 0.03)
    prism("Ear R", rounded_rect(0.3, 0.3, 0.1, 0.42, 0.33, angle=math.radians(-20)), 0.0, 0.1, enamel, 0.03)


ICONS = {"settings": settings, "mac": mac, "hn": hn, "wifi": wifi, "apps": apps, "youtube": youtube, "x": x, "discord": discord, "camera": camera, "photos": photos}

only = [name for name in options.only.split(",") if name]
for name, build in ICONS.items():
    if only and name not in only:
        continue
    scene = reset()
    build()
    scene.render.filepath = str(options.out / f"{name}.png")
    bpy.ops.render.render(write_still=True)
    print(f"rendered {name} -> {scene.render.filepath}")
