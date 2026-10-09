"""
CAMAC stage builder (Blender 4.x, run headless).

Builds the empty studio the cabin assembles inside:
  - a seamless curved backdrop (cyclorama) in warm stone-grey
  - a satin concrete floor
  - safety-yellow LED strips at the floor/backdrop seam
  - white vertical light fins and a soft overhead panel (reflections on the floor)
  - dark architectural columns far in the back for depth

Output:
  public/models/stage.glb         (loaded by the web scene)
  /tmp/stage_preview.png          (quick Cycles preview with --preview, optional)

Run:  blender -b -P tools/blender/build_stage.py -- <outdir>
Units: 1 Blender unit = 1 model unit. The cabin is centred at the origin, floor at z = -1.
"""
import bpy
import bmesh
import math
import sys
import os
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT_DIR = argv[0] if argv else os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "public", "models"))
PREVIEW = "--preview" in argv
FLOOR_Z = -1.0

# ---------- reset ----------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def material(name, color, roughness=0.6, metallic=0.0, emission=None, emission_strength=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    return mat


def box(name, size, location, mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = Vector(size) / 2.0 * 2.0 / 2.0
    obj.scale = Vector(size)
    bpy.ops.object.transform_apply(scale=True)
    obj.data.materials.append(mat)
    return obj


# ---------- materials ----------
M_BACKDROP = material("Backdrop_StoneGrey", (0.80, 0.78, 0.74), roughness=0.85)
M_FLOOR = material("Floor_SatinConcrete", (0.60, 0.58, 0.55), roughness=0.32)
M_YELLOW = material("LED_Safety_Yellow", (1.0, 0.72, 0.08), roughness=0.4,
                    emission=(1.0, 0.72, 0.08), emission_strength=2.2)
M_WHITE_FIN = material("Fin_White", (0.95, 0.95, 0.93), roughness=0.5,
                       emission=(1.0, 0.98, 0.92), emission_strength=1.6)
M_SOFTBOX = material("Softbox_White", (1.0, 1.0, 1.0), roughness=0.9,
                     emission=(1.0, 0.98, 0.94), emission_strength=2.4)
M_COLUMN = material("Column_Graphite", (0.16, 0.16, 0.17), roughness=0.55)

# No separate floor plane: the cyclorama below already forms the floor. A second coplanar
# plane here z-fought with it and caused the flicker in the web scene.

# ---------- cyclorama (seamless curved backdrop) ----------
# Profile in the (y, z) plane. Camera side is -y, the backdrop wall is at +y.
# Floor runs from the front (y=-10) to the back edge (y=4), then a quarter arc
# (radius R) bends it up into a wall at y = 4 + R.
R = 3.2
CY = 4.0
profile = []
for i in range(0, 15):
    profile.append((-10.0 + i * 1.0, FLOOR_Z))
for i in range(1, 17):
    phi = (math.pi / 2) * (i / 16)
    profile.append((CY + R * math.sin(phi), FLOOR_Z + R - R * math.cos(phi)))
for i in range(1, 11):
    profile.append((CY + R, FLOOR_Z + R + i * 1.0))

mesh = bpy.data.meshes.new("Cyclorama")
cyc = bpy.data.objects.new("Cyclorama", mesh)
scene.collection.objects.link(cyc)
bm = bmesh.new()
X = 40.0
xs = [-X, X]
verts = []
for (y, z) in profile:
    row = []
    for x in xs:
        row.append(bm.verts.new((x, y, z)))
    verts.append(row)
for i in range(len(verts) - 1):
    a, b = verts[i], verts[i + 1]
    bm.faces.new((a[0], a[1], b[1], b[0]))
bm.normal_update()
bm.to_mesh(mesh)
bm.free()
cyc.data.materials.append(M_BACKDROP)
mesh.update()

# ---------- yellow LED strips at the floor/backdrop seam ----------
seam_y = -6.0 + 3.2 * 0  # the arc starts at y = 6-12 = -6 region
strip = box("LED_Seam_Back", (60, 0.05, 0.04), (0, CY + 0.2, FLOOR_Z + 0.05), M_YELLOW)
strip2 = box("LED_Seam_Front", (60, 0.05, 0.03), (0, -4.2, FLOOR_Z + 0.05), M_YELLOW)

# ---------- vertical white light fins on the backdrop ----------
for i, x in enumerate([-7.0, -2.6, 2.6, 7.0]):
    box(f"Fin_{i}", (0.10, 0.10, 4.2), (x, CY + R - 0.2, FLOOR_Z + 2.1), M_WHITE_FIN)

# ---------- soft overhead panel (reflection source) ----------
panel = box("Softbox_Overhead", (9.0, 1.4, 0.06), (0.0, -1.0, 5.2), M_SOFTBOX)
panel.rotation_euler = (math.radians(12), 0, 0)

# ---------- architectural columns far back (depth layers) ----------
for i, (x, y) in enumerate([(-13.0, 1.0), (-13.0, 6.0), (13.0, 1.0), (13.0, 6.5)]):
    box(f"Column_{i}", (1.6, 1.6, 9.0), (x, y, FLOOR_Z + 4.5), M_COLUMN)

# ---------- scan field: a wall of small white tiles on the backdrop (reference-style grid) ----------
# Tiles form a soft grid; the scan beam in the web scene sweeps across them.
M_TILE = material("Scan_Tile_White", (0.97, 0.97, 0.95), roughness=0.5,
                  emission=(1.0, 0.98, 0.92), emission_strength=0.5)
tile_mesh = bpy.data.meshes.new("ScanTileMesh")
tile_bm = bmesh.new()
bmesh.ops.create_cube(tile_bm, size=1.0)
tile_bm.to_mesh(tile_mesh)
tile_bm.free()
tile_mesh.materials.append(M_TILE)
tiles_root = bpy.data.objects.new("ScanField", None)
scene.collection.objects.link(tiles_root)
n = 0
for ix in range(-9, 10):
    for iz in range(0, 9):
        x = ix * 0.55
        z = FLOOR_Z + 0.9 + iz * 0.55
        # fade the field out toward the edges by skipping some tiles
        if abs(ix) > 6 and (iz % 2 == 0):
            continue
        t = bpy.data.objects.new(f"ScanTile_{n:03d}", tile_mesh)
        t.location = (x, CY + R - 0.05, z)
        t.scale = (0.16, 0.02, 0.16)
        t.parent = tiles_root
        scene.collection.objects.link(t)
        n += 1

# ---------- yellow ring on the floor (the platform the lift sits on) ----------
bpy.ops.mesh.primitive_torus_add(major_radius=1.9, minor_radius=0.018,
                                 location=(0, 0, FLOOR_Z + 0.004))
ring = bpy.context.active_object
ring.name = "Floor_Ring_Yellow"
ring.data.materials.append(M_YELLOW)

# ---------- floating grey slabs for depth ----------
M_SLAB = material("Slab_Grey", (0.55, 0.55, 0.53), roughness=0.7)
for i, (x, y, z, sx, sz) in enumerate([
    (-4.8, 1.6, 2.8, 1.8, 0.12), (5.2, 2.4, 3.6, 2.4, 0.12), (-6.0, -1.5, 0.6, 1.2, 0.12),
    (4.4, -2.2, 1.2, 1.0, 0.12),
]):
    box(f"Slab_{i}", (sx, 0.12, sz), (x, y, FLOOR_Z + z), M_SLAB)

# ---------- export GLB ----------
bpy.ops.object.select_all(action="DESELECT")
for obj in bpy.data.objects:
    if obj.type == "MESH":
        obj.select_set(True)
os.makedirs(OUT_DIR, exist_ok=True)
out = os.path.join(OUT_DIR, "stage.glb")
bpy.ops.export_scene.gltf(
    filepath=out,
    export_format="GLB",
    use_selection=True,
    export_yup=True,
    export_apply=True,
)
print("EXPORTED", out, os.path.getsize(out))

# ---------- optional preview (Cycles, CPU, low samples) ----------
if PREVIEW:
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 48
    scene.cycles.use_denoising = False  # OpenImageDenoise is not built into this Blender
    scene.render.resolution_x = 540
    scene.render.resolution_y = 720
    scene.world = bpy.data.worlds.new("World")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.05, 0.05, 0.05, 1)
    cam = bpy.data.cameras.new("Cam")
    cam.lens = 38
    cam_obj = bpy.data.objects.new("Cam", cam)
    scene.collection.objects.link(cam_obj)
    cam_obj.location = (4.6, -9.5, 1.2)
    target = Vector((0, 0, 0))
    direction = target - cam_obj.location
    cam_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam_obj
    scene.render.filepath = "/tmp/stage_preview.png"
    bpy.ops.render.render(write_still=True)
    print("PREVIEW", scene.render.filepath)
