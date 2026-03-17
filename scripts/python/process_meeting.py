import os
from PIL import Image

def process_meeting_group(input_path, output_path):
    print(f"Processing: {input_path}")
    img = Image.open(input_path).convert("RGBA")
    
    # 1. Remove background (white -> transparent)
    datas = img.getdata()
    newData = []
    threshold = 240
    for item in datas:
        # Ignore light grey lines/artifacts sometimes near the border
        if item[0] > threshold and item[1] > threshold and item[2] > threshold:
            newData.append((255, 255, 255, 0))
        else:
            newData.append(item)
    img.putdata(newData)
    
    # 2. Find tight bounds
    width, height = img.size
    pixels = img.load()
    
    min_x, max_x = width, 0
    min_y, max_y = height, 0
    
    has_pixels = False
    for x in range(width):
        for y in range(height):
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
        cropped.save(output_path, "PNG")
        print(f"Saved: {output_path} (size: {cropped.size})")

input_img = "/Users/alan_wang/.gemini/antigravity/brain/800943fc-9f00-4bad-9a71-41e2c452d54c/pixel_meeting_group_clean_1771905714501.png"
out_path = "/Users/alan_wang/project-golem/web-dashboard/public/props/meeting_group.png"
process_meeting_group(input_img, out_path)
