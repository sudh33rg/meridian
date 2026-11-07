#!/usr/bin/env python3
"""Regenerate MANIFEST.json (sha256 of every non-ignored file). Run from anywhere: `make manifest`."""
import hashlib, json, os, subprocess

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(root)
paths = subprocess.run(
    ["git", "ls-files", "-co", "--exclude-standard"], capture_output=True, text=True, check=True
).stdout.split("\n")
files = {}
for p in sorted(x for x in paths if x and x != "MANIFEST.json" and os.path.isfile(x)):
    files[p] = hashlib.sha256(open(p, "rb").read()).hexdigest()
old = json.load(open("MANIFEST.json"))
old.update(files=files, file_count=len(files))
json.dump(old, open("MANIFEST.json", "w"), indent=2)
open("MANIFEST.json", "a").write("\n")
print(f"{len(files)} files")
