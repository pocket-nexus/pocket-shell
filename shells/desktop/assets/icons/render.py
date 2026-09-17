# SPDX-License-Identifier: GPL-3.0-only
"""Model, light and bake the Files / Devices icons in Blender (no image textures).

python3 shells/desktop/assets/icons/render.py --publish
Requires Blender 5.1 and Pillow; ordinary product builds use the reviewed PNGs.
Editable .blend scenes and full-size renders go to ignored validation storage.
"""
import argparse
import math
import os
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]


def arguments():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", choices=["files", "devices"])
    parser.add_argument("--out", type=Path, default=ROOT / ".pocket-build/validation/blender-icons")
    parser.add_argument("--resolution", type=int, default=1024)
    parser.add_argument("--samples", type=int, default=128)
    parser.add_argument("--publish", action="store_true")
    return parser.parse_args(args)


def render(args):
    import bpy
    from mathutils import Vector
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = args.samples
    scene.cycles.use_denoising = True
    scene.cycles.seed = 23
    scene.cycles.use_animated_seed = False
    scene.cycles.transparent_max_bounces = 8
    prefs = bpy.context.preferences.addons["cycles"].preferences
    try:
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for device in prefs.devices:
            device.use = device.type == "METAL"
        scene.cycles.device = "GPU"
    except (TypeError, RuntimeError):
        scene.cycles.device = "CPU"
    scene.render.resolution_x = scene.render.resolution_y = args.resolution
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = 0.5
    scene.world = bpy.data.worlds.new("Neutral studio environment")
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.45, 0.50, 0.57, 1)
    scene.world.node_tree.nodes["Background"].inputs[1].default_value = 0.35

    def material(name, color, rough=0.4, metal=0, grain=0, scale=(1, 1, 1)):
        mat = bpy.data.materials.new(name)
        mat.diffuse_color = (*color, 1)
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        bsdf = nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = (*color, 1)
        bsdf.inputs["Metallic"].default_value = metal
        bsdf.inputs["Roughness"].default_value = rough
        if metal:
            bsdf.inputs["Anisotropic"].default_value = 0.5
        if grain:
            coord = nodes.new("ShaderNodeTexCoord")
            vector = nodes.new("ShaderNodeVectorMath")
            vector.operation = "MULTIPLY"
            vector.inputs[1].default_value = scale
            noise = nodes.new("ShaderNodeTexNoise")
            noise.inputs["Scale"].default_value = 135
            noise.inputs["Detail"].default_value = 2
            bump = nodes.new("ShaderNodeBump")
            bump.inputs["Strength"].default_value = grain
            bump.inputs["Distance"].default_value = 0.015
            links.new(coord.outputs["Generated"], vector.inputs[0])
            links.new(vector.outputs[0], noise.inputs["Vector"])
            links.new(noise.outputs["Fac"], bump.inputs["Height"])
            links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
        return mat

    def finish(obj, name, mat, bevel=0.02):
        obj.name = name
        obj.data.materials.append(mat)
        if bevel:
            modifier = obj.modifiers.new("Machined / folded edge", "BEVEL")
            modifier.width = bevel
            modifier.segments = 5
            modifier = obj.modifiers.new("Weighted corner normals", "WEIGHTED_NORMAL")
            modifier.keep_sharp = True
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
        return obj

    def box(name, loc, size, mat, bevel=0.02, rotation=(0, 0, 0)):
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
        obj = bpy.context.object
        obj.dimensions = size
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        obj.rotation_euler = rotation
        return finish(obj, name, mat, bevel)

    def panel(name, outline, front, back, mat, bevel=0.018):
        # A real extruded sheet; outlines are x/z coordinates, not flat artwork.
        vertices = [(x, y, z) for y in (front, back) for x, z in outline]
        n = len(outline)
        faces = [tuple(reversed(range(n))), tuple(range(n, n * 2))]
        faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(vertices, [], faces)
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        scene.collection.objects.link(obj)
        return finish(obj, name, mat, bevel)

    def cylinder(name, loc, radius, depth, mat, rotation=(math.pi / 2, 0, 0)):
        bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=radius, depth=depth, location=loc, rotation=rotation)
        return finish(bpy.context.object, name, mat, 0.006)

    silver = material("Satin bead-blasted aluminium", (0.58, 0.62, 0.66), 0.27, 0.92, 0.13, (1, 45, 1))

    if args.only == "files":
        card = material("Dyed blue cotton card", (0.035, 0.19, 0.36), 0.76, grain=0.12)
        edge = material("Blue compressed fold edges", (0.032, 0.15, 0.28), 0.65, grain=0.12)
        inside = material("Lighter folder lining", (0.10, 0.30, 0.51), 0.78, grain=0.12)
        paper = material("Warm archival paper", (0.85, 0.83, 0.77), 0.9, grain=0.20)
        ink = material("Slate printed ink", (0.24, 0.29, 0.32), 0.92)
        panel("Tabbed back cover", [(-1.42, 0.20), (1.42, 0.20), (1.42, 2.32),
              (-0.35, 2.32), (-0.48, 2.63), (-1.32, 2.63), (-1.42, 2.52)], 0.16, 0.22, card)
        panel("Inside lining", [(-1.37, 0.26), (1.37, 0.26), (1.37, 2.27), (-1.37, 2.27)], 0.135, 0.16, inside, 0.008)
        for i in range(5):
            box(f"Paper sheet {i + 1}", (-0.05 + i * 0.018, 0.07 - i * 0.051, 1.42 + i * 0.018),
                (2.35, 0.026, 2.08), paper, 0.012,
                (math.radians(-4 - i), math.radians(-2 + i * 0.9), 0))
        # A few very faint printed lines visible above the front flap.
        for i in range(3):
            box(f"Document line {i + 1}", (-0.13, -0.294, 2.28 - i * 0.105), (1.64 - i * 0.13, 0.003, 0.012), ink, 0.002)
        panel("Folded front cover", [(-1.42, 0.20), (1.42, 0.20), (1.48, 1.98),
              (1.40, 2.05), (-1.40, 2.05), (-1.48, 1.98)], -0.43, -0.36, card)
        # Rolled lip and folded seams carry real highlight / contact shadows.
        box("Top folded paper lip", (0, -0.453, 2.027), (2.79, 0.035, 0.038), inside, 0.013)
        box("Bottom crease", (0, -0.471, 0.27), (2.72, 0.009, 0.015), edge, 0.004)
        for x in (-1.38, 1.38):
            box("Side fold", (x, -0.466, 1.1), (0.018, 0.008, 1.57), edge, 0.004)
        # A small inset label holder, rather than a glossy software badge.
        box("Brushed label frame", (0.66, -0.494, 0.65), (0.70, 0.045, 0.30), silver, 0.026)
        box("Label inset shadow", (0.66, -0.524, 0.65), (0.60, 0.008, 0.21), edge, 0.012)
        box("Ivory label insert", (0.66, -0.531, 0.65), (0.55, 0.007, 0.16), paper, 0.009)
        target = (0, 0, 1.35)
        camera_pos = (4.0, -10.5, 4.7)
        ortho = 3.75
    else:
        # Two overlapping device silhouettes read at small sizes: a landscape
        # handheld in front and a taller touch player behind it, both cordless.
        chrome = material("Polished aluminium rim", (0.74, 0.79, 0.82), 0.20, 1)
        graphite = material("Satin graphite casing", (0.026, 0.033, 0.043), 0.36, 0.38, 0.06)
        glass = material("Smoked black glass bezel", (0.006, 0.010, 0.018), 0.19, 0.20)
        controls = material("Dark machined controls", (0.055, 0.067, 0.080), 0.32, 0.40)
        marks = material("Ivory control markings", (0.69, 0.72, 0.72), 0.52)

        def screen(name, low, high):
            mat = material(name, low, 0.24, 0.20)
            nodes, links = mat.node_tree.nodes, mat.node_tree.links
            coord = nodes.new("ShaderNodeTexCoord")
            separate = nodes.new("ShaderNodeSeparateXYZ")
            ramp = nodes.new("ShaderNodeValToRGB")
            ramp.color_ramp.elements[0].color = (*low, 1)
            ramp.color_ramp.elements[1].color = (*high, 1)
            links.new(coord.outputs["Generated"], separate.inputs[0])
            links.new(separate.outputs["Z"], ramp.inputs[0])
            bsdf = nodes.get("Principled BSDF")
            links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
            links.new(ramp.outputs["Color"], bsdf.inputs["Emission Color"])
            bsdf.inputs["Emission Strength"].default_value = 0.18
            return mat

        blue = screen("Blue-grey handheld display", (0.023, 0.068, 0.11), (0.16, 0.36, 0.48))
        teal = screen("Slate teal touch display", (0.016, 0.060, 0.073), (0.12, 0.30, 0.32))

        # The touch player has a thin metal edge, continuous glass and a round
        # home key. Its exposed height separates it from the foreground device.
        box("Touch player aluminium back", (0.68, 0.22, 1.54), (1.29, 0.25, 2.88), silver, 0.12)
        box("Touch player polished rim", (0.68, 0.074, 1.54), (1.26, 0.08, 2.85), chrome, 0.105)
        box("Touch player black glass", (0.68, 0.023, 1.54), (1.19, 0.045, 2.77), glass, 0.095)
        box("Touch player display", (0.68, -0.005, 1.58), (1.03, 0.016, 2.04), teal, 0.025)
        cylinder("Touch player home key rim", (0.68, -0.009, 0.36), 0.10, 0.015, graphite)
        cylinder("Touch player home key", (0.68, -0.020, 0.36), 0.079, 0.012, glass)
        cylinder("Front camera ring", (0.68, -0.010, 2.77), 0.031, 0.012, graphite)
        cylinder("Front camera glass", (0.68, -0.018, 2.77), 0.017, 0.012, blue)
        box("Touch player sleep key", (1.01, 0.22, 2.992), (0.22, 0.11, 0.035), chrome, 0.014)

        # The handheld's broad screen, d-pad and four face buttons carry its
        # identity without text or fine cables disappearing during downsampling.
        box("Handheld aluminium body", (-0.18, -0.36, 0.83), (2.95, 0.37, 1.49), silver, 0.175)
        box("Handheld polished bezel", (-0.18, -0.56, 0.83), (2.91, 0.08, 1.45), chrome, 0.16)
        box("Handheld graphite face", (-0.18, -0.611, 0.83), (2.83, 0.046, 1.37), graphite, 0.15)
        box("Handheld black glass surround", (-0.18, -0.647, 0.89), (1.86, 0.030, 1.08), glass, 0.04)
        box("Handheld display", (-0.18, -0.667, 0.91), (1.69, 0.018, 0.92), blue, 0.025)
        for x in (-1.26, 0.90):
            box("Handheld shoulder key", (x, -0.35, 1.574), (0.44, 0.27, 0.10), chrome, 0.045)
        x, z = -1.31, 1.01
        cross = [(-0.065, -0.21), (0.065, -0.21), (0.065, -0.065), (0.21, -0.065),
                 (0.21, 0.065), (0.065, 0.065), (0.065, 0.21), (-0.065, 0.21),
                 (-0.065, 0.065), (-0.21, 0.065), (-0.21, -0.065), (-0.065, -0.065)]
        panel("Directional cross", [(x + dx, z + dz) for dx, dz in cross], -0.708, -0.642, controls, 0.014)
        cylinder("Analogue stick metal seat", (-1.28, -0.654, 0.50), 0.137, 0.025, chrome)
        cylinder("Analogue stick cap", (-1.28, -0.688, 0.50), 0.104, 0.040, controls)
        for dx, dz in ((0, 0.19), (0.19, 0), (0, -0.19), (-0.19, 0)):
            cylinder("Round action key", (0.97 + dx, -0.677, 1.00 + dz), 0.081, 0.063, controls)
            cylinder("Action key inset", (0.97 + dx, -0.712, 1.00 + dz), 0.023, 0.008, marks)
        for x in (-0.39, 0.05):
            box("Small system key", (x, -0.650, 0.275), (0.14, 0.026, 0.032), chrome, 0.013)
        for x in (-0.86, 0.50):
            for i in range(3):
                box("Speaker slit", (x + i * 0.054, -0.640, 0.277), (0.017, 0.012, 0.076), glass, 0.006)
        target = (-0.02, 0, 1.53)
        camera_pos = (3.3, -12.5, 5.0)
        ortho = 3.85

    floor = material("Studio shadow catcher", (0.35, 0.35, 0.35), 0.8)
    ground = box("Contact shadow plane", (0, 0, 0.04), (200, 200, 0.04), floor, 0)
    ground.is_shadow_catcher = True

    def area(name, loc, power, color, size, size_y):
        bpy.ops.object.light_add(type="AREA", location=loc)
        light = bpy.context.object
        light.name = name
        light.data.energy = power
        light.data.color = color
        light.data.shape = "RECTANGLE"
        light.data.size = size
        light.data.size_y = size_y
        light.rotation_euler = (Vector(target) - light.location).to_track_quat("-Z", "Y").to_euler()

    area("Large warm key softbox", (-3.5, -4.5, 6.5), 520, (1, 0.94, 0.86), 4.0, 5.0)
    area("Cool vertical rim strip", (4.5, 1.2, 5.0), 660, (0.78, 0.88, 1), 2.3, 4.2)
    area("Front fill card", (-0.5, -5, 2.5), 90, (0.84, 0.91, 1), 3.0, 3.0)
    bpy.ops.object.camera_add(location=camera_pos)
    camera = bpy.context.object
    camera.name = "Orthographic icon camera"
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = ortho
    scene.camera = camera
    scene.render.filepath = str(args.out / f"{args.only}-master.png")
    scene["Source recipe"] = "shells/desktop/assets/icons/render.py"
    scene["Purpose"] = f"Pocket Shell {args.only.title()} application icon"
    scene["License"] = "GPL-3.0-only"
    bpy.ops.wm.save_as_mainfile(filepath=str(args.out / f"{args.only}.blend"))
    bpy.ops.render.render(write_still=True)


def bake(args):
    from PIL import Image, ImageChops, ImageDraw
    blender = os.environ.get("BLENDER", "/Applications/Blender.app/Contents/MacOS/Blender" if sys.platform == "darwin" else "blender")
    for name in ([args.only] if args.only else ["files", "devices"]):
        subprocess.run([blender, "--background", "--factory-startup", "--python-exit-code", "1", "--python", str(Path(__file__).resolve()), "--",
                        "--only", name, "--out", str(args.out), "--resolution", str(args.resolution), "--samples", str(args.samples)], check=True)
        master = Image.open(args.out / f"{name}-master.png").convert("RGBA")
        # Contain the studio floor shadow in the transparent outer margin. The
        # objects sit inside this 6% border; their silhouette is unchanged.
        mask = Image.new("L", master.size, 255)
        draw = ImageDraw.Draw(mask)
        feather = round(master.width * 0.06)
        for inset in range(feather):
            t = inset / feather
            value = round(255 * t * t * (3 - 2 * t))
            draw.rectangle((inset, inset, master.width - 1 - inset, master.height - 1 - inset), outline=value)
        master.putalpha(ImageChops.multiply(master.getchannel("A"), mask))
        master.save(args.out / f"{name}-icon.png")
        for size in (16, 32, 64):
            # Premultiplied alpha prevents dark fringes on translucent edge pixels.
            icon = master.convert("RGBa").resize((size, size), Image.Resampling.LANCZOS).convert("RGBA")
            icon.save((HERE if args.publish else args.out) / f"{name}-{size}.png", optimize=True)


if __name__ == "__main__":
    args = arguments()
    args.out.mkdir(parents=True, exist_ok=True)
    if "bpy" in sys.modules or "--background" in sys.argv:
        render(args)
    else:
        bake(args)
