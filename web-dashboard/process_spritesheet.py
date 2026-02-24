import os
import sys
from PIL import Image

def process_spritesheet(input_path, output_dir):
    print(f"Processing spritesheet: {input_path}")
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
    
    # 2. Slice into a 2x2 grid and find tight bounds
    width, height = img.size
    pixels = img.load()
    
    half_w = width // 2
    half_h = height // 2
    
    # Grid coordinates: (x_start, y_start, x_end, y_end)
    quadrants = [
        (0, 0, half_w, half_h),           # Top-Left: User
        (half_w, 0, width, half_h),       # Top-Right: Brain
        (0, half_h, half_w, height),      # Bottom-Left: Memory
        (half_w, half_h, width, height)   # Bottom-Right: Action
    ]
    
    roles = ['user', 'brain', 'memory', 'action']
    
    for i, (x_start, y_start, x_end, y_end) in enumerate(quadrants):
        # Find tight bounds within this quadrant
        min_x, max_x = x_end, x_start
        min_y, max_y = y_end, y_start
        
        has_pixels = False
        for x in range(x_start, x_end):
            for y in range(y_start, y_end):
                if pixels[x, y][3] > 0:
                    has_pixels = True
                    min_x = min(min_x, x)
                    max_x = max(max_x, x)
                    min_y = min(min_y, y)
                    max_y = max(max_y, y)
                    
        if has_pixels:
            pad = 5
            x0 = max(0, min_x - pad)
            y0 = max(0, min_y - pad)
            x1 = min(width, max_x + pad)
            y1 = min(height, max_y + pad)
            
            cropped = img.crop((x0, y0, x1, y1))
            out_path = os.path.join(output_dir, f"{roles[i]}.png")
            cropped.save(out_path, "PNG")
            print(f"Saved: {out_path} (size: {cropped.size})")

input_img = "/Users/alan_wang/.gemini/antigravity/brain/800943fc-9f00-4bad-9a71-41e2c452d54c/pixel_desk_spritesheet_1771903515193.png"
out_dir = "/Users/alan_wang/project-golem/web-dashboard/public/characters"
os.makedirs(out_dir, exist_ok=True)
process_spritesheet(input_img, out_dir)
