import os
from PIL import Image

def process_6_char_spritesheet(input_path, output_dir, character_names, threshold=240):
    print(f"Processing 6-character spritesheet: {input_path}")
    if not os.path.exists(input_path):
        print(f"Error: {input_path} not found")
        return
        
    img = Image.open(input_path).convert("RGBA")
    width, height = img.size
    
    # Remove background (white -> transparent)
    datas = img.getdata()
    newData = []
    for item in datas:
        # Check if pixel is white-ish
        if item[0] > threshold and item[1] > threshold and item[2] > threshold:
            newData.append((255, 255, 255, 0))
        else:
            newData.append(item)
    img.putdata(newData)
    
    pixels = img.load()
    
    # Find bounding boxes for each contiguous block of non-transparent pixels
    import cv2
    import numpy as np
    
    # Convert PIL to CV2 format
    cv_img = np.array(img)
    gray = cv2.cvtColor(cv_img, cv2.COLOR_RGBA2GRAY)
    
    # Threshold to get mask of non-transparent pixels
    alpha_channel = cv_img[:, :, 3]
    _, thresh = cv2.threshold(alpha_channel, 10, 255, cv2.THRESH_BINARY)
    
    # Use morphological closing to merge detached parts (like a floating coin or megaphone)
    kernel = np.ones((20, 20), np.uint8) # Reduced kernel size to prevent merging separate characters
    closed = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
    
    # Find contours
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    bboxes = []
    for c in contours:
        x, y, w, h = cv2.boundingRect(c)
        if w > 100 and h > 100: # Filter out small noise, characters are large
            bboxes.append((x, y, w, h))
            
    # Sort bounding boxes top-to-bottom, then left-to-right
    # Assumption: The 6 characters are roughly arranged in a 2x3 grid or a single row
    # We will sort primarily by Y (if there are clear rows) or X (if it's a single row)
    
    # Let's decide if it's multiple rows.
    # Group by roughly similar Y coordinates
    rows = []
    bboxes.sort(key=lambda b: b[1]) # Sort by Y first
    
    current_row = []
    last_y = -1
    for b in bboxes:
        if last_y == -1 or abs(b[1] - last_y) < height * 0.3: # Same row if Y is within 30% of image height
            current_row.append(b)
        else:
            rows.append(current_row)
            current_row = [b]
        last_y = b[1]
        
    if current_row:
        rows.append(current_row)
        
    # Sort each row by X (left-to-right)
    final_sorted_boxes = []
    for row in rows:
        row.sort(key=lambda b: b[0])
        final_sorted_boxes.extend(row)
        
    print(f"Detected {len(final_sorted_boxes)} character bounding boxes.")
    
    pad = 10
    for i, (x, y, w, h) in enumerate(final_sorted_boxes):
        if i >= len(character_names):
            print(f"Warning: Found more characters ({len(final_sorted_boxes)}) than names provided ({len(character_names)}). Breaking.")
            break
            
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
public_dir = "/Users/alan_wang/project-golem/web-dashboard/public"
public_char_dir = os.path.join(public_dir, "characters")
os.makedirs(public_char_dir, exist_ok=True)

# 1. 6-Character Spritesheet
sprite_img = os.path.join(public_dir, "characters_spritesheet.png")
# Top row: Writer, Designer, Strategist. Bottom row: Finance, Marketing, Operations.
char_names = ["writer", "designer", "strategist", "finance", "marketing", "operations"]
process_6_char_spritesheet(sprite_img, public_char_dir, char_names)
