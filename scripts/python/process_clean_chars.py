import os
from PIL import Image

def process_clean_characters(input_path, output_dir):
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
    
    width, height = img.size
    pixels = img.load()
    quarter = width // 4
    roles = ['user_clean', 'brain_clean', 'memory_clean', 'action_clean']
    
    for i in range(4):
        x_start = i * quarter
        x_end = (i + 1) * quarter
        
        # Find tight bounds within this column
        min_x, max_x = x_end, x_start
        min_y, max_y = height, 0
        
        has_pixels = False
        for x in range(x_start, x_end):
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
            out_path = os.path.join(output_dir, f"{roles[i]}.png")
            cropped.save(out_path, "PNG")

input_img = "/Users/alan_wang/.gemini/antigravity/brain/800943fc-9f00-4bad-9a71-41e2c452d54c/pixel_characters_spritesheet_1771903021046.png"
out_dir = "/Users/alan_wang/project-golem/web-dashboard/public/characters"
os.makedirs(out_dir, exist_ok=True)
process_clean_characters(input_img, out_dir)
