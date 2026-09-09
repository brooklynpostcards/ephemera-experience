"""Read-only inventory and derivative-size estimate. Does not write images."""
from pathlib import Path
from collections import Counter
from io import BytesIO
from PIL import Image, ImageOps
import json

root = Path('D:/arm_data/archives/08_ephemera')
files = sorted(p for p in root.rglob('*') if p.is_file() and p.suffix.lower() in {'.jpg','.jpeg','.png','.webp'} and '_database' not in p.parts and not p.name.startswith('._'))
sample = files[::max(1,len(files)//48)][:48]
sizes=[]
for p in sample:
    try:
        with Image.open(p) as original:
            im=ImageOps.exif_transpose(original).convert('RGB')
            im.thumbnail((1000,1000))
            buf=BytesIO();im.save(buf,'WEBP',quality=78,method=4)
            sizes.append(len(buf.getvalue()))
    except Exception as error:
        print(json.dumps({'sample_error':str(p.relative_to(root)),'error':str(error)}))
print(json.dumps({'images':len(files),'source_bytes':sum(p.stat().st_size for p in files),'series':dict(Counter(p.relative_to(root).parts[0] for p in files)),'sample_count':len(sizes),'estimated_1000px_webp_mb':round(sum(sizes)/len(sizes)*len(files)/1e6),'sample_names':[str(p.relative_to(root)) for p in sample[:12]]},indent=2))
