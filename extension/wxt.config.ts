import { readdirSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'wxt';

const PDFJS = path.resolve('node_modules/pdfjs-dist');
// PDF.js worker, standard fonts, character maps, colour profiles and image decoders,
// packaged under /pdfjs/ so the reader never loads code or data from the network.
const PDFJS_DIRS = ['standard_fonts', 'cmaps', 'iccs', 'wasm'];

// Test-only build for automated browser tests, which can't click Chrome's permission
// prompts: pre-grants all sites and builds into .output-e2e so it can't be shipped by mistake.
const E2E = process.env.READWELL_E2E === '1';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  outDir: E2E ? '.output-e2e' : '.output',
  hooks: {
    'build:publicAssets': (_wxt, files) => {
      files.push({ absoluteSrc: path.join(PDFJS, 'build/pdf.worker.min.mjs'), relativeDest: 'pdfjs/pdf.worker.min.mjs' });
      for (const dir of PDFJS_DIRS) {
        for (const file of readdirSync(path.join(PDFJS, dir))) {
          files.push({ absoluteSrc: path.join(PDFJS, dir, file), relativeDest: `pdfjs/${dir}/${file}` });
        }
      }
    },
  },
  manifest: {
    name: 'Readwell',
    description: 'Makes web text easier to read: bold-prefix, reading ruler, spacing and plain-language simplify.',
    // scripting: register the content script only on allowed sites.
    // activeTab: right-click "Simplify selection" and the popup work on the current tab
    // without any standing permission.
    permissions: ['storage', 'contextMenus', 'scripting', 'activeTab'],
    // Add your deployed server origin here as well (see README).
    host_permissions: ['http://localhost:8000/*', ...(E2E ? ['<all_urls>'] : [])],
    // Asked for one site at a time (turning a site on, opening a document link), or for all
    // sites only if the user opts in to the Simplify button everywhere.
    optional_host_permissions: ['http://*/*', 'https://*/*'],
  },
});
