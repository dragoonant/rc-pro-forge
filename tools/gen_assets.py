"""Generate raw SDXL images for RC Pro Forge.

Usage:  python gen_assets.py [name ...] [--seeds N] [--force]
Raw images land in tools/raw/<name>_<seed>.png; process_assets.py turns them into game sprites.
Textures are generated with circular conv padding so they tile seamlessly.
"""
import sys, os, time, argparse
import torch
from diffusers import StableDiffusionXLPipeline, AutoencoderKL
from prompts import JOBS

ROOT = r"C:\Users\antho\.cache\hy3dgen\sdxl"
RAW = os.path.join(os.path.dirname(__file__), "raw")
os.makedirs(RAW, exist_ok=True)

NEG = "blurry, text, watermark, signature, logo, frame, border, jpeg artifacts, photo, realistic, noisy, low quality"


def set_seamless(pipe, on):
    for model in (pipe.unet, pipe.vae):
        for m in model.modules():
            if isinstance(m, torch.nn.Conv2d):
                m.padding_mode = "circular" if on else "zeros"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("names", nargs="*")
    ap.add_argument("--seeds", type=int, default=None)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    names = args.names or list(JOBS)
    todo = []
    for n in names:
        job = JOBS[n]
        for s in range(args.seeds or job.get("seeds", 2)):
            path = os.path.join(RAW, f"{n}_{s}.png")
            if args.force or not os.path.exists(path):
                todo.append((n, s, path))
    if not todo:
        print("nothing to do")
        return

    vae = AutoencoderKL.from_pretrained(rf"{ROOT}\vae-fp16-fix", torch_dtype=torch.float16)
    pipe = StableDiffusionXLPipeline.from_pretrained(
        rf"{ROOT}\base", vae=vae, torch_dtype=torch.float16, variant="fp16", use_safetensors=True
    ).to("cuda")
    pipe.set_progress_bar_config(disable=True)

    for i, (n, s, path) in enumerate(todo):
        job = JOBS[n]
        tex = job["kind"] == "texture"
        set_seamless(pipe, tex)
        t = time.time()
        style = job["style"]
        img = pipe(
            f"{job['prompt']}, {style}",
            negative_prompt=f"{job.get('neg', '')}, {NEG}",
            num_inference_steps=job.get("steps", 28),
            guidance_scale=job.get("cfg", 7.0),
            width=job.get("w", 1024), height=job.get("h", 1024),
            generator=torch.Generator("cuda").manual_seed(1000 + s * 7919),
        ).images[0]
        img.save(path)
        print(f"[{i + 1}/{len(todo)}] {n}_{s} {time.time() - t:.1f}s", flush=True)


if __name__ == "__main__":
    main()
