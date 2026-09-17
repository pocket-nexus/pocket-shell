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

    def wire(name, points, radius, mat):
        curve = bpy.data.curves.new(name, "CURVE")
        curve.dimensions = "3D"
        curve.resolution_u = 32
        curve.bevel_depth = radius
        curve.bevel_resolution = 5
        spline = curve.splines.new("BEZIER")
        spline.bezier_points.add(len(points) - 1)
        for vertex, point in zip(spline.bezier_points, points):
            vertex.co = point
            vertex.handle_left_type = vertex.handle_right_type = "AUTO"
        obj = bpy.data.objects.new(name, curve)
        scene.collection.objects.link(obj)
        obj.data.materials.append(mat)
        return obj

    def cylinder(name, loc, radius, depth, mat, rotation=(math.pi / 2, 0, 0)):
        bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=radius, depth=depth, location=loc, rotation=rotation)
        return finish(bpy.context.object, name, mat, 0.006)

    silver = material("Satin bead-blasted aluminium", (0.58, 0.62, 0.66), 0.27, 0.92, 0.13, (1, 45, 1))
    chrome = material("Polished edge aluminium", (0.74, 0.79, 0.82), 0.17, 1)
    dark = material("Black anodized port recess", (0.008, 0.012, 0.018), 0.43, 0.3)
    rubber = material("Graphite rubber cable", (0.023, 0.028, 0.034), 0.58, grain=0.08)
    gold = material("Gold contact pads", (0.72, 0.43, 0.10), 0.25, 0.86)

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
        # Substantial, square-edged aluminium USB hub / device dock.
        box("Unibody aluminium hub", (-0.12, 0, 0.47), (2.66, 1.65, 0.66), silver, 0.115)
        box("Underside shadow gasket", (-0.12, 0, 0.19), (2.46, 1.47, 0.12), rubber, 0.065)
        box("Inset front fascia", (-0.12, -0.831, 0.47), (2.35, 0.045, 0.40), dark, 0.055)
        for x in (-0.72, 0.32):
            box("USB receptacle metal rim", (x, -0.865, 0.46), (0.73, 0.046, 0.29), chrome, 0.02)
            box("USB receptacle hollow", (x, -0.893, 0.46), (0.63, 0.015, 0.215), dark, 0.012)
            box("USB receptacle tongue", (x, -0.914, 0.445), (0.56, 0.025, 0.073), rubber, 0.005)
            for dx in (-0.18, -0.06, 0.06, 0.18):
                box("USB receptacle contact", (x + dx, -0.932, 0.475), (0.054, 0.009, 0.019), gold, 0.003)
        led = material("Muted green status glass", (0.18, 0.51, 0.25), 0.22)
        cylinder("Power indicator", (0.87, -0.861, 0.47), 0.043, 0.025, led)
        for x in (-1.14, 0.89):
            cylinder("Flush fastener", (x, -0.834, 0.73), 0.032, 0.012, chrome)
        # Cable rises behind the hub into a large recognisable USB-A connector.
        wire("Flexible USB cable", [(-0.85, 0.50, 0.75), (-1.2, 0.56, 1.32),
             (-1.02, 0.46, 1.83), (-0.32, 0.27, 1.99), (0.45, 0.11, 1.77)], 0.077, rubber)
        box("Connector rubber grip", (0.57, -0.02, 1.88), (0.74, 0.44, 0.76), rubber, 0.09)
        for z in (1.58, 1.66, 1.74):
            box("Strain-relief rib", (0.57, -0.02, z), (0.77, 0.45, 0.036), dark, 0.018)
        box("USB plug metal shell", (0.57, -0.02, 2.50), (0.68, 0.34, 0.61), chrome, 0.028)
        box("Connector mouth", (0.57, -0.02, 2.807), (0.57, 0.24, 0.008), dark, 0.008)
        box("Connector inner tongue", (0.57, 0.025, 2.81), (0.51, 0.085, 0.012), rubber, 0.005)
        for x in (0.38, 0.76):
            box("USB shell retention recess", (x, -0.194, 2.51), (0.125, 0.007, 0.16), dark, 0.005)
        # Raised, subdued USB trident on the rubber grip.
        symbol = material("Moulded connector marking", (0.12, 0.14, 0.16), 0.62)
        wire("USB mark stem", [(0.57, -0.247, 1.78), (0.57, -0.247, 2.10)], 0.013, symbol)
        wire("USB mark fork", [(0.42, -0.247, 1.98), (0.42, -0.247, 1.90), (0.57, -0.247, 1.83)], 0.013, symbol)
        wire("USB mark fork", [(0.72, -0.247, 2.01), (0.72, -0.247, 1.95), (0.57, -0.247, 1.87)], 0.013, symbol)
        cylinder("USB mark circle", (0.42, -0.247, 2.01), 0.027, 0.012, symbol)
        box("USB mark square", (0.72, -0.247, 2.04), (0.045, 0.012, 0.045), symbol, 0.003)
        target = (0, 0, 1.40)
        camera_pos = (4.2, -10.5, 5.5)
        ortho = 3.78

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
