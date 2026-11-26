# Textarea

Single-page notes editor. Runs in the browser. No build step, no framework.

## Run
Open index.html, or serve the folder: `python3 -m http.server`

## Features
- Multiple buffers, autosaved
- Syntax highlighting (highlight.js, vendored, common languages)
- Floating images (paste, drag, resize), stored in IndexedDB
- Per-buffer font size and line wrap

## Shortcuts
- `Alt+N` new buffer
- `Alt+P` buffer list (filter, Delete removes)
- `Alt+L` language list (filter)
- `Alt+Z` toggle wrap
- `Ctrl+/` toggle comment
- `Alt+Up/Down` move line
- `Tab` / `Shift+Tab` indent / outdent
- `` Alt+` `` swap case of selection
- `Ctrl+scroll` font size
- `Alt+/` help

## Storage
- localStorage key `notes`: all buffers, settings, help-seen flag.
- IndexedDB `notes-images`: pasted image blobs (>1600px downscaled to WebP).
- Clearing site data deletes everything.
