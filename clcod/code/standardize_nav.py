import os
import re

workspace = r"d:\tmp\import\psychsense_integrated\code"
files_to_update = [
    'index.html', 'analysis.html', 'results.html', 
    'questionnaire.html', 'synthesizing.html', 
    'error.html', 'login.html', 'user-info.html'
]

standard_nav_template = """  <nav class="bg-white/70 backdrop-blur-md fixed top-0 left-0 right-0 z-50 w-full border-b border-surface-container" style="z-index: 50;">
    <div class="relative flex items-center w-full px-8 py-4 max-w-[1920px] mx-auto">
      <a class="text-2xl font-black tracking-tighter text-stone-950 font-headline uppercase flex-shrink-0" href="index.html">PSYCHSENSE</a>
      <div class="hidden md:flex absolute left-1/2 -translate-x-1/2 gap-3">
        <a class="nav-pill" id="nav-home-link" href="index.html">HOME</a>
        <a class="nav-pill" id="nav-analysis-link" href="analysis.html">Analysis</a>
        <a class="nav-pill" id="nav-results-link" href="results.html">Result</a>
      </div>
      <div class="flex items-center gap-4 ml-auto">
        <div id="user-badge-index" class="hidden items-center gap-3 cursor-pointer" onclick="window.location.href='profile.html'">
          <img id="user-avatar-index" src="" alt="" class="w-9 h-9 rounded-full border-2 border-primary object-cover" referrerpolicy="no-referrer" onerror="this.src='https://ui-avatars.com/api/?background=bb000e&color=fff&size=64'">
          <span id="user-name-index" class="font-label text-xs uppercase tracking-widest text-on-surface hidden md:block"></span>
        </div>
        <div id="auth-section">
          <a id="login-signup-btn" href="login.html" class="bg-primary text-on-primary font-label text-sm uppercase tracking-wider px-6 py-3 rounded-sm hover:bg-primary-container transition-all duration-300 hover:-translate-y-[2px]">Signup/Login</a>
        </div>
      </div>
    </div>
  </nav>"""

for filename in files_to_update:
    filepath = os.path.join(workspace, filename)
    if not os.path.exists(filepath):
        continue
        
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Regex to find <nav> ... </nav> block
    nav_pattern = r'(?s)<nav[^>]*>.*?</nav>'
    
    # We want to insert the standard nav, but mark the active pill via regex for the current file
    custom_nav = standard_nav_template
    if filename == 'index.html':
        custom_nav = custom_nav.replace('id="nav-home-link" href="index.html"', 'id="nav-home-link" href="index.html" class="nav-pill active"')
        # ensure nav-pill active isn't duplicated
        custom_nav = custom_nav.replace('class="nav-pill" id="nav-home-link" href="index.html" class="nav-pill active"', 'class="nav-pill active" id="nav-home-link" href="index.html"')
    elif filename in ['analysis.html', 'questionnaire.html', 'synthesizing.html', 'user-info.html']:
        custom_nav = custom_nav.replace('id="nav-analysis-link" href="analysis.html"', 'id="nav-analysis-link" href="analysis.html" class="nav-pill active"')
        custom_nav = custom_nav.replace('class="nav-pill" id="nav-analysis-link" href="analysis.html" class="nav-pill active"', 'class="nav-pill active" id="nav-analysis-link" href="analysis.html"')
    elif filename == 'results.html':
        custom_nav = custom_nav.replace('id="nav-results-link" href="results.html"', 'id="nav-results-link" href="results.html" class="nav-pill active"')
        custom_nav = custom_nav.replace('class="nav-pill" id="nav-results-link" href="results.html" class="nav-pill active"', 'class="nav-pill active" id="nav-results-link" href="results.html"')

    new_content = re.sub(nav_pattern, custom_nav, content, count=1)
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(new_content)

print("Navbar standardized across all requested pages.")
