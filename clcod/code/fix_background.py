import os
import re
import glob

workspace = r"d:\tmp\import\psychsense_integrated\code"
files = glob.glob(os.path.join(workspace, "*.html"))

for file in files:
    with open(file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Fix nested <style> in results.html or any other place
    content = content.replace("<style id=\"nav-pill-style\">\n", "")
    content = content.replace("  <style id=\"nav-pill-style\">\n", "")
    # Actually just regex replace the nested style tag
    content = re.sub(r'<style id="nav-pill-style">', '', content)
    # The ending </style> will then close the outer style block prematurely if we're not careful.
    # Let's see results.html:
    # 39:   <style id="nav-pill-style">
    # ...
    # 43:   </style>
    # 44: </style>
    # So if we remove <style id="nav-pill-style"> and the FIRST </style> after it, it will fix it.
    
    # A cleaner way is to search for the specific block in results.html and replace it
    bad_style = """  <style id="nav-pill-style">
    .nav-pill{font-family:'Space Grotesk',sans-serif;font-size:14px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:8px 20px;border-radius:999px;border:1.5px solid rgba(28,27,27,0.12);box-shadow:0 2px 8px rgba(0,0,0,0.07);transition:all 0.25s ease;color:#3a3a3a;background:rgba(255,255,255,0.7);text-decoration:none;display:inline-block;}
    .nav-pill:hover{background:#fff;box-shadow:0 4px 16px rgba(0,0,0,0.13);transform:translateY(-2px);color:#8e0008;border-color:rgba(142,0,8,0.25);}
    .nav-pill.active{background:#8e0008;color:#fff;border-color:#8e0008;box-shadow:0 4px 16px rgba(142,0,8,0.25);}
  </style>"""
    
    good_style = """
    .nav-pill{font-family:'Space Grotesk',sans-serif;font-size:14px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:8px 20px;border-radius:999px;border:1.5px solid rgba(28,27,27,0.12);box-shadow:0 2px 8px rgba(0,0,0,0.07);transition:all 0.25s ease;color:#3a3a3a;background:rgba(255,255,255,0.7);text-decoration:none;display:inline-block;}
    .nav-pill:hover{background:#fff;box-shadow:0 4px 16px rgba(0,0,0,0.13);transform:translateY(-2px);color:#8e0008;border-color:rgba(142,0,8,0.25);}
    .nav-pill.active{background:#8e0008;color:#fff;border-color:#8e0008;box-shadow:0 4px 16px rgba(142,0,8,0.25);}
"""
    content = content.replace(bad_style, good_style)

    # Make the navbar consistent in results.html (Add the auth-section div wrapper)
    # The navbar in results.html currently has:
    # <div id="auth-section">
    #   <a id="login-signup-btn"...>
    # </div>
    # Actually results has it wrapper! And analysis.html has it too!
    # Let's check index.html. In index.html, it's just:
    # <a id="login-signup-btn"...
    # Let's make index.html have <div id="auth-section"> wrap so it's consistent?
    # Wait, the prompt says "the navbar in the result page is not implemented the way I wanted". 
    # Let's check if there's any other differences in result.html's navbar. 
    # In index.html: <nav class="bg-white/70 backdrop-blur-md fixed top-0 left-0 right-0 z-50 w-full border-b border-surface-container">
    # In results.html: <nav class="bg-white/70 backdrop-blur-md fixed top-0 left-0 right-0 z-50 w-full border-b border-surface-container">
    # They are identical EXCEPT the invalid nested CSS tag `<style id="nav-pill-style">` that breaks the navbar rendering entirely in results.html!
    
    # Fix backgrounds:
    # 1. replace long url ending with "...e2oykna..." in bg-fixed-image
    # 2. replace long url ending with "..._zTqFIs..." in synthesizing.html
    # 3. replace long url ending with "...WzWxL__5TE5jyUOM" in questionniare.html
    
    # We will just replace any googleusercontent image inside url(...) with assets/hero_silk_bg.png
    content = re.sub(r"url\('?https://lh3.googleusercontent.com/[a-zA-Z0-9_\-]+'?\)", "url('assets/hero_silk_bg.png')", content)

    # Let's ensure body has bg-fixed-image if required
    # But he said "to be as the background for all pages", so we can add .bg-fixed-image to the body classes of all files.
    # We can inject a <style> block right before </head> to apply it directly to body?
    # Instead, let's just make it a global body style:
    body_style = """
  body, .bg-fixed-image {
    background-image: linear-gradient(rgba(255,255,255,0.7), rgba(255,255,255,0.7)), url('assets/hero_silk_bg.png') !important;
    background-size: cover !important;
    background-position: center !important;
    background-attachment: fixed !important;
  }
"""
    # Replace any existing .bg-fixed-image block with nothing or just let the new body override it.
    if "</head>" in content and file.endswith("html"):
        content = content.replace("</head>", f"<style>{body_style}</style>\n</head>")

    with open(file, 'w', encoding='utf-8') as f:
        f.write(content)

print("Updates completed successfully.")
