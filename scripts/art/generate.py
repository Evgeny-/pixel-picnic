"""Keeps Z-Image Turbo loaded and renders every job of a JSONL queue (re-read after each image).
usage: python gen_batch.py <jobs.jsonl> <outdir> [width] [height] [steps]"""
import json, os, sys, time
from mflux.models.z_image.cli.z_image_turbo_generate import build_parser, ZImageTurboCommand

jobs_path, outdir = sys.argv[1], sys.argv[2]
W, H, S = (int(sys.argv[3]) if len(sys.argv) > 3 else 640), (int(sys.argv[4]) if len(sys.argv) > 4 else 640), (int(sys.argv[5]) if len(sys.argv) > 5 else 8)
sys.argv = [sys.argv[0], '--model', 'mflux-community/z-image-turbo-mflux-q4', '--base-model', 'z-image-turbo',
            '--prompt', 'x', '--steps', str(S), '--width', str(W), '--height', str(H)]
args = build_parser().parse_args()
model = ZImageTurboCommand.load(args)
log = open(os.path.join(outdir, '_gen.log'), 'a')
done = 0
while True:
    jobs = [json.loads(l) for l in open(jobs_path) if l.strip()]
    todo = [j for j in jobs if not os.path.exists(os.path.join(outdir, j['id'] + '.png'))]
    if not todo:
        break
    j = todo[0]
    t = time.time()
    try:
        img = ZImageTurboCommand.generate(model, args, j['seed'], j['prompt'])
        img.save(path=os.path.join(outdir, j['id'] + '.png'), export_json_metadata=False)
        msg = f"{time.strftime('%H:%M:%S')} {j['id']} {time.time() - t:.0f}s"
    except Exception as e:  # keep going on a bad job
        open(os.path.join(outdir, j['id'] + '.png'), 'wb').close()
        msg = f"{time.strftime('%H:%M:%S')} {j['id']} FAILED {e}"
    done += 1
    print(msg, file=log, flush=True)
print(f"{time.strftime('%H:%M:%S')} ALL DONE {done}", file=log, flush=True)
