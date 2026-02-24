import os
from PIL import Image

def process_spriteshet(input_path, output_dir, character_names, threshold=240):
    print(f"Processing: {input_path}")
    if not os.path.exists(input_path):
        print(f"Error: {input_path} not found")
        return
        
    img = Image.open(input_path).convert("RGBA")
    width, height = img.size
    
    # 1. Remove background (white -> transparent)
    datas = img.getdata()
    newData = []
    for item in datas:
        if item[0] > threshold and item[1] > threshold and item[2] > threshold:
            newData.append((255, 255, 255, 0))
        else:
            newData.append(item)
    img.putdata(newData)
    
    # 2. Slice dynamically using OpenCV contours
    import cv2
    import numpy as np
    
    cv_img = np.array(img)
    alpha_channel = cv_img[:, :, 3]
    _, thresh = cv2.threshold(alpha_channel, 10, 255, cv2.THRESH_BINARY)
    
    # Minimal morphological closing to join character parts but not connect to text
    kernel = np.ones((10, 10), np.uint8)
    closed = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
    
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    bboxes = []
    for c in contours:
        x, y, w, h = cv2.boundingRect(c)
        area = w * h
        if w > 30 and h > 30: # Basic noise filter
            bboxes.append((x, y, w, h, area))
            
    # Sort by area (descending) to get the largest objects (characters), ignore smaller text blocks
    bboxes.sort(key=lambda b: b[4], reverse=True)
    
    # Take only the top N boxes where N is the number of characters
    top_boxes = bboxes[:len(character_names)]
    
    # Sort the top boxes strictly left-to-right
    top_boxes.sort(key=lambda b: b[0])
    
    print(f"Extracted top {len(top_boxes)} characters from spritesheet.")
    
    pad = 5
    for i, (x, y, w, h, area) in enumerate(top_boxes):
        name = character_names[i]
        
        # Crop with padding
        x0 = max(0, x - pad)
        y0 = max(0, y - pad)
        x1 = min(width, x + w + pad)
        y1 = min(height, y + h + pad)
        
        cropped = img.crop((x0, y0, x1, y1))
        out_path = os.path.join(output_dir, f"{name}.png")
        cropped.save(out_path, "PNG")
        print(f"Saved: {out_path} (size: {cropped.size})")

# Configuration
brain_dir = "/Users/alan_wang/.gemini/antigravity/brain/800943fc-9f00-4bad-9a71-41e2c452d54c"
public_char_dir = "/Users/alan_wang/project-golem/web-dashboard/public/characters"
os.makedirs(public_char_dir, exist_ok=True)

# 1. Tech Team
tech_img = os.path.join(brain_dir, "pixel_tech_team_1771908748568.png")
tech_names = ["alex", "bob", "carol"]
process_spriteshet(tech_img, public_char_dir, tech_names)

# 2. Debate Team
debate_img = os.path.join(brain_dir, "pixel_debate_team_1771908776381.png")
debate_names = ["devil", "angel", "judge"]
process_spriteshet(debate_img, public_char_dir, debate_names)
