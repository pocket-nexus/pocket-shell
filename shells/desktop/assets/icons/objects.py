# SPDX-License-Identifier: GPL-3.0-only
"""Original desktop-place and game objects, shared by the Aqua and XP studios."""
import math

SUBJECTS = ["disk", "home", "desktop-place", "documents-place", "downloads",
            "native-apps", "pocket-apps", "document-file", "trash", "openstrike", "mines"]


def build(name, theme, box, panel, cylinder, material, finish):
    import bpy
    blue = material("Enamel blue", (0.035, 0.22, 0.50) if theme == "aqua" else (0.035, 0.19, 0.75), .35, .18)
    white = material("Ivory paper", (.88, .87, .82), .8)
    silver = material("Brushed metal", (.58, .64, .67), .31, .85, .05)
    dark = material("Dark inset", (.024, .036, .045), .40, .25)
    grey = material("Warm grey", (.44, .47, .45), .53, .28)
    gold = material("Ochre", (.66, .31, .025), .43, .30)
    green = material("Green enamel", (.045, .34, .09), .42, .18)

    def sphere(label, loc, scale, mat):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=32, location=loc)
        obj = bpy.context.object
        obj.scale = scale
        return finish(obj, label, mat, 0)

    def page(x=0, y=0, z=1.5, lines=True):
        panel("Paper with folded corner", [(x-1, z-1.35), (x+1, z-1.35), (x+1, z+.80),
              (x+.45, z+1.35), (x-1, z+1.35)], y-.06, y+.06, white)
        panel("Corner fold", [(x+.45,z+1.35),(x+.45,z+.80),(x+1,z+.80)], y-.075, y-.08, silver, .006)
        if lines:
            for i in range(5):
                box("Printed rule", (x-.10, y-.09, z+.5-i*.25), (1.2 if i<4 else .8, .012, .045), grey, .004)

    if name == "disk":
        box("Drive enclosure", (0, 0, 1.1), (2.65, 1.60, .72), silver, .14)
        box("Drive front bezel", (0, -.84, 1.08), (2.55, .13, .6), grey, .08)
        box("Drive bottom seam", (0, -.916, .86), (2.32, .02, .033), dark)
        cylinder("Green power LED", (.98, -.92, 1.12), .044, .02, green)
        box("Identification plate", (-.5, -.17, 1.466), (1.0, .67, .015), white)
        return (0, 0, 1.15), (4, -10, 7), 3.65
    if name == "home":
        box("Plaster house", (0, .1, 1.15), (2.12, 1.2, 1.90), white, .04)
        panel("Pitched roof", [(-1.40,2.05),(0,3.02),(1.40,2.05),(1.24,1.94),(0,2.75),(-1.24,1.94)], -.67, .91, gold, .024)
        box("Chimney", (.77,.4,2.57), (.32,.32,.65), silver)
        box("Blue front door", (-.35,-.53,.8), (.59,.08,1.26), blue)
        cylinder("Door knob", (-.17,-.585,.8), .035,.02,silver)
        box("Window frame", (.60,-.55,1.38), (.58,.10,.66), grey)
        box("Window glass", (.60,-.612,1.38), (.44,.015,.52), blue)
        box("Window mullion", (.60,-.626,1.38), (.035,.02,.52), white)
    elif name == "desktop-place":
        box("Display base", (0,.1,.24), (1.6,.9,.12), silver,.10)
        box("Display neck", (0,.15,.59), (.35,.25,.76), silver)
        box("Display case", (0,.05,1.88), (2.8,.33,2.0), silver,.09)
        box("Screen bezel", (0,-.145,1.98), (2.53,.07,1.58), dark,.03)
        box("Screen glass", (0,-.19,1.98), (2.38,.016,1.43), blue,.015)
        box("Screen lower horizon", (0,-.203,1.57), (2.34,.012,.31), material("Horizon",(.06,.36,.64),.4),.012)
    elif name in ("document-file", "documents-place"):
        if name == "documents-place": page(.25,.19,1.64,False)
        page(-.12,-.1,1.42)
    elif name == "downloads":
        box("Download tray", (0,.1,.56), (2.65,1.3,.28), silver,.07)
        for x in (-1.25,1.25): box("Tray side",(x,.1,.88),(.14,1.3,.57),silver)
        box("Tray front", (0,-.52,.66),(2.5,.14,.22),grey)
        panel("Down arrow", [(-.32,2.95),(.32,2.95),(.32,1.63),(.94,1.63),(0,.77),(-.94,1.63),(-.32,1.63)], -.35, -.09, green, .035)
    elif name in ("native-apps", "pocket-apps"):
        # A box of application cards; the pocket application has a small
        # inset window, while native software carries crossed drafting tools.
        box("Software box", (0,.05,1.52), (2.28,.52,2.67), blue,.09)
        box("Box spine", (-1.04,-.235,1.52),(.20,.04,2.48),silver)
        if name == "native-apps":
            box("Drafting ruler", (.18,-.31,1.55),(.20,.12,1.99),white,.015,(0,.48,0))
            box("Drafting pencil", (.18,-.44,1.55),(.19,.14,2.13),gold,.025,(0,-.48,0))
            box("Crossbar", (.19,-.5,1.38),(1.10,.10,.13),silver)
        else:
            box("Inset application window", (.10,-.31,1.6),(1.42,.09,1.62),silver,.07)
            box("Window title", (.10,-.367,2.16),(1.22,.016,.22),dark,.02)
            box("Window sheet", (.10,-.368,1.5),(1.22,.016,.99),white,.025)
            for i in range(3): box("Window row", (.02,-.382,1.75-i*.23),(.74,.012,.07),blue)
    elif name == "trash":
        # Actual wire basket; silhouette and inner rim remain readable at 16px.
        for z,r in ((.25,.75),(2.70,1.02)):
            bpy.ops.mesh.primitive_torus_add(major_radius=r,minor_radius=.065,major_segments=64,minor_segments=10,location=(0,0,z))
            finish(bpy.context.object,"Basket rim",silver,0)
        cylinder("Basket floor",(0,0,.24),.76,.08,grey,(0,0,0))
        for i in range(20):
            a=i*math.tau/20
            box("Wire upright",(.9*math.cos(a),.9*math.sin(a),1.46),(.055,.055,2.48),silver,.015)
        for z in (.58,.95,1.32,1.69,2.06,2.43):
            bpy.ops.mesh.primitive_torus_add(major_radius=.9,minor_radius=.026,major_segments=64,minor_segments=8,location=(0,0,z))
            finish(bpy.context.object,"Woven wire ring",silver,0)
    elif name == "openstrike":
        olive=material("Worn olive helmet",(.12,.18,.10) if theme=="aqua" else (.28,.37,.10),.64,.28,.13)
        sphere("Steel helmet dome",(0,.12,1.48),(1.3,.88,1.34),olive)
        box("Helmet brow",(0,-.70,1.63),(2.55,.48,.24),olive,.11)
        box("Goggle rubber surround",(0,-.83,1.34),(1.97,.27,.62),dark,.14)
        lens=material("Smoked amber lenses",(.20,.105,.019),.16,.65)
        for x in (-.48,.48): box("Protective lens",(x,-.99,1.36),(.83,.12,.43),lens,.095)
        for x in (-1.08,1.08):
            box("Chin strap",(x,-.25,.46),(.16,.14,.92),dark,.025)
            cylinder("Steel strap rivet",(x,-.76,1.70),.053,.022,silver)
        box("Chin strap buckle",(.92,-.32,.28),(.3,.15,.28),silver,.035)
    elif name == "mines":
        sphere("Cast iron mine",(0,0,1.35),(1.12,1.12,1.12),dark)
        for x,y,z in ((1.08,0,1.35),(-1.08,0,1.35),(0,-1.08,1.35),(0,0,2.43),(0,-.75,2.12)):
            sphere("Mine contact",(x,y,z),(.23,.23,.23),grey)
        cylinder("Brass fuse socket",(.58,-.06,2.35),.19,.35,gold,(0,.45,0))
        sphere("Amber fuse",(.65,-.06,2.61),(.16,.16,.16),gold)
    return (0,0,1.5), (3.6,-12,5.1), 3.65
