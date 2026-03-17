import os
from PIL import Image

def process_luxury_props(input_path, output_dir):
    print(f"Processing luxury props: {input_path}")
    img = Image.open(input_path).convert("RGBA")
    
    # 1. Remove background (white -> transparent)
    datas = img.getdata()
    newData = []
    threshold = 240
    for item in datas:
        if item[0] > threshold and item[1] > threshold and item[2] > threshold:
            newData.append((255, 255, 255, 0))
        else:
            newData.append(item)
    img.putdata(newData)
    
    # 2. Slice dynamically based on connected components (bounding boxes)
    width, height = img.size
    pixels = img.load()
    
    has_pixels = [False] * width
    for x in range(width):
        for y in range(height):
            if pixels[x, y][3] > 0:
                has_pixels[x] = True
                break
                
    chunks = []
    in_chunk = False
    start_x = 0
    for x in range(width):
        if has_pixels[x] and not in_chunk:
            in_chunk = True
            start_x = x
        elif not has_pixels[x] and in_chunk:
            in_chunk = False
            if x - start_x > 20:
                chunks.append((start_x, x))
                
    if in_chunk and (width - start_x) > 20:
        chunks.append((start_x, width))
        
    prop_names = ['server_rack', 'arcade', 'monstera', 'trophy']
    
    print(f"Found {len(chunks)} prop objects!")
    
    for i, (start_x, end_x) in enumerate(chunks):
        if i >= len(prop_names):
            name = f"extra_prop_{i}"
        else:
            name = prop_names[i]
            
        min_y, max_y = height, 0
        for x in range(start_x, end_x):
            for y in range(height):
                if pixels[x, y][3] > 0:
                    min_y = min(min_y, y)
                    max_y = max(max_y, y)
                    
        pad = 5
        x0 = max(0, start_x - pad)
        y0 = max(0, min_y - pad)
        x1 = min(width, end_x + pad)
        y1 = min(height, max_y + pad)
        
        cropped = img.crop((x0, y0, x1, y1))
        out_path = os.path.join(output_dir, f"{name}.png")
        cropped.save(out_path, "PNG")
        print(f"Saved: {out_path} (size: {cropped.size})")

input_img = "/Users/alan_wang/.gemini/antigravity/brain/800943fc-9f00-4bad-9a71-41e2c452d54c/pixel_luxury_props_1771906204809.png"
out_dir = "/Users/alan_wang/project-golem/web-dashboard/public/props"
os.makedirs(out_dir, exist_ok=True)
process_luxury_props(input_img, out_dir)
