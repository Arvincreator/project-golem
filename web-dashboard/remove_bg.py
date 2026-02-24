import os
from PIL import Image

# Directories containing the images
directories = [
    '/Users/alan_wang/project-golem/web-dashboard/public/characters',
    '/Users/alan_wang/project-golem/web-dashboard/public/props',
    '/Users/alan_wang/project-golem/web-dashboard/public/office-assets/tech'
]

def remove_white_background(img_path):
    print(f"Processing: {img_path}")
    try:
        img = Image.open(img_path)
        img = img.convert("RGBA")
        
        datas = img.getdata()
        newData = []
        
        # Define a threshold for what constitutes "white" to handle slight anti-aliasing in AI generation
        # A higher threshold (e.g., 250) is safer for preserving light-colored details.
        threshold = 245
        
        for item in datas:
            # Check if pixel is close to white (R, G, B > threshold)
            # item[3] is the alpha channel, only process opaque pixels
            if item[3] > 0 and item[0] > threshold and item[1] > threshold and item[2] > threshold:
                # Change all white pixels to transparent
                newData.append((255, 255, 255, 0))
            else:
                newData.append(item)
                
        img.putdata(newData)
        img.save(img_path, "PNG")
        print(f"Saved: {img_path}")
    except Exception as e:
        print(f"Error processing {img_path}: {e}")

# Process all PNGs in the specified directories
for directory in directories:
    if not os.path.exists(directory):
        print(f"Directory not found: {directory}")
        continue
        
    print(f"\nScanning directory: {directory}")
    for filename in os.listdir(directory):
        if filename.endswith(".png"):
            file_path = os.path.join(directory, filename)
            remove_white_background(file_path)

print("\nBackground removal complete.")
