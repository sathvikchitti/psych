const fs = require('fs');

const file = 'index.html';
const content = fs.readFileSync(file, 'utf8');

// The markers separating major sections
const markerRegex = /<!-- ================================ PAGE: [A-Z ]+ ================================ -->|<!-- ================================ TOAST NOTIFICATION ================================ -->/g;

let match;
let indices = [];
while ((match = markerRegex.exec(content)) !== null) {
  indices.push({ index: match.index, text: match[0] });
}

// Extract header (everything before first PAGE marker)
const header = content.substring(0, indices[0].index);

// Extract footer (everything from TOAST NOTIFICATION to the end)
const toastIndex = indices.findIndex(m => m.text.includes('TOAST'));
const footer = content.substring(indices[toastIndex].index);

// Extract individual pages
const pages = {};
for (let i = 0; i < toastIndex; i++) {
  const start = indices[i].index;
  const end = indices[i+1].index;
  const pageContent = content.substring(start, end);
  const nameMatch = indices[i].text.match(/PAGE: ([A-Z ]+)/);
  if (nameMatch) {
    const pageName = nameMatch[1].trim();
    pages[pageName] = pageContent;
  }
}

// Pages: LANDING, USER INFO, ASSESSMENT, QUESTIONNAIRE, QUESTIONING, ANALYSIS, RESULTS, ERROR
// Note: QUESTIONNAIRE might just be an empty marker or commented out. Looking at previous output, QUESTIONNAIRE is just a marker right before QUESTIONING.

// Create index.html (Landing only)
const indexHtml = header + pages['LANDING'] + footer;
// Note: we'll overwrite index.html later, let's write to a temp file first.
fs.writeFileSync('new_index.html', indexHtml);

// Create analysis.html (User Info, Assessment, Questioning, Analysis, Error)
// We also need QUESTIONNAIRE marker if it exists.
const analysisPages = (pages['USER INFO'] || '') + 
                      (pages['ASSESSMENT'] || '') + 
                      (pages['QUESTIONNAIRE'] || '') + 
                      (pages['QUESTIONING'] || '') + 
                      (pages['ANALYSIS'] || '') + 
                      (pages['ERROR'] || '');
const analysisHtml = header + analysisPages + footer;
fs.writeFileSync('analysis.html', analysisHtml);

// Create results.html (Results, Error)
const resultsPages = (pages['RESULTS'] || '') + (pages['ERROR'] || '');
const resultsHtml = header + resultsPages + footer;
fs.writeFileSync('results.html', resultsHtml);

console.log("Split successful! Created new_index.html, analysis.html, results.html");
