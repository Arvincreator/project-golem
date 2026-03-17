from PIL import Image
import os

def balanced_background_removal(file_path):
    print(f"Balanced processing: {file_path}")
    img = Image.open(file_path).convert("RGBA")
    datas = img.getdata()

    new_data = []
    # Using a much tighter threshold to only catch the neutral gray checkers
    # and avoiding any "erosion" or "floodfill" that cuts into the object.
    for item in datas:
        r, g, b, a = item
        # The checkered backgrounds in these generations are very neutral gray.
        # r, g, b values are very close to each other.
        is_very_neutral = abs(r - g) < 5 and abs(g - b) < 5 and abs(r - b) < 5
        
        # Only target the specific range known to be the background checkers (150-240)
        # Avoid anything near white (245+) or dark parts of the object.
        if is_very_neutral and (140 < r < 242):
            new_data.append((0, 0, 0, 0))
        else:
            new_data.append(item)

    img.putdata(new_data)
    img.save(file_path, "PNG")

# Target decoration and characters
target_dirs = [
    "/Users/alan/code/contribute/dashboard/web-dashboard/public/office-assets/decoration",
    "/Users/alan/code/contribute/dashboard/web-dashboard/public/characters"
]
for target_dir in target_dirs:
    if os.path.exists(target_dir):
        for filename in os.listdir(target_dir):
            if filename.endswith(".png"):
                balanced_background_removal(os.path.join(target_dir, filename))

print("Restoration and balanced removal complete.")
