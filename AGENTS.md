# AI Agent System Instructions

## Project Maintenance Rules

When interacting with this repository, strictly adhere to the following rules regarding documentation and versioning:

1. **Version Bumping**: 
   - Whenever you implement a functional change, new feature, or fix a bug in the codebase, you **MUST** increment the version number.
   - The primary version number is tracked in `/package.json` (root).
   - Also, update the display version in `/docs/index.html` (the `<span id="app-version">` tag) and in `/README.md` if applicable.

2. **Documentation Sync (Bilingual)**:
   - If your changes introduce new features (e.g., adding a new AI provider, changing the UI workflow, etc.), you **MUST** update both `/README.md` and `/docs/index.html` to reflect these changes.
   - Both `/README.md` and `/docs/index.html` are strictly bilingual (**English** and **Persian/Farsi**). You must explain the feature in both languages when updating them.

3. **GitHub Pages (`/docs/index.html`)**:
   - The `/docs/index.html` file acts as the standalone presentation/landing page for GitHub Pages.
   - Keep it visually polished (using Tailwind via CDN) and ensure the English section uses `dir="ltr"` and the Persian section uses `dir="rtl"`.
