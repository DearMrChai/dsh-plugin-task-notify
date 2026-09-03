import type { Plugin } from 'rolldown'
import type { UserConfig } from 'tsdown'

const PLUGIN_ID = 'dsh-plugin-task-notify'

/**
 * Module-table rows the running web shell already provides (rc.8 baseline):
 * React and the runtime / settings client modules. Everything else this
 * plugin value-imports is inlined by the bundle. Type-only imports are erased
 * at build time and never reach this list.
 */
const CLIENT_EXTERNALS: readonly string[] = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-ui-primitives',
]
const EXTERNAL_SET = new Set<string>(CLIENT_EXTERNALS)

const nodeConfig: UserConfig = {
  name: PLUGIN_ID,
  entry: {
    index: 'src/index.ts',
  },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}

const clientConfig: UserConfig = {
  name: `${PLUGIN_ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    // rc.8 module-graph rule: requested shell rows stay imports (the loader
    // resolves them from its table at runtime); every other dependency is
    // bundled into the plugin closure so a runtime require can never miss
    // the table.
    neverBundle: (id: string) => EXTERNAL_SET.has(id),
    alwaysBundle: (id: string) => !EXTERNAL_SET.has(id),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default [nodeConfig, clientConfig]