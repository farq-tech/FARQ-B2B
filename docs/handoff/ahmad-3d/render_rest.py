# Render Meshy's rigged Ahmad: Running cycle, 8 screen directions, one fixed orthographic camera, soft studio light.
# Writes PNG frames + anchors.json (feet ground point and hips per frame, in pixels).
import bpy, sys, os, math, json
from mathutils import Vector
src, out, action_name = sys.argv[-3], sys.argv[-2], sys.argv[-1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
scn = bpy.context.scene
for o in list(bpy.data.objects):
    if o.name.startswith('Icosphere'): bpy.data.objects.remove(o, do_unlink=True)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
act = bpy.data.actions.get(action_name) or bpy.data.actions['Walking']
arm.animation_data_create(); arm.animation_data.action = (None if action_name=='REST' else act)
if action_name!='REST' and hasattr(arm.animation_data, 'action_slot') and act.slots: arm.animation_data.action_slot = act.slots[0]
f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
if action_name=='REST':
    arm.animation_data.action=None
    for pb in arm.pose.bones:
        pb.location=(0,0,0); pb.rotation_quaternion=(1,0,0,0); pb.rotation_euler=(0,0,0); pb.scale=(1,1,1)

# parent everything under a pivot we can spin for the 8 directions
piv = bpy.data.objects.new('Pivot', None); scn.collection.objects.link(piv)
for o in bpy.data.objects:
    if o is not piv and o.parent is None: o.parent = piv

W, H = 260, 300
scn.render.engine = 'CYCLES'; scn.cycles.device = 'CPU'; scn.cycles.samples = 24; scn.cycles.use_denoising = True
scn.cycles.max_bounces = 3
scn.render.film_transparent = True; scn.render.resolution_x, scn.render.resolution_y = W, H
scn.render.image_settings.file_format = 'PNG'; scn.render.image_settings.color_mode = 'RGBA'
scn.view_settings.view_transform = 'Standard'
world = bpy.data.worlds.new('W'); scn.world = world; world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (0.82, 0.84, 0.86, 1); world.node_tree.nodes['Background'].inputs[1].default_value = 0.9
def sun(name, rot, energy, col=(1, 1, 1)):
    d = bpy.data.lights.new(name, 'SUN'); d.energy = energy; d.color = col; d.angle = math.radians(12)
    o = bpy.data.objects.new(name, d); scn.collection.objects.link(o); o.rotation_euler = [math.radians(a) for a in rot]
sun('key', (50, 0, -35), 3.2, (1, 0.97, 0.92))      # upper-left-front, warm
sun('rim', (60, 0, 160), 1.6, (0.9, 0.95, 1))      # back light for a clean silhouette
# fixed camera
cd = bpy.data.cameras.new('Cam'); cam = bpy.data.objects.new('Cam', cd); scn.collection.objects.link(cam); scn.camera = cam
cd.type = 'ORTHO'; cd.ortho_scale = 2.05
e = math.radians(22); d = 10; tz = 0.86
cam.location = (0, -d * math.cos(e), tz + d * math.sin(e)); cam.rotation_euler = (math.pi / 2 - e, 0, 0)
from bpy_extras.object_utils import world_to_camera_view
def px(p):
    v = world_to_camera_view(scn, cam, p); return [round(v.x * W, 2), round((1 - v.y) * H, 2)]
hips = next((b for b in arm.pose.bones if 'hip' in b.name.lower()), arm.pose.bones[0])
DIRS = [('S', 0), ('SE', 45), ('SW', 315)]
os.makedirs(out, exist_ok=True); meta = {'w': W, 'h': H, 'frames': f1 - f0, 'fps': scn.render.fps, 'dirs': {}}
for dn, yaw in DIRS:
    piv.rotation_euler = (0, 0, math.radians(yaw)); rows = []
    for f in (range(f0, f1) if action_name!='REST' else [0]):          # last frame == first frame of a loop, skip it
        scn.frame_set(f) if action_name!='REST' else bpy.context.view_layer.update()
        hp = arm.matrix_world @ hips.head
        scn.render.filepath = os.path.join(out, f'{dn}_{f - f0:02d}.png'); bpy.ops.render.render(write_still=True)
        rows.append({'hips': px(hp), 'ground': px(Vector((hp.x, hp.y, 0)))})
    meta['dirs'][dn] = rows
    print('dir', dn, flush=True)
json.dump(meta, open(os.path.join(out, 'anchors.json'), 'w'))
print('done', f0, f1)
