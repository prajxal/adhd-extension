import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Readwell',
    description: 'Makes web text easier to read: bold-prefix, reading ruler, spacing and plain-language simplify.',
    permissions: ['storage', 'contextMenus'],
    // Add your deployed server origin here as well (see README).
    host_permissions: ['http://localhost:8000/*'],
    // Asked for one site at a time, only when opening a document from a link.
    optional_host_permissions: ['http://*/*', 'https://*/*'],
  },
});
